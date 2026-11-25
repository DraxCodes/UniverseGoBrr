import './styles.css';
import { initDevice, type GpuContext } from './gpu/device';
import { createRenderer, type FrameSnapshot, type RendererHandle } from './gpu/renderer';
import { createPrecisionProbe } from './frame/precision-probe';
import { formatAddress, parseAddress, sameAddress, type Address } from './frame/address';
import { mountHud, showFatal, type CompassEntry } from './ui/hud';
import { attachOrbitControls, orbitDistance, orbitTo } from './input/orbit-controls';
import { defaultSystemCamera, displayScaleM } from './render/system-scene';
import { GALAXY_MAX_DISTANCE_M } from './render/galaxy-scene';
import { notchFactor } from './render/scale';
import { maskMethodFor, type MaskMethod } from './render/tier-mask';
import { AU_M, describeSystem } from './universe/system';
import { resolveSystem } from './universe/authored';
import { generateGalaxy, type Galaxy, type GalaxyTier } from './universe/galaxy';
import { LY_M, galaxyAddressOf, galaxyFrame } from './universe/disc';
import { placement } from './universe/placement';
import { galaxyFraming, nearestAnchors, planZoomOut } from './universe/navigation';
import { planTravel, type TravelPlan } from './universe/travel';
import {
  DEFAULT_CAMERA,
  advanceClock,
  cameraSnapshot,
  clockSeconds,
  defaultState,
  historyWrite,
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
/** Bumped by every (re)start; an older init must never install itself over a newer one. */
let bootGeneration = 0;
/** The address of the history entry the page is currently on (see `historyWrite`). */
let currentEntryAddress = '';
/** The HUD's notice sink, set by `init`, so module-level travel can report without the HUD. */
let notice: (text: string) => void = () => {};
/** The compass rows this boot is showing, so the debug surface can report them. */
let currentCompass: readonly CompassEntry[] = [];
/** Staged tier mask handoff from `commitTravel()` into the next `init()` rebuild. */
let pendingMask: {
  method: MaskMethod;
  departureAddress: Address;
  snapshot: FrameSnapshot | null;
} | null = null;

function clearPendingMask(): void {
  pendingMask?.snapshot?.texture.destroy();
  pendingMask = null;
}

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
  travel(to: string) {
    return commitTravel(to);
  },
  /** Follow an address line: free zoom-out to the galaxy (ADR-0013). */
  zoomOut(depth: number) {
    return commitZoomOut(depth);
  },
  /** The compass rows as the HUD is showing them, for capture evidence. */
  get compass() {
    return currentCompass.map((entry) => ({
      address: formatAddress(entry.address),
      label: entry.label,
      note: entry.note,
      distanceM: entry.distanceM,
    }));
  },
  /** The browser history depth, so a capture can prove a framing write did not grow it. */
  get historyLength() {
    return history.length;
  },
  get state() {
    return {
      seed: state.seed,
      epoch: new Date(state.epochMs).toISOString(),
      address: formatAddress(state.address),
      from: state.from ? formatAddress(state.from) : null,
      t: state.t,
      camera: cameraSnapshot(state.camera),
      /** The point the camera looks at (ADR-0014). `[0,0,0]` until the view is panned. */
      target: [state.camera.target.x, state.camera.target.y, state.camera.target.z] as const,
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

/**
 * Write a coordinate to the URL under the history contract in `url-state.ts`.
 *
 * The rule lives in `historyWrite`: a write that changes the address is a place and gets its own
 * entry; a write that keeps it replaces in place. One entry per place is what makes Back retrace
 * places instead of mouse movements.
 */
function writeUrl(next: UrlState): void {
  const nextAddress = formatAddress(next.address);
  const method = historyWrite(currentEntryAddress, nextAddress);
  const url = urlForState(next, location.pathname);

  if (method === 'push') {
    history.pushState(null, '', url);
  } else {
    history.replaceState(null, '', url);
  }
  // The page is on this entry now, whichever kind of write it was: a later write has to compare
  // against the address actually in the address bar, not the last one that happened to push.
  currentEntryAddress = nextAddress;
}

function persist(): void {
  writeUrl(state);
}

/**
 * Commit a travel: the one place the address changes (ADR-0003, ADR-0010, ADR-0012).
 *
 * The order matters. The arrival state is built first (new address, advanced clock, the
 * destination's opening camera), then written as one `push`, then the scene is rebuilt from that
 * URL. A travel is therefore *exactly* "write the arrival link and enter it", which is the
 * round-trip invariant the evidence plan asks for: reloading the link and arriving by travel are
 * the same state, not two code paths that have to agree.
 */
function commitTravel(toText: string): UniverseTravelResult {
  if (!app) {
    return {
      ok: false,
      reason: 'the app is not ready',
      method: null,
      distanceM: null,
      elapsedS: null,
    };
  }

  const parsed = parseAddress(toText);
  if (!parsed.address) {
    const reason = parsed.issue ?? `"${toText}" is not an address`;
    notice(`travel: ${reason}`);
    return { ok: false, reason, method: null, distanceM: null, elapsedS: null };
  }

  const plan: TravelPlan = planTravel(state.seed, state.address, parsed.address);
  if (plan.distanceM === null || plan.elapsedS === null) {
    const reason = plan.reason ?? 'no distance is modelled between those places';
    notice(`travel: ${reason}`);
    return { ok: false, reason, method: plan.method, distanceM: null, elapsedS: null };
  }

  const clock = advanceClock(state, plan.elapsedS);
  if (!clock.ok) {
    notice(`travel: ${clock.reason}`);
    return {
      ok: false,
      reason: clock.reason,
      method: plan.method,
      distanceM: plan.distanceM,
      elapsedS: plan.elapsedS,
    };
  }

  const next: UrlState = {
    ...state,
    address: parsed.address,
    // The compass's "came from" pin. A coordinate, not journey state (see `UrlState.from`).
    from: state.address,
    t: clock.t,
    epochMs: clock.epochMs,
    // "See the destination" (owner, 2026-11-24): the arrival camera is exactly the opening
    // framing a fresh shared link to that place would choose, so a link taken mid-jump and the
    // jump's own arrival are the same state.
    camera: defaultSystemCamera(resolveSystem(state.seed, parsed.address)),
    cameraExplicit: true,
  };

  const maskMethod = maskMethodFor(plan.method);
  if (maskMethod !== null) {
    renderer?.interruptMask();
    const snapshot = renderer?.captureSnapshot() ?? null;
    clearPendingMask();
    pendingMask = {
      method: maskMethod,
      departureAddress: state.address,
      snapshot,
    };
  } else {
    clearPendingMask();
  }

  writeUrl(next);
  notice(
    `${plan.method} · ${describeDistanceM(plan.distanceM)} · ${describeDurationS(plan.elapsedS)}`,
  );
  // A different address is a different scene: the renderer is built from one address.
  void start();

  return {
    ok: true,
    reason: null,
    method: plan.method,
    distanceM: plan.distanceM,
    elapsedS: plan.elapsedS,
  };
}

function describeDistanceM(metres: number): string {
  const ly = metres / LY_M;
  return ly >= 0.1 ? `${ly.toFixed(1)} ly` : `${(metres / AU_M).toFixed(1)} AU`;
}

/** How many neighbouring stars the compass lists. The pin is a fourth row, not one of these. */
const COMPASS_ANCHOR_LIMIT = 3;

/**
 * The compass rows for one coordinate: the nearest drawn stars, then the `from` pin.
 *
 * Both halves are content. The anchors come from the galaxy the picture is drawing, so a row is a
 * light you can see; the pin is the place the last travel started, which the link carries
 * (`UrlState.from`). "Came from" is a label on a place, never a stored journey.
 *
 * The pin is only offered when it sits in the same galaxy as the current place: distance across
 * galaxies is unmodelled (ADR-0010), so a row for one would show a made-up number.
 */
function compassEntries(galaxy: Galaxy, address: Address, from: Address | null): CompassEntry[] {
  const origin = placement(state.seed, address) ?? { x: 0, y: 0, z: 0 };
  const anchors = nearestAnchors(galaxy.stars, address, origin, COMPASS_ANCHOR_LIMIT);

  const entries: CompassEntry[] = anchors.map((anchor) => ({
    address: anchor.address,
    label: anchor.home ? 'home star' : formatAddress(anchor.address),
    distanceM: anchor.distanceM,
    offset: anchor.offset,
    note: anchor.home ? 'home' : null,
  }));

  if (
    from &&
    !sameAddress(from, address) &&
    sameAddress(galaxyAddressOf(from), galaxyAddressOf(address))
  ) {
    const position = placement(state.seed, from);
    if (position) {
      const offset = {
        x: position.x - origin.x,
        y: position.y - origin.y,
        z: position.z - origin.z,
      };
      const distanceM = Math.hypot(offset.x, offset.y, offset.z);
      if (distanceM > 0) {
        const existing = entries.find((entry) => sameAddress(entry.address, from));
        if (existing) {
          entries[entries.indexOf(existing)] = {
            ...existing,
            note: existing.note === null ? 'came from' : `${existing.note} · came from`,
          };
        } else {
          entries.push({
            address: from,
            label: formatAddress(from),
            distanceM,
            offset,
            note: 'came from',
          });
        }
      }
    }
  }

  return entries;
}

/**
 * Follow a line of the address HUD: zoom out to the galaxy, **free** (ADR-0013).
 *
 * This is a **reframe**, not a travel. No universe time passes and the clock's mode is untouched —
 * you are changing which frame you look at the same neighbourhood from.
 *
 * The camera goes to `galaxyFraming`: face-on to the disc (so "the galaxy" is a galaxy and not a
 * band) and far enough out that the whole disc is inside the frame despite the orbit camera
 * looking at the home star rather than the galactic centre. The eye stays on the ray its angles
 * describe, which keeps the orbit-control invariant, so the next drag continues from this view
 * instead of snapping back to the origin.
 *
 * A true translation-preserving zoom-out needs a camera *target*, because after a pure rebase the
 * eye is no longer on that ray and the next drag would snap the view back to the origin. That
 * generalisation is the panning work in lane 4.
 *
 * The address changes, so it gets a history entry (Back returns to the star) even though nothing
 * costs any time.
 */
function commitZoomOut(depth: number): UniverseNavigationResult {
  if (!app) return { ok: false, reason: 'the app is not ready' };

  const plan = planZoomOut(state.address, depth);
  if (!plan.ok) {
    notice(`zoom out: ${plan.reason}`);
    return { ok: false, reason: plan.reason };
  }

  // The centre comes from the galaxy's frame, not from the generated population: the frame is the
  // cheap part, and a zoom-out must not pay for a whole galaxy just to place the camera.
  const framing = galaxyFraming(galaxyFrame(state.seed, plan.address).centre);

  const next: UrlState = {
    ...state,
    address: plan.address,
    camera: orbitTo(framing.yaw, framing.pitch, framing.distanceM),
    cameraExplicit: true,
  };

  writeUrl(next);
  notice(`zoomed out to ${formatAddress(plan.address)} · no time passed`);
  clearPendingMask();
  void start();
  return { ok: true, reason: null };
}

function describeDurationS(seconds: number): string {
  if (seconds >= 86_400) return `${(seconds / 86_400).toFixed(1)} days`;
  if (seconds >= 3_600) return `${(seconds / 3_600).toFixed(1)} h`;
  return `${seconds.toFixed(0)} s`;
}

async function init(attempt: number): Promise<AppHandle> {
  const travelMask = pendingMask;
  pendingMask = null;
  let maskAdopted = false;

  try {
    ready = false;
    failure = null;

    const canvas = document.querySelector<HTMLCanvasElement>('#stage');
    if (!canvas) throw new Error('Canvas #stage is missing from index.html.');

    const parsed = parseUrlState(location.search);
    state = parsed.state;
    // The page is on this entry now. A travel from here compares against this address, which is
    // what turns "consecutive same-address pushes" into a replace.
    currentEntryAddress = formatAddress(state.address);

    const hud = mountHud(
      state,
      parsed.issues,
      {
        zoomOut: (depth) => {
          commitZoomOut(depth);
        },
        travelTo: (address) => {
          commitTravel(formatAddress(address));
        },
      },
      travelMask?.departureAddress,
    );
    notice = (text) => hud.notice(text);
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

    // The compass is built from the population the picture already draws, so an anchor is a light
    // you can see (ADR-0011) and the search costs one pass over an array that exists anyway. The
    // `from` pin is appended only when the link carried one and it is not the place itself.
    currentCompass = galaxy ? compassEntries(galaxy, state.address, state.from) : [];
    if (galaxy) hud.setCompass(currentCompass);

    gpu = await initDevice();
    if (disposed || attempt !== bootGeneration) {
      throw new Error('App was superseded while acquiring the GPU device.');
    }
    hud.setGpu(gpu);
    hud.setStatus('creating pipeline');

    const validSnapshot =
      travelMask?.snapshot && travelMask.snapshot.deviceId === gpu.deviceId
        ? travelMask.snapshot
        : null;
    if (travelMask?.snapshot && !validSnapshot) {
      travelMask.snapshot.texture.destroy();
    }

    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not get a WebGPU context from the canvas.');

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: gpu.device, format, alphaMode: 'opaque' });

    const created = await createRenderer({
      device: gpu.device,
      deviceId: gpu.deviceId,
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
      travelMask: travelMask
        ? {
            method: travelMask.method,
            departure: validSnapshot,
            onMidpoint: () => hud.setAddress(state.address),
          }
        : null,
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
          // The zoom rate follows the orbit distance (eye to target), not the eye's distance from
          // the frame origin: after a pan both move together, so the wheel keeps its feel.
          const distance = orbitDistance(state.camera);
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

    maskAdopted = true;

    if (disposed || attempt !== bootGeneration) {
      created.dispose();
      throw new Error('App was superseded while creating the renderer.');
    }
    renderer = created;

    if (urlForState(state, location.pathname) !== location.pathname + location.search) {
      persist();
    }

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
          onChange: () => {
            if (created.isMaskActive()) created.interruptMask();
            hud.setCamera(state.camera);
          },
          onCommit: persist,
          onZoomEdge: (edge) => hud.notice(edge === 'max' ? 'max zoom' : 'min zoom'),
        })
      : null;

    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        if (created.isMaskActive()) created.interruptMask();
      } else if (event.key.toLowerCase() === 'p') {
        state.t = state.t === null ? clockSeconds(state, Date.now()) : null;
        persist();
        hud.setClock(clockSeconds(state, Date.now()), state.t !== null);
      } else if (event.key.toLowerCase() === 'r') {
        if (created.isMaskActive()) created.interruptMask();
        // Reset means "the framing this scene opens with", not "the origin" — the origin is
        // inside the star.
        const home = system
          ? defaultSystemCamera(system)
          : { ...DEFAULT_CAMERA, target: { ...DEFAULT_CAMERA.target } };
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

    // Back and Forward are real navigation: the URL is the coordinate, so the page has to enter
    // the coordinate it now names. Rebuilding is honest rather than clever — the renderer is built
    // from one address (see `docs/notes/reentering-a-coordinate.md`).
    const onPopState = (): void => {
      hud.clearNotice();
      clearPendingMask();
      void start();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('ugb:device-lost', onDeviceLost);
    window.addEventListener('popstate', onPopState);

    return {
      dispose() {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('ugb:device-lost', onDeviceLost);
        window.removeEventListener('popstate', onPopState);
        controls?.dispose();
        created.dispose();
        if (renderer === created) renderer = null;
        ready = false;
      },
    };
  } finally {
    if (!maskAdopted) {
      travelMask?.snapshot?.texture.destroy();
    }
  }
}

/**
 * Build the app for the coordinate `location.search` names, retiring whatever was there.
 *
 * Every entry point goes through here — boot, Back/Forward, a committed travel — because all
 * three are "the URL changed, enter it". The generation counter makes the latest call win: an
 * older init that finishes late throws at its next checkpoint instead of installing a stale scene.
 */
async function start(): Promise<void> {
  const attempt = ++bootGeneration;
  const previous = app;
  app = null;
  ready = false;
  previous?.dispose();

  try {
    app = await init(attempt);
  } catch (error) {
    // A superseded attempt must not paint a fatal panel over the newer one.
    if (disposed || attempt !== bootGeneration) return;
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
    clearPendingMask();
    app?.dispose();
    app = null;
  });
}

void start();

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