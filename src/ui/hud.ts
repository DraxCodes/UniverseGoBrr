import { describeAdapter, type GpuContext } from '../gpu/device';
import { formatAddress, type Address } from '../frame/address';
import type { Vec3 } from '../frame/position';
import { AU_M } from '../universe/system';
import { bearingOf } from '../universe/navigation';
import type { PrecisionMode, PrecisionReport } from '../frame/precision-probe';
import { formatMetres } from '../lib/format';
import {
  formatNumber,
  clockSeconds,
  formatEpoch,
  type Camera,
  type UrlState,
} from '../state/url-state';

/** One row of the compass: a drawn star, where it is, and how to get there. */
export interface CompassEntry {
  readonly address: Address;
  /** "v1/0.9", or "home star" — the home star's address is the galaxy's. */
  readonly label: string;
  /** Metres from this place. */
  readonly distanceM: number;
  /** Offset from this place's origin, so the bearing can be recomputed as the eye turns. */
  readonly offset: Vec3;
  /** "home" / "came from"; `null` for an ordinary neighbour. */
  readonly note: string | null;
}

/** What the HUD's address lines and compass rows do. Both are user navigation, not framing. */
export interface HudHandlers {
  /** Follow an address line; `depth` is the number of levels the target keeps. */
  zoomOut(depth: number): void;
  travelTo(address: Address): void;
}

export interface Hud {
  setStatus(text: string): void;
  setGpu(gpu: GpuContext): void;
  setClock(timeSeconds: number, pinned: boolean): void;
  setCamera(camera: Camera): void;
  /** What the scene exaggerates, e.g. "M-type star · 8 planets · bodies drawn ×353–×1019". */
  setScene(text: string): void;
  /** The compass's rows. Called once per navigation; bearings follow `setCamera`. */
  setCompass(entries: readonly CompassEntry[]): void;
  setPrecision(report: PrecisionReport | null, mode: PrecisionMode | null): void;
  setPipeline(generation: number, error: string | null): void;
  setFps(fps: number): void;
  /** Transient control feedback (e.g. "max zoom"); auto-hides. */
  notice(text: string): void;
}

