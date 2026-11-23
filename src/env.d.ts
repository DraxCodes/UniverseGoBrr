/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface UniverseDebugState {
  seed: string;
  epoch: string;
  address: string;
  t: number | null;
  camera: [number, number, number, number, number];
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
}

interface Window {
  __ugb?: UniverseDebug;
  /** Set once per page load, not per HMR update, so the dev-loop check can spot a reload. */
  __ugbPageLoadId?: string;
}