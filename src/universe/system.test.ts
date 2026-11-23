import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import {
  AU_M,
  GM_SUN,
  SYSTEM_VERSION,
  displayBodyRadius,
  displayOrbitRadius,
  exaggerationFactor,
  generateSystem,
  orbitalPeriodSeconds,
  planetPosition,
  type Planet,
  type StarSystem,
} from './system';

const ADDRESS = parseAddressOrThrow('v1/4.-2.7');
const OTHER = parseAddressOrThrow('v1/4.-2.8');

function relative(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1);
}

describe('system generation', () => {
  it('produces the identical system from the same seed and address', () => {
    const a = generateSystem('ugb-0000', ADDRESS);
    const b = generateSystem('ugb-0000', ADDRESS);
    expect(a).toEqual(b);
    expect(a.version).toBe(SYSTEM_VERSION);
  });

  it('produces a different system from a different address or seed', () => {
    const base = generateSystem('ugb-0000', ADDRESS);
    const otherAddress = generateSystem('ugb-0000', OTHER);
    const otherSeed = generateSystem('ugb-0001', ADDRESS);

    expect(otherAddress).not.toEqual(base);
    expect(otherSeed).not.toEqual(base);
  });

  it('generates a plausible system: 3–9 planets, ordered, positive, finite', () => {
    // Determinism is not enough; absurd output must fail too. Sweep addresses for coverage.
    for (let index = 0; index < 40; index += 1) {
      const address = parseAddressOrThrow(`v1/4.-2.${index}`);
      const system = generateSystem('sweep', address);

      expect(system.planets.length).toBeGreaterThanOrEqual(3);
      expect(system.planets.length).toBeLessThanOrEqual(9);
      expect(['M', 'K', 'G', 'F', 'A']).toContain(system.star.class);
      expect(system.star.radiusM).toBeGreaterThan(0);
      expect(system.star.temperatureK).toBeGreaterThan(2000);

      let previousAxis = 0;
      for (const planet of system.planets) {
        expect(Number.isFinite(planet.semiMajorAxisM)).toBe(true);
        expect(Number.isFinite(planet.radiusM)).toBe(true);
        expect(planet.radiusM).toBeGreaterThan(0);
        // Ordered outward, with room between neighbours.
        expect(planet.semiMajorAxisM).toBeGreaterThan(previousAxis);
        previousAxis = planet.semiMajorAxisM;
        // Outside the star, and the innermost orbit is not inside it.
        expect(planet.semiMajorAxisM / AU_M).toBeGreaterThan(0.1);
      }

      for (let position = 1; position < system.planets.length; position += 1) {
        const inner = system.planets[position - 1]!;
        const outer = system.planets[position]!;
        const gap = outer.semiMajorAxisM - inner.semiMajorAxisM;
        expect(gap).toBeGreaterThan(inner.radiusM + outer.radiusM);
      }

      // Names are b, c, d, … in order, because a shared link should read like a catalogue.
      expect(system.planets.map((planet) => planet.name)).toEqual(
        system.planets.map((_, position) => String.fromCharCode(98 + position)),
      );
    }
  });

  it('keeps the innermost planet inside the outermost, so the orrery has one scale', () => {
    const system = generateSystem('ugb-0000', ADDRESS);
    const outermost = system.planets[system.planets.length - 1]!;
    for (const planet of system.planets) {
      expect(planet.semiMajorAxisM).toBeLessThanOrEqual(outermost.semiMajorAxisM);
    }
  });
});

describe('orbits', () => {
  it("follows Kepler's third law: period squared is proportional to axis cubed", () => {
    for (const axisAU of [0.4, 1, 5.2, 30]) {
      const axis = axisAU * AU_M;
      const expected = 2 * Math.PI * Math.sqrt((axis * axis * axis) / GM_SUN);
      expect(relative(orbitalPeriodSeconds(axis), expected)).toBeLessThan(1e-12);
    }

    // A year is a year: one AU around one solar mass is 365.25 days within a few hours.
    expect(orbitalPeriodSeconds(AU_M)).toBeCloseTo(365.256 * 86_400, -4);
  });

  it('places every planet exactly on its own orbit radius, at any time', () => {
    const system = generateSystem('ugb-0000', ADDRESS);
    for (const planet of system.planets) {
      for (const t of [0, 1, 3600, 1e6, -1e7, 3.2e9]) {
        const point = planetPosition(planet, t);
        expect(point.y).toBe(0);
        const distance = Math.hypot(point.x, point.z);
        expect(relative(distance, planet.semiMajorAxisM)).toBeLessThan(1e-12);
      }
    }
  });

  it('returns to the same place after exactly one period', () => {
    const system = generateSystem('ugb-0000', ADDRESS);
    for (const planet of system.planets) {
      const start = planetPosition(planet, 0);
      const wrapped = planetPosition(planet, planet.orbitalPeriodS);
      expect(relative(wrapped.x, start.x)).toBeLessThan(1e-12);
      expect(relative(wrapped.z, start.z)).toBeLessThan(1e-12);
    }
  });

  it('moves outer planets more slowly, which is what makes an orrery read as a system', () => {
    const system = generateSystem('ugb-0000', ADDRESS);
    for (let index = 1; index < system.planets.length; index += 1) {
      const inner = system.planets[index - 1]!;
      const outer = system.planets[index]!;
      expect(outer.orbitalPeriodS).toBeGreaterThan(inner.orbitalPeriodS);
    }
  });
});