export function mountHud(
  state: UrlState,
  issues: readonly string[],
  handlers: HudHandlers,
): Hud {
  const statusEl = byId('hud-status');
  const seedEl = byId('hud-seed');
  const epochEl = byId('hud-epoch');
  const addressEl = byId('hud-address');
  const timeEl = byId('hud-time');
  const cameraEl = byId('hud-camera');
  const viewEl = byId('hud-view');
  const precisionEl = byId('hud-precision');
  const sceneEl = byId('hud-scene');
  const captionEl = byId('probe-caption');
  const gpuEl = byId('hud-gpu');
  const pipelineEl = byId('hud-pipeline');
  const fpsEl = byId('hud-fps');
  const issuesEl = byId('hud-issues');
  const noticeEl = byId('hud-notice');
  const compassEl = byId('hud-compass');

  const urlIssues = [...issues];
  let shaderError: string | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let camera = state.camera;
  let entries: readonly CompassEntry[] = [];
  /** The rows whose bearing text is rewritten on every camera change. */
  let bearingEls: { el: HTMLElement; offset: Vec3 }[] = [];

  // A fatal panel can be left over from a previous HMR attempt; this mount owns the page.
  byId('fatal').hidden = true;
  byId('hud').hidden = false;

  seedEl.textContent = state.seed;
  epochEl.textContent = formatEpoch(state.epochMs);
  renderAddress();

  /**
   * The address as clickable lines (spec §5: "each line clickable to zoom out").
   *
   * The version is the root and the last level is where you are. Every line that is not the
   * current place is a button: a line that cannot be followed (the root, a level whose scale is
   * unknown) still answers with the reason, which teaches the model better than a dead label.
   */
  function renderAddress(): void {
    addressEl.textContent = '';
    const atRoot = state.address.levels.length === 0;
    const segment = (text: string, depth: number | null): void => {
      if (addressEl.childElementCount > 0) {
        const slash = document.createElement('span');
        slash.className = 'hud__slash';
        slash.textContent = '/';
        addressEl.append(slash);
      }
      if (depth === null) {
        const current = document.createElement('span');
        current.className = 'hud__here';
        current.textContent = text;
        current.title = 'you are here';
        addressEl.append(current);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hud__crumb';
      button.textContent = text;
      button.title = `zoom out to v${state.address.version}/${state.address.levels
        .slice(0, depth)
        .join('.')}`;
      button.addEventListener('click', () => handlers.zoomOut(depth));
      addressEl.append(button);
    };

    // At the root there is no level to be "here", so the version itself is the current place.
    segment(`v${state.address.version}`, atRoot ? null : 0);
    state.address.levels.forEach((level, index) => {
      const depth = index + 1;
      const isCurrent = depth === state.address.levels.length;
      segment(String(level), isCurrent ? null : depth);
    });
  }

  function renderCompass(): void {
    compassEl.textContent = '';
    bearingEls = [];
    if (entries.length === 0) {
      compassEl.hidden = true;
      return;
    }
    compassEl.hidden = false;

    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'hud__anchor';
      row.dataset.address = formatAddress(entry.address);

      const name = document.createElement('span');
      name.className = 'hud__anchor-name';
      name.textContent = entry.note === null ? entry.label : `${entry.label} · ${entry.note}`;
      name.title = formatAddress(entry.address);

      const bearing = document.createElement('span');
      bearing.className = 'hud__anchor-bearing';
      bearingEls.push({ el: bearing, offset: entry.offset });

      const distance = document.createElement('span');
      distance.className = 'hud__anchor-distance';
      distance.textContent = formatDistance(entry.distanceM);
      distance.title = `${formatMetres(entry.distanceM)} from this place`;

      row.append(name, bearing, distance);
      row.addEventListener('click', () => handlers.travelTo(entry.address));
      compassEl.append(row);
    }

    updateBearings();
  }

  function updateBearings(): void {
    for (const { el, offset } of bearingEls) {
      const { bearingRad, elevationRad } = bearingOf(camera, offset);
      el.textContent = formatBearing(bearingRad);
      el.title = `bearing ${formatBearing(bearingRad)}, elevation ${formatBearing(
        elevationRad,
      )} from the eye`;
    }
  }

  function renderIssues(): void {
    const lines = [...urlIssues];
    if (shaderError) lines.push(`shader: ${shaderError.split('\n')[0] ?? shaderError}`);
    issuesEl.textContent = lines.join('\n');
    issuesEl.hidden = lines.length === 0;
  }

  function setCamera(next: Camera): void {
    camera = next;
    const f = (value: number): string => {
      // A system camera sits at 10¹¹ m, where six decimals of metres is noise and fifteen digits
      // is unreadable. Format by magnitude: light-years out at galaxy scale, AU inside it.
      const magnitude = Math.abs(value);
      if (magnitude >= 0.05 * LY_M) return `${(value / LY_M).toFixed(1)} ly`;
      return magnitude >= 1e6
        ? `${(value / AU_M).toFixed(1)} AU`
        : formatNumber(Number(value.toFixed(1)));
    };
    const angle = (value: number): string => formatNumber(Number(value.toFixed(2)));
    // Position and angles are separate rows: an eye 20 AU out plus yaw/pitch on one line ran
    // past the HUD's fixed width at 1920 and clipped the pitch value mid-number.
    cameraEl.textContent = `${f(camera.x)}, ${f(camera.y)}, ${f(camera.z)}`;
    viewEl.textContent = `yaw ${angle(camera.yaw)}, pitch ${angle(camera.pitch)}`;
    // The compass is a direction, so its numbers follow the eye rather than the place.
    updateBearings();
  }

  function setScene(text: string): void {
    sceneEl.textContent = text;
  }

  function setClock(timeSeconds: number, pinned: boolean): void {
    timeEl.textContent = `${signed(timeSeconds)} s · ${pinned ? 'pinned' : 'live'}`;
  }

  function setPrecision(report: PrecisionReport | null, mode: PrecisionMode | null): void {
    if (!report || !mode) {
      precisionEl.textContent = 'normal scene';
      precisionEl.classList.remove('hud__precision--error', 'hud__precision--probe');
      captionEl.hidden = true;
      return;
    }

    const path = report.paths[mode];
    const other = report.paths[mode === 'fixed' ? 'naive' : 'fixed'];
    // One short line each, because the comparison is the evidence: the second line is what
    // this frame would look like without the fix.
    precisionEl.textContent = `${mode} · ${path.spreadPx.toFixed(0)} px · ${formatMetres(path.worstErrorM)}
${mode === 'fixed' ? 'naive' : 'fixed'} · ${other.spreadPx.toFixed(0)} px · ${formatMetres(other.worstErrorM)}`;
    precisionEl.title =
      `Marker spread in CSS px and worst positional error, in a frame whose origin is ` +
      `${formatMetres(report.originDistanceM)} from the camera (${report.width}×${report.height}).`;

    // The screenshot has to explain itself: a viewer who opens the PNG without the HUD needs
    // to know whether the three markers should be together or apart.
    const count = path.markers.length;
    captionEl.textContent =
      mode === 'naive'
        ? `precision probe · naive float32 · ${count} markers, ${path.spreadPx.toFixed(0)} px apart — collapsed onto one point`
        : `precision probe · camera-relative · ${count} markers, ${path.spreadPx.toFixed(0)} px apart`;
    captionEl.hidden = false;
    captionEl.classList.toggle('probe-caption--error', mode === 'naive');

    // Red when the path on screen is the broken one: the negative control must look wrong.
    precisionEl.classList.add('hud__precision--probe');
    precisionEl.classList.toggle('hud__precision--error', mode === 'naive');
  }

  function setPipeline(generation: number, error: string | null): void {
    shaderError = error;
    pipelineEl.textContent = error
      ? `gen ${generation} · shader error, previous still live`
      : `gen ${generation}`;
    pipelineEl.classList.toggle('hud__pipeline--error', Boolean(error));
    renderIssues();
  }

  setCamera(state.camera);
  setClock(clockSeconds(state, Date.now()), state.t !== null);
  setPrecision(null, state.precision);
  renderIssues();

  return {
    setStatus(text) {
      statusEl.textContent = text;
    },
    setGpu(gpu) {
      gpuEl.textContent = describeAdapter(gpu.info);
    },
    setClock,
    setCamera,
    setScene,
    setCompass(next) {
      entries = next;
      renderCompass();
    },
    setPrecision,
    setPipeline,
    setFps(value) {
      fpsEl.textContent = `${Math.round(value)}`;
    },
    notice(text) {
      noticeEl.textContent = text;
      noticeEl.hidden = false;
      if (noticeTimer !== null) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        noticeTimer = null;
        noticeEl.hidden = true;
      }, 1200);
    },
  };
}

