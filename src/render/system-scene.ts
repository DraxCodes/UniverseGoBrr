/**
 * Turns a system plus a camera into the numbers the GPU needs, and nothing else.
 *
 * This is where the orrery distortion, the metre→display-unit conversion, and the ADR-0008 rule
 * all meet. It is deliberately pure so each of those can be tested without a GPU:
 *
 * - **One display unit is the outermost orbit.** At 13 AU across, a planet is 10⁻⁵ of a unit, so
 *   float32 has metres to spare at the near end. The real metre values never reach the GPU.
 * - **Camera-relative subtraction happens here, in doubles**, on metre values, before the divide
 *   by the frame scale. That ordering is the whole of ADR-0008.
 * - **Near plane is a fraction of a unit**, not of the scene's real size, because reverse-Z wants
 *   near/far in the units the vertices are in.
 */

import { cameraBasis, multiply, reverseZProjection, viewFromBasis, type Vec3 } from './camera';
import type { Camera } from '../state/url-state';
import {
  PLANET_CLASS_ID,
  displayBodyRadius,
  displayOrbitRadius,
  displayPosition,
  exaggerationFactor,
  type Planet,
  type StarSystem,
} from '../universe/system';

/** Near plane in display units (1 unit = outermost orbit). 0.2% of the frame. */
export const NEAR_UNITS = 0.002;
/** The star's glare quad, in units. The visible photosphere is much smaller than this. */
export const STAR_DISPLAY_RADIUS = 0.135;
/**
 * The opaque core's radius, in units — the disc that writes depth and occludes. It is held
 * **absolute** (0.075 × 0.55, the size verified against planets crossing the sun) rather than as
 * a fraction of the glare: the glare was later widened to 0.135 for the corona's tail, and the
 * occluder must not grow with it.
 */
export const STAR_CORE_RADIUS = 0.075 * 0.55;

export interface ScenePlanet {
  /** Camera-relative centre, display units. */
  readonly center: Vec3;
  /** Drawn radius, display units. */
  readonly radius: number;
  readonly color: readonly [number, number, number];
  readonly atmosphere: number;
  readonly tiltRad: number;
  /** Rotation angle at `t`, radians. */
  readonly spinRad: number;
  /** Per-planet noise seed, for the surface pattern. */
  readonly surfaceSeed: number;
  /** Surface class as the shader's ABI number (`PLANET_CLASS_ID`). */
  readonly surfaceClass: number;
  /** Real values, for the HUD: not used by the GPU. */
  readonly realRadiusM: number;
  readonly semiMajorAxisM: number;
  readonly exaggeration: number;
}

export interface SceneFrame {
  readonly viewProjection: Float32Array;
  /** Camera-relative star centre, display units. */
  readonly starCenter: Vec3;
  readonly starRadius: number;
  /** Radius of the opaque, depth-writing core. Everything behind it is occluded. */
  readonly starCoreRadius: number;
  readonly starColor: readonly [number, number, number];
  readonly planets: readonly ScenePlanet[];
  /** Orbit radii in display units, one per planet, outermost last. */
  readonly orbitRadii: readonly number[];
  readonly nearUnits: number;
}

/** Metres → display units, given the system's outermost orbit. */
export function displayScaleM(system: StarSystem): number {
  const outermost = system.planets[system.planets.length - 1];
  return outermost ? outermost.semiMajorAxisM : 1;
}

