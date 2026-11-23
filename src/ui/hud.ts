import { describeAdapter, type GpuContext } from '../gpu/device';
import { describeAddress } from '../frame/address';
import { AU_M } from '../universe/system';
import type { PrecisionMode, PrecisionReport } from '../frame/precision-probe';
import { formatMetres } from '../lib/format';
import {
  formatNumber,
  clockSeconds,
  formatEpoch,
  type Camera,
  type UrlState,
} from '../state/url-state';

export interface Hud {
  setStatus(text: string): void;
  setGpu(gpu: GpuContext): void;
  setClock(timeSeconds: number, pinned: boolean): void;
  setCamera(camera: Camera): void;
  /** What the scene exaggerates, e.g. "M-type star · 8 planets · bodies drawn ×353–×1019". */
  setScene(text: string): void;
  setPrecision(report: PrecisionReport | null, mode: PrecisionMode | null): void;
  setPipeline(generation: number, error: string | null): void;
  setFps(fps: number): void;
}

export function mountHud(state: UrlState, issues: readonly string[]): Hud {
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

  const urlIssues = [...issues];
  let shaderError: string | null = null;

  // A fatal panel can be left over from a previous HMR attempt; this mount owns the page.
  byId('fatal').hidden = true;
  byId('hud').hidden = false;

  seedEl.textContent = state.seed;
  epochEl.textContent = formatEpoch(state.epochMs);
  addressEl.textContent = describeAddress(state.address);

  function renderIssues(): void {
    const lines = [...urlIssues];
    if (shaderError) lines.push(`shader: ${shaderError.split('\n')[0] ?? shaderError}`);
    issuesEl.textContent = lines.join('\n');
    issuesEl.hidden = lines.length === 0;
  }

  function setCamera(camera: Camera): void {
    const f = (value: number): string => {
      // A system camera sits at 10¹¹ m, where six decimals of metres is noise and fifteen digits
      // is unreadable. Format by magnitude, in AU.
      return Math.abs(value) >= 1e6
        ? `${(value / AU_M).toFixed(1)} AU`
        : formatNumber(Number(value.toFixed(1)));
    };
    const angle = (value: number): string => formatNumber(Number(value.toFixed(2)));
    // Position and angles are separate rows: an eye 20 AU out plus yaw/pitch on one line ran
    // past the HUD's fixed width at 1920 and clipped the pitch value mid-number.
    cameraEl.textContent = `${f(camera.x)}, ${f(camera.y)}, ${f(camera.z)}`;
    viewEl.textContent = `yaw ${angle(camera.yaw)}, pitch ${angle(camera.pitch)}`;
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
    setPrecision,
    setPipeline,
    setFps(value) {
      fpsEl.textContent = `${Math.round(value)}`;
    },
  };
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