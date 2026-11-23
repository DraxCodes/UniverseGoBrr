/**
 * The precision probe: a scene whose only job is to make a coordinate bug visible.
 *
 * Three markers sit at one depth in a frame whose origin is 10¹³ m from the camera — the
 * frame size ADR-0002 names for a star system. The renderer computes their camera-relative
 * positions twice:
 *
 * - `fixed`  — double subtraction, then round to float32. What Layer 1 ships.
 * - `naive`  — round to float32, then subtract. What Layer 0 did, and what any future
 *              "just send the position" change would reintroduce.
 *
 * In `fixed` the markers are ~142 px apart at 1080p. In `naive` all three collapse onto one
 * point, because float32's step at 10¹³ m is ~1.05×10⁶ m and the markers are 1.2×10⁵ m apart.
 * The collapse is not a rendering nicety: it is a marker landing somewhere it is not.
 *
 * Screen positions use a plain perspective divide with the camera looking down +z and no
 * rotation, so the probe isolates precision from every other transform.
 */

import {
  WORLD_ORIGIN,
  maxComponentError,
  toCameraRelative,
  toCameraRelativeF32,
  toCameraRelativeNaiveF32,
  type Position,
  type Vec3,
} from './position';

export type PrecisionMode = 'fixed' | 'naive';

export const PRECISION_MODES: readonly PrecisionMode[] = ['fixed', 'naive'];

/** Horizontal field of view. Passed to the shader through the uniform block. */
export const PROBE_FOV_DEGREES = 70;

/** How far the frame origin is from the camera, in metres. The ADR-0002 system scale. */
export const PROBE_ORIGIN_DISTANCE_M = 1e13;

/** Deliberately not a round number: real geometry is not exactly representable in f32. */
const DEPTH_M = 1_300_000.123;
const LATERAL_STEP_M = 123_456.789;

export interface ProbeMarker {
  readonly label: string;
  readonly position: Position;
}

export interface ProbePath {
  /** Camera-relative metres, float32 — exactly the values the GPU receives. */
  readonly view: readonly Vec3[];
  /** Largest absolute error against the exact double-precision offset, in metres. */
  readonly worstErrorM: number;
}

export interface PrecisionProbe {
  /** The frame origin, in absolute metres. */
  readonly origin: Vec3;
  readonly camera: Position;
  readonly markers: readonly ProbeMarker[];
  readonly paths: Readonly<Record<PrecisionMode, ProbePath>>;
}

export interface ProjectedMarker {
  readonly label: string;
  /** CSS pixels, origin top-left. */
  readonly px: readonly [number, number];
}

export interface PathReport {
  readonly worstErrorM: number;
  readonly spreadPx: number;
  readonly markers: readonly ProjectedMarker[];
}

export interface PrecisionReport {
  readonly width: number;
  readonly height: number;
  /** Distance from the camera to the frame origin, in metres. */
  readonly originDistanceM: number;
  readonly paths: Readonly<Record<PrecisionMode, PathReport>>;
}

export function createPrecisionProbe(): PrecisionProbe {
  // The camera sits 10¹³ m from the frame origin, so every frame-local coordinate is ~10¹³
  // and float32 cannot resolve the metre-scale differences between the markers.
  const origin = WORLD_ORIGIN;
  const cameraLocal = { x: PROBE_ORIGIN_DISTANCE_M, y: 0, z: 0 };
  const camera: Position = { origin, local: cameraLocal };

  const markers: ProbeMarker[] = [0, 1, 2].map((index) => {
    const lateral = index * LATERAL_STEP_M;
    const name = String.fromCharCode(65 + index); // A, B, C
    return {
      label: index === 0 ? 'A · camera axis' : `${name} · +${lateral} m`,
      position: {
        origin,
        local: { x: cameraLocal.x + lateral, y: 0, z: cameraLocal.z + DEPTH_M },
      },
    };
  });

  const exact = markers.map((marker) => toCameraRelative(marker.position, camera));

  function path(project: (target: Position, camera: Position) => Vec3): ProbePath {
    const view = markers.map((marker) => project(marker.position, camera));
    const worstErrorM = view.reduce(
      (worst, actual, index) => Math.max(worst, maxComponentError(actual, exact[index]!)),
      0,
    );
    return { view, worstErrorM };
  }

  return {
    origin,
    camera,
    markers,
    paths: { fixed: path(toCameraRelativeF32), naive: path(toCameraRelativeNaiveF32) },
  };
}

/** The projection constant, so the shader and the readout use one number. */
export function focalLength(): number {
  return 1 / Math.tan((PROBE_FOV_DEGREES * Math.PI) / 360);
}

/**
 * Perspective divide, camera looking down +z. The shader evaluates the same expression on
 * the same float32 values, so reported pixels and drawn pixels agree.
 */
export function projectMarkers(
  view: readonly Vec3[],
  labels: readonly string[],
  width: number,
  height: number,
): readonly ProjectedMarker[] {
  const focal = focalLength();
  const aspect = width / Math.max(height, 1);

  return view.map((point, index) => {
    // z <= 0 would be behind the camera; the probe never places a marker there, but clamping
    // keeps a bad future edit from producing infinities in the readout.
    const depth = Math.max(point.z, 1e-6);
    const ndcX = ((point.x / depth) * focal) / aspect;
    const ndcY = (point.y / depth) * focal;
    return {
      label: labels[index] ?? `marker ${index}`,
      px: [(ndcX * 0.5 + 0.5) * width, (0.5 - ndcY * 0.5) * height],
    };
  });
}

export function spreadPx(markers: readonly ProjectedMarker[]): number {
  let spread = 0;
  for (let a = 0; a < markers.length; a += 1) {
    for (let b = a + 1; b < markers.length; b += 1) {
      const first = markers[a]!.px;
      const second = markers[b]!.px;
      spread = Math.max(spread, Math.hypot(first[0] - second[0], first[1] - second[1]));
    }
  }
  return spread;
}

export function precisionReport(
  probe: PrecisionProbe,
  width: number,
  height: number,
): PrecisionReport {
  const labels = probe.markers.map((marker) => marker.label);

  function report(mode: PrecisionMode): PathReport {
    const markers = projectMarkers(probe.paths[mode].view, labels, width, height);
    return {
      worstErrorM: probe.paths[mode].worstErrorM,
      spreadPx: spreadPx(markers),
      markers,
    };
  }

  return {
    width,
    height,
    originDistanceM: Math.abs(probe.camera.local.x - probe.origin.x),
    paths: { fixed: report('fixed'), naive: report('naive') },
  };
}