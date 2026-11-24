import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddressOrThrow } from '../../frame/address';
import {
  AU_M,
  SYSTEM_VERSION,
  displayOrbitRadius,
  describeSystem,
  generateSystem,
  orbitalPeriodSeconds,
} from '../system';
import { AUTHORED_SYSTEMS, authoredAddresses, authoredSystemFor, resolveSystem } from './index';
import { SOL_ADDRESS, SOL_SYSTEM, SOL_VERSION } from './sol';

const PROCEDURAL = parseAddressOrThrow('v1/4.-2.7');
const SOL = parseAddressOrThrow(SOL_ADDRESS);

describe('authored registry (spec §3.6)', () => {
  it('returns the authored system for a reserved address, ignoring the seed', () => {
    // An authored node must not depend on the per-user seed, or a shared link to Sol would mean
    // something different for everyone who opened it.
    expect(resolveSystem('ugb-0000', SOL)).toBe(SOL_SYSTEM);
    expect(resolveSystem('a completely different seed', SOL)).toBe(SOL_SYSTEM);
  });

  it('leaves procedural addresses byte-identical to the generator', () => {
    // This is the regression that matters: adding the registry must change nothing for every
    // address that is not in it.
    expect(resolveSystem('ugb-0000', PROCEDURAL)).toEqual(generateSystem('ugb-0000', PROCEDURAL));
    expect(authoredSystemFor(PROCEDURAL)).toBeNull();
  });

  it('keeps the procedural generator version independent of authored data', () => {
    // If editing Sol's numbers bumped `SYSTEM_VERSION`, every shared procedural link would break
    // to fix one address. Authored nodes carry their own version instead.
    expect(generateSystem('ugb-0000', PROCEDURAL).version).toBe(SYSTEM_VERSION);
    expect(SOL_SYSTEM.version).toBe(SOL_VERSION);
  });

  it('reserves canonical, unique, system-depth addresses', () => {
    const addresses = authoredAddresses();
    expect(new Set(addresses).size).toBe(addresses.length);
    for (const address of addresses) {
      // Round-trip through the parser: a reserved address that cannot be written in a link is not
      // reserved in any useful sense.
      expect(formatAddress(parseAddressOrThrow(address))).toBe(address);
    }
    // Sol is a system, not a root or a bare level: three levels, matching `v1/4.-2.7`.
    expect(parseAddressOrThrow(SOL_ADDRESS).levels).toHaveLength(3);
    expect(PROCEDURAL.levels).toHaveLength(3);
  });

  it('gives every entry a stated reason', () => {
    for (const entry of AUTHORED_SYSTEMS) {
      expect(entry.note.length).toBeGreaterThan(20);
    }
  });
});

describe('Sol', () => {
  it('has the eight planets, ordered outward', () => {
    expect(SOL_SYSTEM.planets.map((planet) => planet.name)).toEqual([
      'Mercury',
      'Venus',
      'Earth',
      'Mars',
      'Jupiter',
      'Saturn',
      'Uranus',
      'Neptune',
    ]);

    let previousAxis = 0;
    for (const planet of SOL_SYSTEM.planets) {
      expect(planet.semiMajorAxisM).toBeGreaterThan(previousAxis);
      previousAxis = planet.semiMajorAxisM;
    }
  });

  it('puts Earth at one astronomical unit, and Neptune near thirty', () => {
    const earth = SOL_SYSTEM.planets.find((planet) => planet.name === 'Earth')!;
    const neptune = SOL_SYSTEM.planets.find((planet) => planet.name === 'Neptune')!;

    // One part in a million: the point is that this is astronomy, not a lookalike.
    expect(Math.abs(earth.semiMajorAxisM / AU_M - 1)).toBeLessThan(1e-6);
    expect(neptune.semiMajorAxisM / AU_M).toBeCloseTo(30.06896348, 6);
  });

  it('derives every period from its axis by Kepler, rather than transcribing it', () => {
    for (const planet of SOL_SYSTEM.planets) {
      expect(planet.orbitalPeriodS).toBeCloseTo(orbitalPeriodSeconds(planet.semiMajorAxisM), 3);
    }
    // A year is a year within a few hours.
    const earth = SOL_SYSTEM.planets.find((planet) => planet.name === 'Earth')!;
    expect(earth.orbitalPeriodS).toBeCloseTo(365.256 * 86_400, -4);
  });

  it('spins Venus and Uranus retrograde and everything else prograde', () => {
    for (const planet of SOL_SYSTEM.planets) {
      const retrograde = planet.name === 'Venus' || planet.name === 'Uranus';
      expect(Math.sign(planet.spinPeriodS), planet.name).toBe(retrograde ? -1 : 1);
    }
  });

  it('is a G-type star and describes itself honestly in the HUD row', () => {
    expect(SOL_SYSTEM.star.class).toBe('G');
    const description = describeSystem(SOL_SYSTEM);
    expect(description).toContain('G-type');
    expect(description).toContain('8 planets');
    // The exaggeration disclaimer must survive: an orrery is not a true-scale render.
    expect(description).toMatch(/×[\d–]+ real$/);
  });

  it('keeps every real orbit outside the drawn bodies, so the orrery cannot self-intersect', () => {
    // The real radii are correct, but the picture compresses the spacing. The renderer clamps
    // drawn size against the neighbour gap; this checks the input is sane enough for that to work.
    for (let index = 1; index < SOL_SYSTEM.planets.length; index += 1) {
      const inner = SOL_SYSTEM.planets[index - 1]!;
      const outer = SOL_SYSTEM.planets[index]!;
      expect(outer.semiMajorAxisM - inner.semiMajorAxisM).toBeGreaterThan(0);
      expect(displayOrbitRadius(outer, SOL_SYSTEM)).toBeGreaterThan(
        displayOrbitRadius(inner, SOL_SYSTEM),
      );
    }
  });
});