describe('orrery presentation', () => {
  it('normalises the outermost orbit to 1 and keeps the order', () => {
    const system = generateSystem('ugb-0000', ADDRESS);
    const outermost = system.planets[system.planets.length - 1]!;
    expect(displayOrbitRadius(outermost, system)).toBeCloseTo(1, 12);

    for (let index = 1; index < system.planets.length; index += 1) {
      const inner = system.planets[index - 1]!;
      const outer = system.planets[index]!;
      expect(displayOrbitRadius(outer, system)).toBeGreaterThan(
        displayOrbitRadius(inner, system),
      );
    }
  });

  it('keeps bodies strictly inside their neighbours, so nothing overlaps on screen', () => {
    const system = generateSystem('ugb-0000', ADDRESS);
    for (const planet of system.planets) {
      const orbit = displayOrbitRadius(planet, system);
      const body = displayBodyRadius(planet, system);
      expect(body).toBeLessThan(orbit * 0.5);
      expect(body).toBeGreaterThan(0);
    }

    // Adjacent orbits must stay further apart than the two bodies' radii, or the inner world is
    // drawn inside the outer one and the orrery stops reading as a system.
    for (let index = 1; index < system.planets.length; index += 1) {
      const inner = system.planets[index - 1]!;
      const outer = system.planets[index]!;
      const gap = displayOrbitRadius(outer, system) - displayOrbitRadius(inner, system);
      expect(gap).toBeGreaterThan(
        displayBodyRadius(inner, system) + displayBodyRadius(outer, system),
      );
    }
  });

  it('never draws two discs on top of each other, on any address', () => {
    // The clamp exists because `a^0.55` squeezes the inner orbits: a class-sized gas giant can be
    // wider than the gap to its neighbour. Sweeping addresses catches the case a single system
    // would miss.
    for (let index = 0; index < 40; index += 1) {
      const system = generateSystem('overlap-sweep', parseAddressOrThrow(`v1/9.${index}`));
      const places = system.planets.map((planet) => ({
        orbit: displayOrbitRadius(planet, system),
        body: displayBodyRadius(planet, system),
      }));
      for (let a = 0; a < places.length; a += 1) {
        for (let b = a + 1; b < places.length; b += 1) {
          const distance = Math.abs(places[a]!.orbit - places[b]!.orbit);
          expect(distance, `address ${index}, planets ${a}/${b}`).toBeGreaterThan(
            places[a]!.body + places[b]!.body,
          );
        }
      }
    }
  });

  it('keeps every body legible, not just the outer ones', () => {
    // The regression this guards: multiplying the body radius by its own orbit radius made the
    // inner worlds under a pixel wide at any framing that shows the system.
    const system = generateSystem('ugb-0000', ADDRESS);
    for (const planet of system.planets) {
      const radius = displayBodyRadius(planet, system);
      // Half a percent of the frame radius is ~5 px at 1080p: small, but visible.
      expect(radius).toBeGreaterThanOrEqual(0.005);
      expect(radius).toBeLessThanOrEqual(planet.sizeFraction);
    }
  });

  it('draws bodies hugely oversized, and reports the factor honestly', () => {
    const system = generateSystem('ugb-0000', ADDRESS);
    for (const planet of system.planets) {
      // The brief's arithmetic: a real radius is sub-pixel, so the drawn radius is ~10³ larger.
      expect(exaggerationFactor(planet, system)).toBeGreaterThan(100);
      expect(Number.isFinite(exaggerationFactor(planet, system))).toBe(true);
    }
  });

  it('reports gas giants as the largest bodies and rock as the smallest', () => {
    const system: StarSystem = generateSystem('ugb-0000', ADDRESS);
    const byClass = (target: Planet['class']) =>
      system.planets.find((planet) => planet.class === target) ?? null;

    const gas = byClass('gas');
    const rock = byClass('rock');
    if (gas && rock) expect(gas.sizeFraction).toBeGreaterThan(rock.sizeFraction);
  });
});