export function buildSceneFrame(
  system: StarSystem,
  camera: Camera,
  timeSeconds: number,
  aspect: number,
): SceneFrame {
  const scale = displayScaleM(system);
  const basis = cameraBasis(camera.yaw, camera.pitch);
  const viewProjection = multiply(reverseZProjection(aspect, NEAR_UNITS), viewFromBasis(basis));

  // The camera is at (camera.x, camera.y, camera.z) in metres; every object is expressed as
  // `(objectMetres - cameraMetres) / scale`. Both subtractions are doubles, so the result is
  // small even when the camera is 10¹¹ m from the origin.
  const relative = (wx: number, wy: number, wz: number): Vec3 => ({
    x: (wx - camera.x) / scale,
    y: (wy - camera.y) / scale,
    z: (wz - camera.z) / scale,
  });

  const planets = system.planets.map((planet) => {
    const world = displayPosition(planet, system, timeSeconds);
    return {
      center: relative(world.x, world.y, world.z),
      radius: displayBodyRadius(planet, system),
      color: planetColor(planet),
      atmosphere: planet.atmosphere,
      tiltRad: planet.tiltRad,
      spinRad: (2 * Math.PI * timeSeconds) / planet.spinPeriodS,
      surfaceSeed: planet.surfaceSeed,
      surfaceClass: PLANET_CLASS_ID[planet.class],
      realRadiusM: planet.radiusM,
      semiMajorAxisM: planet.semiMajorAxisM,
      exaggeration: exaggerationFactor(planet, system),
    } satisfies ScenePlanet;
  });

  return {
    viewProjection,
    starCenter: relative(0, 0, 0),
    starRadius: STAR_DISPLAY_RADIUS,
    starCoreRadius: STAR_CORE_RADIUS,
    starColor: system.star.color,
    planets,
    orbitRadii: system.planets.map((planet) => displayOrbitRadius(planet, system)),
    nearUnits: NEAR_UNITS,
  };
}

/**
 * Hue → a damped, slightly desaturated RGB. Planet surfaces are muted on purpose: saturated
 * spheres read as billiard balls rather than worlds, and the star is the only saturated thing.
 */
/**
 * Surface colour is chosen **by class**, not from the whole hue wheel. A random hue gives candy
 * planets — a green gas giant, a magenta ice world — and the eye reads "wrong" before it can say
 * why. Real bodies cluster: gas giants amber and cream, ice worlds pale blue, rock rust and grey,
 * oceans blue-green. `planet.hue` is the variation *within* that band, so the generator stays
 * honest and the palette stays presentation.
 */
const CLASS_PALETTE: Readonly<Record<Planet['class'], readonly [number, number]>> = Object.freeze({
  gas: [0.045, 0.115],
  ice: [0.50, 0.60],
  ocean: [0.33, 0.40],
  rock: [0.015, 0.075],
  'super-earth': [0.055, 0.125],
});

export function planetColor(planet: Planet): [number, number, number] {
  const band = CLASS_PALETTE[planet.class];
  // One gas giant in six is a cold blue world, which is the exception that keeps the family from
  // looking like a single planet recoloured.
  if (planet.class === 'gas' && planet.hue > 0.84) return hueToRgb(0.54 + (planet.hue - 0.84) * 0.5);
  return hueToRgb(band[0] + (band[1] - band[0]) * planet.hue);
}

export function hueToRgb(hue: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1;
  const sector = h * 6;
  const fraction = sector - Math.floor(sector);
  const value = 0.55;
  const saturation = 0.45;
  const p = value * (1 - saturation);
  const q = value * (1 - saturation * fraction);
  const t = value * (1 - saturation * (1 - fraction));

  switch (Math.floor(sector) % 6) {
    case 0:
      return [value, t, p];
    case 1:
      return [q, value, p];
    case 2:
      return [p, value, t];
    case 3:
      return [p, q, value];
    case 4:
      return [t, p, value];
    default:
      return [value, p, q];
  }
}

/** Default framing: high enough to see the orbits, close enough that the star has presence. */
export function defaultSystemCamera(system: StarSystem): Camera {
  const scale = displayScaleM(system);
  // Tuned against the near edge of the outermost orbit, which is the part that clips first.
  // With the eye at (0, 1.33, 1.79)·scale and pitch aimed at the origin, that edge projects to
  // |ndc.y| ≈ 0.90 at 16:9 — the ring fills the frame without touching it. A test pins this.
  return {
    x: 0,
    y: 1.33 * scale,
    z: 1.79 * scale,
    yaw: 0,
    pitch: -Math.atan2(1.33, 1.79),
  };
}