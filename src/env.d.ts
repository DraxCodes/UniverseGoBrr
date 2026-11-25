/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface UniverseDebugState {
  seed: string;
  epoch: string;
  address: string;
  /** The compass pin: where the last committed travel started, or null. */
  from: string | null;
  t: number | null;
  camera: [number, number, number, number, number];
  /** The frame-local point the camera looks at; `[0,0,0]` until the view is panned. */
  target: readonly [number, number, number];
  precision: 'fixed' | 'naive' | null;
}

interface UniversePrecisionPath {
  /** Largest error against the exact double-precision offset, in metres. */
  worstErrorM: number;
  /** Largest distance between two marker centres on screen, in CSS pixels. */
  spreadPx: number;
  markers: ReadonlyArray<{ label: string; px: readonly [number, number] }>;
}

interface UniversePrecisionReport {
  width: number;
  height: number;
  originDistanceM: number;
  paths: { fixed: UniversePrecisionPath; naive: UniversePrecisionPath };
}

interface UniverseTravelResult {
  ok: boolean;
  reason: string | null;
  method: 'impulse' | 'warp' | 'transwarp' | 'hyperspace' | 'wormhole' | null;
  distanceM: number | null;
  elapsedS: number | null;
}

interface UniverseNavigationResult {
  ok: boolean;
  reason: string | null;
}

interface UniverseCompassRow {
  address: string;
  label: string;
  note: string | null;
  distanceM: number;
}

interface UniverseDebug {
  readonly ready: boolean;
  readonly error: string | null;
  readonly pageLoadId: string;
  readonly bootId: string;
  readonly deviceId: string;
  readonly frame: number;
  readonly pipelineGeneration: number;
  readonly fps: number;
  /** The impostor budget currently in use (the watchdog may drop it). */
  readonly tier: 'rich' | 'medium' | 'low';
  /** The current crossfade and population, or null in probe mode. */
  readonly galaxy: {
    lod: number;
    contrast: number;
    count: number;
    tier: 'rich' | 'medium' | 'low';
    /** Galactic centre relative to the home star, metres. */
    centre: readonly [number, number, number] | null;
  } | null;
  readonly state: UniverseDebugState;
  /** Null unless the URL asked for `precision=fixed` or `precision=naive`. */
  readonly precisionReport: UniversePrecisionReport | null;
  sampleCanvas(): Promise<{ mean: number; stdev: number; samples: number }>;
  /** Debug only: stall the next N frames so the tier watchdog can be observed. */
  forceSlowFrames(frames: number): void;
  /** Commit a travel to `to`; the compass rows call the same path. */
  travel(to: string): UniverseTravelResult;
  /** Follow an address line: free zoom-out to that ancestor depth (ADR-0013). */
  zoomOut(depth: number): UniverseNavigationResult;
  /** The compass rows the HUD is showing, in order. */
  readonly compass: readonly UniverseCompassRow[];
  /** Browser history depth, so a capture can prove a framing write did not grow it. */
  readonly historyLength: number;
}

interface Window {
  __ugb?: UniverseDebug;
  /** Set once per page load, not per HMR update, so the dev-loop check can spot a reload. */
  __ugbPageLoadId?: string;
}