/**
 * One star system, generated from `(seed, address)` and evaluated at `t`.
 *
 * This is the project's first generated content, so it sets the shape every later layer copies
 * (ADR-0005): **structure** from the address alone, **state** from `t`, both pure, both cached by
 * the caller. Nothing here touches the DOM or the GPU.
 *
 * Plain-language model: a star in the middle, planets on circles around it. The circles are
 * real — their radii, periods and phases are physical — but the *picture* exaggerates the planet
 * sizes and compresses the orbit spacing, because at true scale a planet is a fraction of a pixel
 * from any viewpoint that shows an orbit. ADR-0002's "density dial": truthful structure, legible
 * population. The exaggeration is reported, not hidden.
 */

import { formatAddress, type Address } from '../frame/address';
import { fnv1a32 } from '../lib/hash';
import { createRng } from '../lib/random';
import { withoutSectorRung } from './levels';

/** Bumped whenever the generator's output would change. Old links must break loudly (ADR-0005). */
export const SYSTEM_VERSION = 2;

/** Astronomical unit, metres (IAU 2012). */
export const AU_M = 1.495_978_707e11;
/** Earth radius, metres. */
export const EARTH_RADIUS_M = 6.371e6;
/** One solar mass: `G·M`, m³/s². */
export const GM_SUN = 1.327_124_400_18e20;

export type StarClass = 'M' | 'K' | 'G' | 'F' | 'A';

export interface Star {
  readonly class: StarClass;
  readonly radiusM: number;
  readonly temperatureK: number;
  /** Linear RGB in 0..1, pre-multiplied for the shader. */
  readonly color: readonly [number, number, number];
}

export type PlanetClass = 'rock' | 'super-earth' | 'ice' | 'gas' | 'ocean';

/**
 * The class as the shader receives it. These numbers are a GPU ABI: changing one changes what
 * every stored instance means, so they are named here rather than written as literals in
 * `renderer.ts`.
 */
export const PLANET_CLASS_ID: Readonly<Record<PlanetClass, number>> = Object.freeze({
  rock: 0,
  'super-earth': 1,
  ice: 2,
  gas: 3,
  ocean: 4,
});

export interface Planet {
  /** Stable order index, 0-based. Display name is `b`, `c`, … (exoplanet convention). */
  readonly index: number;
  readonly name: string;
  readonly class: PlanetClass;
  /** Real orbital radius, metres. */
  readonly semiMajorAxisM: number;
  /** Real body radius, metres. */
  readonly radiusM: number;
  /** True anomaly at `t = 0`, radians. */
  readonly phaseRad: number;
  /** Keplerian period, seconds. */
  readonly orbitalPeriodS: number;
  /** Rotation period about its own axis, seconds. Signed: negative orbits retrograde. */
  readonly spinPeriodS: number;
  /** Axial tilt, radians. */
  readonly tiltRad: number;
  /** 0 = airless, 1 = thick. Drives the limb glow in the shader. */
  readonly atmosphere: number;
  /** Hue in 0..1 for the surface tint. */
  readonly hue: number;
  /** Per-planet noise seed, 0..1. Decorrelates one world's continents from another's clouds. */
  readonly surfaceSeed: number;
  /**
   * Rendered radius as a fraction of the *rendered* orbit radius. This is the orrery
   * exaggeration: a real radius this small would be sub-pixel (see the brief).
   */
  readonly sizeFraction: number;
}

