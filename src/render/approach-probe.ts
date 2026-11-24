/**
 * Approach probe - can the camera walk from a frame's origin down to a body without the frame
 * needing to rebase onto that body?
 *
 * The Layer 4 council gated the *focus* rebase on this measurement (`council-layer-4.md` §8).
 * Under ADR-0003 a frame's origin is its address node; if approach stays inside one frame, the
 * origin never has to move to a body, and the second representation a moving origin would need
 * never exists.
 *
 * This is not a bound derived on paper. It builds the real scene frame (`buildSceneFrame`),
 * rounds every body's camera-relative centre to float32 exactly as the instance buffer does
 * (`renderer.ts` writes `planet.center` straight into a `Float32Array`), and projects both the
 * exact and the rounded value to pixels. The difference is what the eye would see.
 *
 * The numbers are small for a reason worth stating: the stage divides by the system's own scale
 * *before* rounding, so every float32 value is an offset inside the frame - about one unit
 * across - never an absolute coordinate. The precision floor is therefore a property of the
 * frame, not of where the frame sits in the universe. That is what ADR-0008's camera-relative
 * path bought, and it is why "the origin is far away" is not by itself a precision problem.
 */

import { f32Ulp } from '../frame/position';
import type { Camera } from '../state/url-state';
import { displayBodyRadius, displayPosition, type Planet, type StarSystem } from '../universe/system';
import { FOV_Y_RAD, projectPoint, type Vec3 } from './camera';
import {
  NEAR_UNITS,
  STAR_CORE_RADIUS,
  STAR_DISPLAY_RADIUS,
  buildSceneFrame,
  displayScaleM,
} from './system-scene';

/**
 * How far out to start, in multiples of the body's **drawn** radius. 1000 is a wide establishing
 * shot; 1.05 is just outside the drawn surface, which is the closest a camera can get without
 * being inside the sphere.
 *
 * Multiples of the drawn radius, not metres, because the orrery exaggerates bodies by a large and
 * per-class factor: "two Earth radii" and "two drawn radii" are different pictures.
 */
export const APPROACH_RADII: readonly number[] = Object.freeze([
  1000, 300, 100, 30, 10, 5, 3, 2, 1.5, 1.05,
]);

/**
 * A body must not move by a whole pixel. Half a pixel is the bar: below it the displacement is
 * sub-pixel at any device pixel ratio, so rounding cannot change which pixel gets drawn.
 */
export const APPROACH_MAX_POSITION_ERROR_PX = 0.5;

/**
 * At least 64 distinct float32 values across the drawn disc. Below that the sphere's silhouette
 * and vertex positions quantise into visible facets even though its centre is placed correctly.
 */
export const APPROACH_MIN_ULPS_ACROSS_DISC = 64;

/**
 * Four approach directions. One ray would make a single lucky geometry the whole claim; these are
 * deliberately not aligned with the axis from the star to the body, so they are not all "approach
 * through the corona".
 */
export const APPROACH_DIRECTIONS: readonly Vec3[] = Object.freeze([
  normalise({ x: 0.3, y: 0.5, z: 0.8 }),
  normalise({ x: -0.7, y: 0.2, z: 0.68 }),
  normalise({ x: 0.1, y: -0.9, z: 0.42 }),
  normalise({ x: 0.9, y: 0.1, z: -0.42 }),
]);

export interface ApproachSample {
  readonly bodyIndex: number;
  readonly bodyName: string;
  /** Multiples of the drawn radius: 1000 is a wide shot, 1.05 is grazing the surface. */
  readonly radiiOut: number;
  readonly direction: Vec3;
  /** Camera to body centre, in display units (the units the GPU receives). */
  readonly cameraDistanceUnits: number;
  /** Apparent diameter of the drawn disc, in pixels. */
  readonly bodyDiameterPx: number;
  /** float32 rounding of the centre, projected - the number that decides this question. */
  readonly positionErrorPx: number;
  /** The same error in metres, for a sanity check against the HUD's own units. */
  readonly positionErrorM: number;
  /** float32 steps available across the drawn diameter. Fewer means a facetted silhouette. */
  readonly ulpsAcrossDisc: number;
  /** Reverse-Z depth: 1 is the near plane, 0 is infinity. At or above 1 the body is clipped. */
  readonly reverseZDepth: number;
  /** True when the camera is inside the star's corona billboard: the sprite passes through it. */
  readonly insideStarGlare: boolean;
  /** True when the camera is inside the opaque, depth-writing core. Worse than the glare. */
  readonly insideStarCore: boolean;
}

