import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import { galaxyPosition, GALAXY_SPACING_M, MPC_M } from './layout';

const at = (n: number) => parseAddressOrThrow(`v1/${n}`);
const SEED = 'ugb-0000';

describe('the root layout', () => {
  it('has no position for the root', () => {
    expect(galaxyPosition(SEED, parseAddressOrThrow('v1/'))).toBeNull();
  });

  it('anchors the home galaxy at the origin', () => {
    // Sol is at v1/0.0.0, so galaxy 0 is the Milky Way and it is where "here" is.
    expect(galaxyPosition(SEED, at(0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('reads the galaxy from the first level of a deeper address too', () => {
    // A caller should not have to normalise: the galaxy of v1/0.3.1 is still galaxy 0.
    expect(galaxyPosition(SEED, parseAddressOrThrow('v1/0.3.1'))).toEqual(
      galaxyPosition(SEED, at(0)),
    );
  });

  it('is deterministic', () => {
    for (let n = 1; n < 20; n += 1) {
      expect(galaxyPosition(SEED, at(n))).toEqual(galaxyPosition(SEED, at(n)));
    }
  });

  it('gives every galaxy a distinct position', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 200; n += 1) {
      const p = galaxyPosition(SEED, at(n))!;
      seen.add(`${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`);
    }
    // 200 galaxies, 200 positions - a collision would put two galaxies on top of each other.
    expect(seen.size).toBe(200);
  });

  it('has no galaxy sitting on the home galaxy', () => {
    for (let n = 1; n < 100; n += 1) {
      const p = galaxyPosition(SEED, at(n))!;
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThan(0.1 * GALAXY_SPACING_M);
    }
  });

  it('keeps producing positions arbitrarily far out', () => {
    // "Effectively infinite, not merely large": a far address must still have a finite, real
    // position rather than wrapping or clamping to the edge of a catalogue.
    const far = galaxyPosition(SEED, at(1_000_000))!;
    expect(Number.isFinite(far.x)).toBe(true);
    expect(Number.isFinite(far.y)).toBe(true);
    expect(Number.isFinite(far.z)).toBe(true);
    expect(Math.hypot(far.x, far.y, far.z)).toBeGreaterThan(50 * GALAXY_SPACING_M);
  });

  it('puts negative-index galaxies somewhere distinct from their positive twin', () => {
    // The radius uses |g| but the direction hashes the signed address, so v1/7 and v1/-7 are at
    // the same range and different places - not the same galaxy seen twice.
    const a = galaxyPosition(SEED, at(7))!;
    const b = galaxyPosition(SEED, at(-7))!;
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.1 * GALAXY_SPACING_M);
  });

  it('fills space at roughly constant density rather than as a shell', () => {
    // The point of `cbrt`: the count within radius r should grow like r^3. Check that the median
    // radius of the first 1000 galaxies is well below the maximum, i.e. galaxies exist across a
    // range of radii, not all at one distance.
    const radii: number[] = [];
    for (let n = 1; n <= 1000; n += 1) {
      const p = galaxyPosition(SEED, at(n))!;
      radii.push(Math.hypot(p.x, p.y, p.z));
    }
    radii.sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)]!;
    const max = radii[radii.length - 1]!;
    expect(median).toBeLessThan(0.85 * max);
    // And a real spread, not a thin ring.
    expect(radii[0]!).toBeLessThan(0.5 * median);
  });

  it('uses galaxy-scale spacing, not solar-neighbourhood spacing', () => {
    // A guard against a units slip: 2 Mpc is ~6.5 Mly, far above a galaxy's radius (~0.05 Mly).
    expect(MPC_M).toBeGreaterThan(3e22);
    expect(GALAXY_SPACING_M).toBeGreaterThan(1e22);
  });
});