import { describe, expect, it } from 'vitest';
import { parseAddress } from '../frame/address';
import {
  GALAXY_TIER_STARS,
  GALAXY_VERSION,
  LOCAL_RADIUS_M,
  generateGalaxy,
} from './galaxy';
import { GALAXY_RADIUS_M } from '../render/scale';

const SEED = 'ugb-0000';

function address(text: string) {
  const parsed = parseAddress(text);
  if (!parsed.address) throw new Error(parsed.issue ?? 'bad address');
  return parsed.address;
}

const HOME = address('v1/4.-2.7');

describe('the galaxy is a pure function of (seed, address)', () => {
  it('produces identical stars for identical inputs', () => {
    const a = generateGalaxy(SEED, HOME, 'low');
    const b = generateGalaxy(SEED, HOME, 'low');
    expect(a.version).toBe(GALAXY_VERSION);
    expect(a.stars).toEqual(b.stars);
    expect(a.centre).toEqual(b.centre);
  });

  it('produces a different galaxy for a different address', () => {
    const a = generateGalaxy(SEED, HOME, 'low');
    const b = generateGalaxy(SEED, address('v1/4.-2.8'), 'low');
    // The centre is seeded, so it is the cheapest stable discriminator.
    expect(a.centre).not.toEqual(b.centre);
  });

  it('keeps a tier as a prefix of the richer stream, field by field', () => {
    const rich = generateGalaxy(SEED, HOME, 'rich');
    const low = generateGalaxy(SEED, HOME, 'low');
    const richLocal = 1 + GALAXY_TIER_STARS.rich.local;
    const lowLocal = 1 + GALAXY_TIER_STARS.low.local;
    expect(low.stars.length).toBeLessThan(rich.stars.length);
    // Each field draws its own stream, so the local prefix and the disc prefix both survive a
    // count cut even though the two fields are interleaved in the array.
    expect(low.stars.slice(1, lowLocal)).toEqual(rich.stars.slice(1, lowLocal));
    expect(low.stars.slice(lowLocal)).toEqual(
      rich.stars.slice(richLocal, richLocal + GALAXY_TIER_STARS.low.disc),
    );
  });

  it('uses compile-time counts independent of the address', () => {
    const a = generateGalaxy(SEED, HOME, 'rich');
    const b = generateGalaxy(SEED, address('v1/9.9.-9'), 'rich');
    const counts = GALAXY_TIER_STARS.rich;
    expect(a.stars.length).toBe(1 + counts.local + counts.disc);
    expect(b.stars.length).toBe(a.stars.length);
  });
});

describe('the population has the right shape', () => {
  const galaxy = generateGalaxy(SEED, HOME, 'rich');
  const firstLocal = galaxy.stars[1];
  const localCount = GALAXY_TIER_STARS.rich.local;
  const local = galaxy.stars.slice(1, 1 + localCount);
  const disc = galaxy.stars.slice(1 + localCount);

  it('has exactly one home star, at the origin, with its own colour', () => {
    const homes = galaxy.stars.filter((star) => star.home);
    expect(homes).toHaveLength(1);
    expect(homes[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(firstLocal?.home).toBe(false);
  });

  it('keeps the local field inside its radius and off a shell', () => {
    const distances = local.map((star) => Math.hypot(star.x, star.y, star.z));
    expect(Math.max(...distances)).toBeLessThanOrEqual(LOCAL_RADIUS_M * (1 + 1e-9));
    const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    // Uniform 3D density puts the mean at 3/4 of the radius; a shell would sit at 1.
    expect(mean).toBeGreaterThan(0.6 * LOCAL_RADIUS_M);
    expect(mean).toBeLessThan(0.85 * LOCAL_RADIUS_M);
  });

  it('keeps the disc inside the galaxy, relative to the centre', () => {
    let farthest = 0;
    for (const star of disc) {
      const distance = Math.hypot(
        star.x - galaxy.centre.x,
        star.y - galaxy.centre.y,
        star.z - galaxy.centre.z,
      );
      farthest = Math.max(farthest, distance);
    }
    // The local-field exclusion pushes a handful outwards; the bound stays near the disc edge.
    expect(farthest).toBeLessThanOrEqual(GALAXY_RADIUS_M * 1.1);
  });

  it('never emits NaN, a zero brightness, or an out-of-range colour', () => {
    for (const star of galaxy.stars) {
      for (const value of [star.x, star.y, star.z, star.brightness, star.size]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(star.brightness).toBeGreaterThan(0);
      expect(star.brightness).toBeLessThanOrEqual(1);
      expect(star.size).toBeGreaterThan(0);
      for (const channel of star.color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sits the home star inside the disc, not at its centre', () => {
    const distance = Math.hypot(galaxy.centre.x, galaxy.centre.y, galaxy.centre.z);
    expect(distance).toBeGreaterThan(GALAXY_RADIUS_M * 0.4);
    expect(distance).toBeLessThan(GALAXY_RADIUS_M * 0.7);
  });

  it('stays under the floor budget', () => {
    const counts = GALAXY_TIER_STARS.rich;
    expect(counts.local + counts.disc).toBeLessThanOrEqual(60_000);
  });
});