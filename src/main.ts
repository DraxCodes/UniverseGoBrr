import './styles.css';
import { initDevice, type GpuContext } from './gpu/device';
import { createRenderer, type RendererHandle } from './gpu/renderer';
import { createPrecisionProbe } from './frame/precision-probe';
import { formatAddress } from './frame/address';
import { mountHud, showFatal } from './ui/hud';
import { attachOrbitControls } from './input/orbit-controls';
import { defaultSystemCamera, displayScaleM } from './render/system-scene';
import { describeSystem, generateSystem } from './universe/system';
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

  // The system is generated from the address alone (ADR-0005), so it is also built once. A
  // shared link reproduces it exactly; nothing about it is cached or persisted.
  const system = probe ? null : generateSystem(state.seed, state.address);

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
    },
    onPipeline: (generation, error) => hud.setPipeline(generation, error),
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