export interface StarSystem {
  readonly version: number;
  readonly star: Star;
  readonly planets: readonly Planet[];
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** `T = 2π√(a³/GM)`, Kepler's third law for a one-solar-mass primary. */
export function orbitalPeriodSeconds(semiMajorAxisM: number): number {
  if (semiMajorAxisM <= 0) throw new Error('semi-major axis must be positive');
  return 2 * Math.PI * Math.sqrt((semiMajorAxisM * semiMajorAxisM * semiMajorAxisM) / GM_SUN);
}

/**
 * Structure: everything that does not depend on `t`. Same `(seed, address)` always produces the
 * same system, on any machine, in any order of evaluation.
 */
export function generateSystem(seed: string, address: Address): StarSystem {
  // **The sector rung is transparent to content** (ADR-0023): `v1/4.<sector>.-2.7` keys on exactly
  // the string the same system used before the insertion (`v1/4.-2.7`). Without this, every
  // procedural system's planets and star would re-roll the moment sectors appeared in the address,
  // and the layer-2 captures — which are of a system, not a galaxy — would all become invalid. It
  // is the same mechanic as `placementKey`, one rung down: identity is the address *without* the
  // sector, so a sector is a filing cabinet, not a parent that changes its contents.
  const key = `${seed}|${formatAddress(withoutSectorRung(address))}|system|v${SYSTEM_VERSION}`;
  const rng = createRng(fnv1a32(key));

  const starClass = rng.pick<StarClass>(['M', 'M', 'M', 'M', 'K', 'K', 'K', 'G', 'G', 'F', 'A']);
  const star = starProfile(starClass);

  // Spacing is generated as a geometric progression so gaps never collide, then sorted. A real
  // system's ratios vary wildly; 1.35–2.1 keeps the orrery readable without lookalike systems.
  const count = rng.int(3, 9);
  const semiMajorAxisM: number[] = [];
  let axis = rng.range(0.18, 0.55) * AU_M;
  for (let index = 0; index < count; index += 1) {
    semiMajorAxisM.push(axis);
    axis *= rng.range(1.35, 2.1);
  }

  const planets: Planet[] = semiMajorAxisM.map((semiMajor, index) => {
    // Rocky close in, giants far out, with a chance of an ice world migrating inward.
    const fraction = count === 1 ? 0 : index / (count - 1);
    const planetClass = pickClass(rng, fraction, semiMajor);
    const radiusM = planetRadius(rng, planetClass);

    return {
      index,
      name: String.fromCharCode(98 + index), // b, c, d, …
      class: planetClass,
      semiMajorAxisM: semiMajor,
      radiusM,
      phaseRad: rng.range(0, Math.PI * 2),
      orbitalPeriodS: orbitalPeriodSeconds(semiMajor),
      spinPeriodS: rng.range(6 * 3600, 72 * 3600) * (rng.chance(0.12) ? -1 : 1),
      tiltRad: rng.range(0, 0.45),
      atmosphere: atmosphereFor(rng, planetClass),
      hue: rng.next(),
      surfaceSeed: rng.next(),
      sizeFraction: SIZE_FRACTION[planetClass],
    };
  });

  return { version: SYSTEM_VERSION, star, planets };
}

/**
 * State: where a planet is at `t`. Closed form, so a million years costs one evaluation — this is
 * ADR-0004's "never simulated forward". Orbits are circular and coplanar in the `xz` plane.
 */
export function planetPosition(planet: Planet, tSeconds: number): Vec3 {
  const angle = planet.phaseRad + (2 * Math.PI * tSeconds) / planet.orbitalPeriodS;
  return {
    x: planet.semiMajorAxisM * Math.cos(angle),
    y: 0,
    z: planet.semiMajorAxisM * Math.sin(angle),
  };
}

/**
 * The orrery's horizontal position: `a^0.55`, normalised so the outermost planet sits at 1.
 * Monotone in the real radius, so ordering is preserved; the ratio is deliberately flattened so
 * an inner planet is not a dot inside an outer planet's orbit.
 */
export function displayOrbitRadius(planet: Planet, system: StarSystem): number {
  const outermost = system.planets[system.planets.length - 1];
  if (!outermost) return 0;
  return (planet.semiMajorAxisM / outermost.semiMajorAxisM) ** 0.55;
}

/**
 * Rendered radius in the same normalised units as `displayOrbitRadius`.
 *
 * Deliberately **not** multiplied by the planet's own orbit radius. Doing that made the inner
 * worlds sub-pixel (an inner orbit is 0.12 units, so a 0.010 fraction of it is 0.0012 — under one
 * pixel at any sensible zoom). A fixed fraction of the frame keeps every body legible.
 *
 * The class size is then clamped against the gap to the nearest neighbour: `a^0.55` compresses
 * the inner orbits, so two adjacent worlds can be closer together than the sum of their drawn
 * radii, and overlapping discs read as a rendering bug rather than as two planets.
 */
export function displayBodyRadius(planet: Planet, system: StarSystem): number {
  const orbit = displayOrbitRadius(planet, system);
  let nearestGap = Infinity;
  for (const other of system.planets) {
    if (other.index === planet.index) continue;
    nearestGap = Math.min(nearestGap, Math.abs(displayOrbitRadius(other, system) - orbit));
  }
  if (!Number.isFinite(nearestGap)) return planet.sizeFraction;
  return Math.min(planet.sizeFraction, nearestGap * 0.38);
}

/**
 * Where a planet is drawn at `t`, **in metres but on the compressed orbit**: the angle is the
 * real one from `planetPosition`, the radius is the orrery's. Returning metres keeps one unit
 * system in the scene assembler — the only place the orrery compression lives is the radius.
 */
export function displayPosition(planet: Planet, system: StarSystem, tSeconds: number): Vec3 {
  const outermost = system.planets[system.planets.length - 1];
  if (!outermost) return { x: 0, y: 0, z: 0 };
  const radiusM = displayOrbitRadius(planet, system) * outermost.semiMajorAxisM;
  const angle = planet.phaseRad + (2 * Math.PI * tSeconds) / planet.orbitalPeriodS;
  return {
    x: radiusM * Math.cos(angle),
    y: 0,
    z: radiusM * Math.sin(angle),
  };
}

/** How many times larger than reality the body is drawn. This is the number the HUD prints. */
export function exaggerationFactor(planet: Planet, system: StarSystem): number {
  // Normalised units back to metres: the outermost orbit maps to its real semi-major axis.
  const outermost = system.planets[system.planets.length - 1];
  if (!outermost || outermost.semiMajorAxisM === 0) return 0;
  const metresPerUnit = outermost.semiMajorAxisM;
  const drawnM = displayBodyRadius(planet, system) * metresPerUnit;
  return planet.radiusM > 0 ? drawnM / planet.radiusM : 0;
}

/**
 * One line for the HUD, naming what the picture exaggerates. If this line is missing, nobody can
 * tell an orrery from a true-scale render — which is exactly the confusion the readout exists to
 * prevent.
 */
export function describeSystem(system: StarSystem): string {
  const count = system.planets.length;
  const factors = system.planets.map((planet) => exaggerationFactor(planet, system));
  const low = Math.round(Math.min(...factors));
  const high = Math.round(Math.max(...factors));
  const body = low === high ? `${low}` : `${low}–${high}`;
  // Short on purpose: the HUD row is one line and clipped, and a clipped readout that loses the
  // word "real" would read as a measurement rather than a disclaimer.
  return `${system.star.class}-type · ${count} ${count === 1 ? 'planet' : 'planets'} · ×${body} real`;
}

/**
 * Rendered radius as a fraction of the frame, by class. Exported for the same reason as
 * `starProfile`: authored content (spec §3.6) must draw a gas giant at the generator's size, not
 * at a second copy of the number that can drift.
 */
export const SIZE_FRACTION: Readonly<Record<PlanetClass, number>> = Object.freeze({
  rock: 0.010,
  'super-earth': 0.013,
  ocean: 0.011,
  ice: 0.020,
  gas: 0.030,
});

function pickClass(
  rng: ReturnType<typeof createRng>,
  fraction: number,
  semiMajorAxisM: number,
): PlanetClass {
  // A world can only hold surface water where the star does not boil or freeze it. Placing oceans
  // in the temperate band is not decoration: it is the same rule that makes the inner planets
  // rock and the outer ones ice, applied to one more observable.
  const axisAU = semiMajorAxisM / AU_M;
  if (axisAU > 0.7 && axisAU < 1.9 && rng.chance(0.55)) return 'ocean';

  // Close in: rock dominates. Far out: gas and ice dominate. Encode ordering, not a table.
  if (fraction < 0.34) {
    const roll = rng.next();
    if (roll < 0.7) return 'rock';
    if (roll < 0.93) return 'super-earth';
    return 'ice';
  }
  if (fraction < 0.7) {
    const roll = rng.next();
    if (roll < 0.3) return 'super-earth';
    if (roll < 0.7) return 'ice';
    return 'gas';
  }
  const roll = rng.next();
  return roll < 0.75 ? 'gas' : 'ice';
}

function planetRadius(rng: ReturnType<typeof createRng>, planetClass: PlanetClass): number {
  switch (planetClass) {
    case 'rock':
      return rng.range(0.28, 1.35) * EARTH_RADIUS_M;
    case 'ocean':
      // Terrestrial, but water-rich worlds run a little larger than bare rock.
      return rng.range(0.85, 1.6) * EARTH_RADIUS_M;
    case 'super-earth':
      return rng.range(1.35, 2.6) * EARTH_RADIUS_M;
    case 'ice':
      return rng.range(2.5, 6.0) * EARTH_RADIUS_M;
    case 'gas':
      return rng.range(6.0, 12.0) * EARTH_RADIUS_M;
  }
}

function atmosphereFor(rng: ReturnType<typeof createRng>, planetClass: PlanetClass): number {
  switch (planetClass) {
    case 'rock':
      return rng.chance(0.45) ? rng.range(0.05, 0.3) : 0;
    case 'ocean':
      // A surface ocean needs an atmosphere to exist; this is the one class where it is a rule.
      return rng.range(0.55, 0.9);
    case 'super-earth':
      return rng.range(0.2, 0.6);
    case 'ice':
      return rng.range(0.4, 0.85);
    case 'gas':
      return rng.range(0.8, 1);
  }
}

/**
 * The star's presentation for a spectral class. Exported so authored content (spec §3.6) uses the
 * *same* definition as the generator rather than restating a colour and drifting from it.
 */
export function starProfile(starClass: StarClass): Star {
  // Approximate main-sequence values. Colour is linear RGB, already in the shader's space.
  switch (starClass) {
    case 'M':
      return {
        class: 'M',
        radiusM: 0.35 * 6.957e8,
        temperatureK: 3200,
        color: [1.0, 0.55, 0.32],
      };
    case 'K':
      return {
        class: 'K',
        radiusM: 0.8 * 6.957e8,
        temperatureK: 4600,
        color: [1.0, 0.78, 0.52],
      };
    case 'G':
      return {
        class: 'G',
        radiusM: 6.957e8,
        temperatureK: 5800,
        color: [1.0, 0.96, 0.86],
      };
    case 'F':
      return {
        class: 'F',
        radiusM: 1.3 * 6.957e8,
        temperatureK: 6800,
        color: [1.0, 0.99, 0.95],
      };
    case 'A':
      return {
        class: 'A',
        radiusM: 1.8 * 6.957e8,
        temperatureK: 8500,
        color: [0.86, 0.90, 1.0],
      };
  }
}