export interface ApproachReport {
  readonly width: number;
  readonly height: number;
  readonly focalPx: number;
  readonly samples: readonly ApproachSample[];
  readonly worstPositionErrorPx: number;
  readonly worstPositionErrorM: number;
  readonly fewestUlpsAcrossDisc: number;
  readonly smallestBodyPx: number;
  readonly maxReverseZDepth: number;
  /** Samples whose camera ended up inside the corona billboard. Not a failure; recorded. */
  readonly glareSamples: number;
  readonly coreSamples: number;
  /** The verdict, and the reasons it did not hold (empty when it did). */
  readonly holds: boolean;
  readonly failures: readonly string[];
}

export interface ApproachOptions {
  readonly width?: number;
  readonly height?: number;
  readonly timeSeconds?: number;
  readonly radii?: readonly number[];
  readonly directions?: readonly Vec3[];
}

/**
 * Measure every body of `system` at every approach radius, from every direction.
 *
 * Defaults are 1920x1080 at t = 0, which is the capture harness's baseline. The height matters
 * because the focal length comes from the viewport; the width only through the aspect ratio.
 */
export function approachReport(system: StarSystem, options: ApproachOptions = {}): ApproachReport {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const timeSeconds = options.timeSeconds ?? 0;
  const radii = options.radii ?? APPROACH_RADII;
  const directions = options.directions ?? APPROACH_DIRECTIONS;

  const scale = displayScaleM(system);
  const focalPx = height / (2 * Math.tan(FOV_Y_RAD / 2));
  const samples: ApproachSample[] = [];

  system.planets.forEach((planet, position) => {
    const radiusUnits = displayBodyRadius(planet, system);
    const radiusM = radiusUnits * scale;
    const world = displayPosition(planet, system, timeSeconds);

    for (const radiiOut of radii) {
      for (const direction of directions) {
        const camera = aimFrom(
          {
            x: world.x + direction.x * radiiOut * radiusM,
            y: world.y + direction.y * radiiOut * radiusM,
            z: world.z + direction.z * radiiOut * radiusM,
          },
          world,
        );

        const frame = buildSceneFrame(system, camera, timeSeconds, width / height, height);
        const body = frame.planets[position];
        if (!body) throw new Error(`scene frame is missing body ${planet.index}`);

        const exact = projectPoint(frame.viewProjection, body.center);
        const rounded = projectPoint(frame.viewProjection, fround3(body.center));
        const dx = (rounded.x - exact.x) * 0.5 * width;
        const dy = (rounded.y - exact.y) * 0.5 * height;

        const cameraDistanceUnits = Math.hypot(body.center.x, body.center.y, body.center.z);
        const starDistanceUnits = Math.hypot(
          frame.starCenter.x,
          frame.starCenter.y,
          frame.starCenter.z,
        );

        samples.push({
          bodyIndex: planet.index,
          bodyName: planet.name,
          radiiOut,
          direction,
          cameraDistanceUnits,
          bodyDiameterPx: (2 * body.radius * focalPx) / Math.max(cameraDistanceUnits, 1e-12),
          positionErrorPx: Math.hypot(dx, dy),
          positionErrorM: maxComponent(fround3(body.center), body.center) * scale,
          ulpsAcrossDisc: (2 * body.radius) / Math.max(f32Ulp(magnitude(body.center)), 1e-300),
          reverseZDepth: exact.depth,
          insideStarGlare: starDistanceUnits < STAR_DISPLAY_RADIUS,
          insideStarCore: starDistanceUnits < STAR_CORE_RADIUS,
        });
      }
    }
  });

  const worstPositionErrorPx = samples.reduce((worst, s) => Math.max(worst, s.positionErrorPx), 0);
  const worstPositionErrorM = samples.reduce((worst, s) => Math.max(worst, s.positionErrorM), 0);
  const fewestUlpsAcrossDisc = samples.reduce(
    (fewest, s) => Math.min(fewest, s.ulpsAcrossDisc),
    Infinity,
  );
  const smallestBodyPx = samples.reduce((smallest, s) => Math.min(smallest, s.bodyDiameterPx), Infinity);
  const maxReverseZDepth = samples.reduce((deepest, s) => Math.max(deepest, s.reverseZDepth), 0);

  const failures: string[] = [];
  if (worstPositionErrorPx > APPROACH_MAX_POSITION_ERROR_PX) {
    failures.push(
      `a body moves ${worstPositionErrorPx.toExponential(2)} px from float32 rounding ` +
        `(bar: ${APPROACH_MAX_POSITION_ERROR_PX} px)`,
    );
  }
  if (fewestUlpsAcrossDisc < APPROACH_MIN_ULPS_ACROSS_DISC) {
    failures.push(
      `only ${fewestUlpsAcrossDisc.toFixed(0)} float32 steps span a drawn disc ` +
        `(bar: ${APPROACH_MIN_ULPS_ACROSS_DISC})`,
    );
  }
  if (maxReverseZDepth >= 1) {
    failures.push(`a body sits at reverse-Z depth ${maxReverseZDepth.toFixed(3)} (the near plane)`);
  }

  return {
    width,
    height,
    focalPx,
    samples,
    worstPositionErrorPx,
    worstPositionErrorM,
    fewestUlpsAcrossDisc,
    smallestBodyPx,
    maxReverseZDepth,
    glareSamples: samples.filter((s) => s.insideStarGlare).length,
    coreSamples: samples.filter((s) => s.insideStarCore).length,
    holds: failures.length === 0,
    failures,
  };
}

