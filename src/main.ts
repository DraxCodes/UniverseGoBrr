import './styles.css';
import { initDevice, type GpuContext } from './gpu/device';
import { createRenderer, type RendererHandle } from './gpu/renderer';
import { createPrecisionProbe } from './frame/precision-probe';
import { formatAddress } from './frame/address';
import { mountHud, showFatal } from './ui/hud';
import { attachOrbitControls } from './input/orbit-controls';
import { defaultSystemCamera, displayScaleM } from './render/system-scene';
import { GALAXY_MAX_DISTANCE_M } from './render/galaxy-scene';
import { notchFactor } from './render/scale';
import { describeSystem } from './universe/system';
import { resolveSystem } from './universe/authored';
import { generateGalaxy, type Galaxy, type GalaxyTier } from './universe/galaxy';
import {
  DEFAULT_CAMERA,
  cameraSnapshot,
  clockSeconds,
  defaultState,
  parseUrlState,
  urlForState,
  type UrlState,
} from './state/url-state';

interface AppHandle {
  dispose(): void;
}

let app: AppHandle | null = null;
let renderer: RendererHandle | null = null;
let gpu: GpuContext | null = null;
let state: UrlState = defaultState();
let ready = false;
let failure: string | null = null;
/** Set by HMR disposal so an init that was still awaiting cannot start a second app. */
let disposed = false;
/** The live galaxy, so the debug surface can report its centre for capture framing. */
let currentGalaxy: Galaxy | null = null;

/**
 * The impostor budget this build opens with. "Rich" is the desktop default; the renderer's
 * frame-time watchdog drops it to medium/low rather than stalling (issue 04 D6). Counts are
 * compile-time constants, so a link cannot ask for more.
 */
const GALAXY_TIER: GalaxyTier = 'rich';
/** The controls' base wheel factor for a 100 px notch; the schedule reports its boost against it. */
const WHEEL_BASE = Math.exp(0.12);

// Survives HMR module re-execution; replaced only by an actual page load.
const pageLoadId = (() => {
  window.__ugbPageLoadId ??= newId();
  return window.__ugbPageLoadId;
})();

// Changes on every HMR restart (but not on a shader-only update), so checks can wait for it.
const bootId = newId();

// The debug surface is for the capture harness and the dev-loop check. It is installed
// before init so a failure still reports a reason instead of a timeout.
window.__ugb = {
  get ready() {
    return ready;
  },
  get error() {
    return failure;
  },
  pageLoadId,
  bootId,
  get deviceId() {
    return gpu?.deviceId ?? '';
  },
  get frame() {
    return renderer?.frame ?? 0;
  },
  get pipelineGeneration() {
    return renderer?.pipelineGeneration ?? 0;
  },
  get fps() {
    return renderer?.fps ?? 0;
  },
  get tier() {
    return renderer?.galaxyTier ?? 'rich';
  },
  /** The current crossfade and population, for the live handoff probe's evidence. */
  get galaxy() {
    const frame = renderer?.galaxyFrame();
    return frame
      ? {
          lod: frame.lod,
          // The HUD's scene row keys off `identity` (scale, not orientation), so the probe can
          // see both numbers and tell the two apart.
          identity: frame.identity,
          contrast: frame.contrast,
          count: frame.count,
          tier: renderer?.galaxyTier ?? 'rich',
          // The disc's centre relative to the home star, in metres: capture framing needs it,
          // and it makes the population's geometry checkable from a browser session.
          centre: currentGalaxy
            ? ([currentGalaxy.centre.x, currentGalaxy.centre.y, currentGalaxy.centre.z] as const)
            : null,
        }
      : null;
  },
  forceSlowFrames(frames: number) {
    renderer?.forceSlowFrames(frames);
  },
  get state() {
    return {
      seed: state.seed,
      epoch: new Date(state.epochMs).toISOString(),
      address: formatAddress(state.address),
      t: state.t,
      camera: cameraSnapshot(state.camera),
      precision: state.precision,
    };
  },
  get precisionReport() {
    return renderer?.precisionReport() ?? null;
  },
  sampleCanvas() {
    if (!renderer) return Promise.reject(new Error('The renderer is not ready.'));
    return renderer.sampleFrame();
  },
};

