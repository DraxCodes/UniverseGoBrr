/**
 * Sol, the compare-to-reality anchor (spec §3.6, §8 Q2).
 *
 * This is **data**, not code: real bodies with real radii, real semi-major axes and real periods,
 * fed through the same `StarSystem` shape the procedural generator returns. Nothing downstream
 * knows or cares that this system was authored.
 *
 * What is real here:
 * - the eight planets, their names, radii and semi-major axes;
 * - their periods, computed from the semi-major axis by Kepler's third law with the Sun's mass,
 *   so they are not restated and cannot drift from the axis;
 * - their axial tilts and sidereal rotation periods, including the two retrograde spinners.
 *
 * What is an approximation, stated rather than hidden:
 * - orbits are **circular and coplanar**, because the orrery is (see `system.ts`). Real
 *   eccentricities (Mercury 0.206, Mars 0.093) and inclinations (Mercury 7°) are not drawn. The
 *   phase is the J2000 mean longitude, and on a circular orbit mean longitude *is* the true
 *   anomaly, so positions at the 2000-01-01 epoch are roughly right rather than exact.
 * - moons and the asteroid belt are absent. They are `bodies`-slot work, not this brief.
 */

import {
  AU_M,
  SIZE_FRACTION,
  orbitalPeriodSeconds,
  starProfile,
  type Planet,
  type StarSystem,
} from '../system';

/**
 * The authored node's own version, separate from `SYSTEM_VERSION`.
 *
 * Same lesson as `GALAXY_VERSION` vs `GALAXY_STREAM_VERSION`: tuning Sol's data must not bump the
 * *procedural* generator's version, or every shared procedural link breaks to fix one address.
 * Editing this file bumps this number and only this node.
 */
export const SOL_VERSION = 1;

/**
 * Reserved address for Sol. Chosen as the universe/quadrant/sector at zero with system zero:
 * memorable, and **distinct from every shipped link** (`v1/0` is the desktop shots' default,
 * `v1/4.-2.7` the scored system). No address was repurposed, so no existing shared coordinate
 * changed meaning. Changing this constant moves Sol and breaks links to it — treat it like any
 * other content change.
 */
export const SOL_ADDRESS = 'v1/0.0.0';

interface SolPlanetSpec {
  readonly name: string;
  readonly class: Planet['class'];
  /** Semi-major axis, astronomical units (IAU 2012). */
  readonly semiMajorAxisAu: number;
  /** Mean radius, metres. */
  readonly radiusM: number;
  /** Sidereal rotation period, seconds. Negative is retrograde. */
  readonly spinPeriodS: number;
  /** Axial tilt, degrees. */
  readonly tiltDeg: number;
  /** 0 = airless, 1 = thick. */
  readonly atmosphere: number;
  /** Variation within the class colour band (see `CLASS_PALETTE` in `system-scene.ts`). */
  readonly hue: number;
  readonly surfaceSeed: number;
  /** J2000 mean longitude, degrees. Approximates the true anomaly on a circular orbit. */
  readonly meanLongitudeDeg: number;
}

const DEG = Math.PI / 180;
const HOUR = 3600;
const DAY = 86_400;

/**
 * JPL's planetary fact sheets, mean values. Ordered outward, which the orrery and the HUD both
 * assume. Radiative numbers are the mean radius, not the equatorial radius: the shader draws a
 * sphere, so the mean is the honest single radius to give it.
 */