/** The light-year in metres; a camera or a star at 10¹⁷ m is unreadable in metres. */
const LY_M = 9.460_730_472_580_8e15;

/**
 * A distance at the magnitude it reads at: a body in metres, a neighbour in AU, a star in light
 * years. One decimal, because the number is a bearing aid, not a measurement.
 */
function formatDistance(metres: number): string {
  const ly = metres / LY_M;
  if (ly >= 0.05) return `${ly.toFixed(1)} ly`;
  if (metres >= 1e6) return `${(metres / AU_M).toFixed(1)} AU`;
  return `${formatNumber(Number(metres.toFixed(0)))} m`;
}

/**
 * A bearing as a person turns their head: `+41°` means to the right, `−41°` to the left, `0°`
 * dead ahead. Deliberately relative to the view rather than a compass rose: the app has no north,
 * and inventing one would be a second coordinate system.
 */
function formatBearing(radians: number): string {
  const degrees = (radians * 180) / Math.PI;
  const rounded = Math.round(Math.abs(degrees));
  if (rounded === 0) return '0°';
  return `${degrees > 0 ? '+' : '−'}${rounded}°`;
}

export function showFatal(error: unknown): void {
  const panel = byId('fatal');
  const message = byId('fatal-message');
  const hud = byId('hud');

  message.textContent = error instanceof Error ? error.message : String(error);
  panel.hidden = false;
  hud.hidden = true;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}`;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html`);
  return element;
}