export interface TrueScaleReach {
  /** The body's real radius, in the system's display units. */
  readonly realRadiusUnits: number;
  readonly nearUnits: number;
  /**
   * The near plane measured in body radii. Above 1 the camera is a long way out before the
   * surface can be drawn at all, which is why bodies are exaggerated and why landing is its own
   * layer rather than a camera move.
   */
  readonly nearInBodyRadii: number;
}

/**
 * How far the near plane is, in real body radii. This is the honest counterweight to the pass
 * above: approach is precise, but at **true scale** the near plane cannot reach a surface, so
 * "fly to a planet and land" is not a rebase question - it is a depth-range question for Layer 6.
 */
export function trueScaleReach(system: StarSystem, planet: Planet): TrueScaleReach {
  const realRadiusUnits = planet.radiusM / displayScaleM(system);
  return {
    realRadiusUnits,
    nearUnits: NEAR_UNITS,
    nearInBodyRadii: NEAR_UNITS / Math.max(realRadiusUnits, 1e-300),
  };
}

/** Point a camera at `at` from `from`. Matches `cameraBasis`: yaw 0, pitch 0 looks down -z. */
export function aimFrom(from: Vec3, at: Vec3): Camera {
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  const dz = at.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 0)) return { ...from, yaw: 0, pitch: 0 };

  const forward = { x: dx / length, y: dy / length, z: dz / length };
  const pitch = Math.asin(clamp(forward.y, -1, 1));
  const cosPitch = Math.cos(pitch);
  // Looking straight up or down leaves yaw arbitrary; 0 is stable and costs nothing.
  const yaw = Math.abs(cosPitch) < 1e-9 ? 0 : Math.atan2(-forward.x, -forward.z);
  return { x: from.x, y: from.y, z: from.z, yaw, pitch };
}

function fround3(v: Vec3): Vec3 {
  return { x: Math.fround(v.x), y: Math.fround(v.y), z: Math.fround(v.z) };
}

function magnitude(v: Vec3): number {
  return Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
}

function maxComponent(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}