const PLANETS: readonly SolPlanetSpec[] = Object.freeze([
  {
    name: 'Mercury',
    class: 'rock',
    semiMajorAxisAu: 0.38709893,
    radiusM: 2.4397e6,
    spinPeriodS: 58.646 * DAY,
    tiltDeg: 0.034,
    atmosphere: 0,
    hue: 0.45,
    surfaceSeed: 0.13,
    meanLongitudeDeg: 252.25,
  },
  {
    name: 'Venus',
    class: 'rock',
    semiMajorAxisAu: 0.72333199,
    radiusM: 6.0518e6,
    // 243.025 days, retrograde: the one body whose day is longer than its year.
    spinPeriodS: -243.025 * DAY,
    tiltDeg: 177.4,
    atmosphere: 1.0,
    hue: 0.78,
    surfaceSeed: 0.29,
    meanLongitudeDeg: 181.98,
  },
  {
    name: 'Earth',
    class: 'ocean',
    semiMajorAxisAu: 1.00000011,
    radiusM: 6.371e6,
    spinPeriodS: 23.9344696 * HOUR,
    tiltDeg: 23.439281,
    atmosphere: 0.85,
    hue: 0.3,
    surfaceSeed: 0.5,
    meanLongitudeDeg: 100.46,
  },
  {
    name: 'Mars',
    class: 'rock',
    semiMajorAxisAu: 1.52366231,
    radiusM: 3.3895e6,
    spinPeriodS: 24.622962 * HOUR,
    tiltDeg: 25.19,
    atmosphere: 0.15,
    hue: 0.18,
    surfaceSeed: 0.67,
    meanLongitudeDeg: 355.45,
  },
  {
    name: 'Jupiter',
    class: 'gas',
    semiMajorAxisAu: 5.20336301,
    radiusM: 6.9911e7,
    spinPeriodS: 9.925 * HOUR,
    tiltDeg: 3.13,
    atmosphere: 1.0,
    hue: 0.55,
    surfaceSeed: 0.21,
    meanLongitudeDeg: 34.4,
  },
  {
    name: 'Saturn',
    class: 'gas',
    semiMajorAxisAu: 9.53707032,
    radiusM: 5.8232e7,
    spinPeriodS: 10.656 * HOUR,
    tiltDeg: 26.73,
    atmosphere: 1.0,
    hue: 0.75,
    surfaceSeed: 0.44,
    meanLongitudeDeg: 49.94,
  },
  {
    name: 'Uranus',
    class: 'ice',
    semiMajorAxisAu: 19.19126393,
    radiusM: 2.5362e7,
    // 17.24 hours, retrograde: the sideways world.
    spinPeriodS: -17.24 * HOUR,
    tiltDeg: 97.77,
    atmosphere: 0.8,
    hue: 0.2,
    surfaceSeed: 0.58,
    meanLongitudeDeg: 313.23,
  },
  {
    name: 'Neptune',
    class: 'ice',
    semiMajorAxisAu: 30.06896348,
    radiusM: 2.4622e7,
    spinPeriodS: 16.11 * HOUR,
    tiltDeg: 28.32,
    atmosphere: 0.8,
    hue: 0.7,
    surfaceSeed: 0.82,
    meanLongitudeDeg: 304.88,
  },
]);

function build(): StarSystem {
  const planets: Planet[] = PLANETS.map((spec, index) => {
    // Kepler's third law states the period, so it is derived rather than transcribed: the two
    // cannot disagree, and a typo in one number cannot leave the system internally inconsistent.
    const semiMajorAxisM = spec.semiMajorAxisAu * AU_M;
    return {
      index,
      name: spec.name,
      class: spec.class,
      semiMajorAxisM,
      radiusM: spec.radiusM,
      phaseRad: spec.meanLongitudeDeg * DEG,
      orbitalPeriodS: orbitalPeriodSeconds(semiMajorAxisM),
      spinPeriodS: spec.spinPeriodS,
      tiltRad: spec.tiltDeg * DEG,
      atmosphere: spec.atmosphere,
      hue: spec.hue,
      surfaceSeed: spec.surfaceSeed,
      sizeFraction: SIZE_FRACTION[spec.class],
    };
  });

  // G2V: the generator's own G-class presentation, so a G star looks the same whether it was
  // authored or drawn. The real Sun is 5 772 K; the shader's G profile uses 5 800 and the 28 K
  // difference is far below what the corona can show.
  return { version: SOL_VERSION, star: starProfile('G'), planets };
}

export const SOL_SYSTEM: StarSystem = build();