async function init(): Promise<AppHandle> {
  ready = false;
  failure = null;

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('Canvas #stage is missing from index.html.');

  const parsed = parseUrlState(location.search);
  state = parsed.state;

  const hud = mountHud(state, parsed.issues);
  hud.setStatus('acquiring GPU device');

  // The probe is a debug scene, so it is built once at boot: its marker offsets never change.
  const probe = state.precision ? createPrecisionProbe() : null;

  // The system is resolved from the address alone (ADR-0005): an authored node (spec §3.6) wins,
  // otherwise the generator does. A shared link reproduces either one exactly; nothing is cached.
  const system = probe ? null : resolveSystem(state.seed, state.address);
  // The galaxy is generated once, in real metres, and is the backdrop the home system sits in.
  // It is keyed on the galaxy's own level rather than this address (ADR-0011), so every star in
  // one galaxy gets the same sky; nothing about it is persisted or cached across loads (ADR-0005).
  const galaxy = system ? generateGalaxy(state.seed, state.address, GALAXY_TIER) : null;
  currentGalaxy = galaxy;

  // A camera at the origin is inside the star. When the URL did not name one, the scene picks a
  // framing that shows the system, and that framing is then written back to the URL.
  if (system && !state.cameraExplicit) {
    state.camera = defaultSystemCamera(system);
    state.cameraExplicit = true;
  }

  gpu = await initDevice();
  if (disposed) throw new Error('App disposed while acquiring the GPU device.');
  hud.setGpu(gpu);
  hud.setStatus('creating pipeline');

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Could not get a WebGPU context from the canvas.');

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: gpu.device, format, alphaMode: 'opaque' });

  const created = await createRenderer({
    device: gpu.device,
    context,
    format,
    canvas,
    seed: state.seed,
    camera: state.camera,
    system,
    galaxy,
    galaxyTier: GALAXY_TIER,
    precision: probe,
    precisionMode: state.precision ?? 'fixed',
    getTime: () => clockSeconds(state, Date.now()),
    onFirstFrame: () => {
      ready = true;
      hud.setStatus('ready');
      if (probe) hud.setPrecision(created.precisionReport(), state.precision);
    },
    onStats: (stats) => {
      hud.setFps(stats.fps);
      hud.setClock(stats.time, state.t !== null);
      // The probe's pixel spread depends on the canvas size, so it is refreshed with the
      // stats rather than set once: a resized window must not keep showing the old number.
      if (probe) hud.setPrecision(created.precisionReport(), state.precision);

      // Issue 04 D8: the existing scene row carries the galaxy factor; there is no second
      // disclaimer and no new panel. Positions are never scaled, so the galaxy reads `×1 real`;
      // the only distortion is traversal, and it is printed where it is active.
      if (system) {
        // The scene row states *where you are*, so it keys off `identity` (are we at galaxy
        // scale?) rather than `lod`. `lod` also folds in the disc's inclination; a straight
        // zoom-out from the default view is edge-on, and it would leave the row reading
        // "K-type · 9 planets" at 45 000 ly while the whole galaxy fills the frame.
        const identity = created.galaxyFrame()?.identity ?? 0;
        const distance = Math.hypot(state.camera.x, state.camera.y, state.camera.z);
        const boost = notchFactor(distance, WHEEL_BASE) / WHEEL_BASE;
        if (identity > 0.5) {
          hud.setScene('one galaxy · ×1 real');
        } else if (boost > 1.02) {
          hud.setScene(`${describeSystem(system)} · void ×${boost.toFixed(1)}`);
        } else {
          hud.setScene(describeSystem(system));
        }
      }
    },
    onPipeline: (generation, error) => hud.setPipeline(generation, error),
    onTierDrop: (tier) => hud.notice(`quality: ${tier} · long frames`),
  });

  if (disposed) {
    created.dispose();
    throw new Error('App disposed while creating the renderer.');
  }
  renderer = created;

  const persist = (): void => {
    history.replaceState(null, '', urlForState(state, location.pathname));
  };
  persist();

  hud.setCamera(state.camera);
  if (system) hud.setScene(describeSystem(system));

  // Framing controls. They mutate `state.camera` in place, so the renderer (which holds that
  // reference) picks the change up on the next frame. The URL is rewritten only when a gesture
  // settles: browsers rate-limit `history.replaceState`.
  const controls = system
    ? attachOrbitControls({
        element: canvas,
        camera: state.camera,
        frameScaleM: displayScaleM(system),
        maxDistanceM: GALAXY_MAX_DISTANCE_M,
        onChange: () => hud.setCamera(state.camera),
        onCommit: persist,
        onZoomEdge: (edge) => hud.notice(edge === 'max' ? 'max zoom' : 'min zoom'),
      })
    : null;

  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key.toLowerCase() === 'p') {
      state.t = state.t === null ? clockSeconds(state, Date.now()) : null;
      persist();
      hud.setClock(clockSeconds(state, Date.now()), state.t !== null);
    } else if (event.key.toLowerCase() === 'r') {
      // Reset means "the framing this scene opens with", not "the origin" — the origin is
      // inside the star.
      const home = system ? defaultSystemCamera(system) : { ...DEFAULT_CAMERA };
      Object.assign(state.camera, home);
      persist();
      hud.setCamera(state.camera);
    } else if (event.key.toLowerCase() === 'f') {
      toggleFullscreen();
    }
  };

  const onDeviceLost = (event: Event): void => {
    const info = (event as CustomEvent<GPUDeviceLostInfo>).detail;
    failure = `GPU device lost (${info.reason}): ${info.message}`;
    ready = false;
    showFatal(failure);
    created.dispose();
  };

  window.addEventListener('keydown', onKey);
  window.addEventListener('ugb:device-lost', onDeviceLost);

  return {
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ugb:device-lost', onDeviceLost);
      controls?.dispose();
      created.dispose();
      if (renderer === created) renderer = null;
      ready = false;
    },
  };
}

async function boot(): Promise<void> {
  try {
    app = await init();
  } catch (error) {
    // A superseded module must not paint a fatal panel over the new one.
    if (disposed) return;
    failure = error instanceof Error ? error.message : String(error);
    ready = false;
    console.error('[ugb] init failed:', error);
    showFatal(error);
  }
}

if (import.meta.hot) {
  // Wiring changes restart the app without a page reload; the GPUDevice survives because it
  // is cached on device.ts's HMR data. Shader edits do not come through here at all.
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    disposed = true;
    app?.dispose();
    app = null;
  });
}

void boot();

function toggleFullscreen(): void {
  const change = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();

  void change.catch((error: unknown) => {
    console.warn('[ugb] fullscreen toggle failed:', error);
  });
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `load-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}