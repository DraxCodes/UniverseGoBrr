import { describe, expect, it } from 'vitest';
import { parseAddress } from '../frame/address';
import {
  GALAXY_TIER_STARS,
  GALAXY_VERSION,
  LOCAL_RADIUS_M,
  generateGalaxy,
  toDiscFrame,
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

  it('puts the disc on a readable two-arm spiral', () => {
    // The m=2 wave is measured per radial slice: the spiral's phase moves with radius, so one
    // DFT over the whole disc would cancel its own arms. This is the acceptance the renderer's
    // crossfade depends on: a broad, uniform haze measures low here and reads as an oval.
    const bins = 20;
    const inner = 0.2 * GALAXY_RADIUS_M;
    const outer = 1.0 * GALAXY_RADIUS_M;
    const cosine = new Float64Array(bins);
    const sine = new Float64Array(bins);
    const counts = new Float64Array(bins);
    for (const star of disc) {
      // Measured in the disc's own frame: the plane is inclined to the orrery's, so world `x`/`z`
      // would see an ellipse and smear the wave.
      const { x, z } = toDiscFrame(galaxy, star);
      const radius = Math.hypot(x, z);
      if (radius < inner || radius > outer) continue;
      const bin = Math.min(bins - 1, Math.floor(((radius - inner) / (outer - inner)) * bins));
      const azimuth = Math.atan2(z, x);
      cosine[bin]! += Math.cos(2 * azimuth);
      sine[bin]! += Math.sin(2 * azimuth);
      counts[bin]! += 1;
    }

    let weighted = 0;
    let total = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const n = counts[bin]!;
      if (n === 0) continue;
      weighted += (Math.hypot(cosine[bin]!, sine[bin]!) / n) * n;
      total += n;
    }
    // Re-aimed rejects measured ~0.175 here; sampling onto the arms lifts it to ~0.29.
    expect(weighted / total).toBeGreaterThan(0.25);

    // And the arms are not filaments over black: the uniform inter-arm fraction keeps a
    // visible floor, so the gaps do not close. Measured in one thin radial slice, because a
    // thick annulus averages the spiral's own phase change back into a uniform ring.
    const binsAzimuth = 36;
    const slice = disc.filter((star) => {
      const { x, z } = toDiscFrame(galaxy, star);
      const radius = Math.hypot(x, z);
      return radius > 0.47 * GALAXY_RADIUS_M && radius < 0.53 * GALAXY_RADIUS_M;
    });
    const cells = new Float64Array(binsAzimuth);
    for (const star of slice) {
      const { x, z } = toDiscFrame(galaxy, star);
      const azimuth = Math.atan2(z, x);
      cells[Math.floor(((azimuth + Math.PI) / (2 * Math.PI)) * binsAzimuth)]! += 1;
    }
    const sorted = [...cells].sort((a, b) => a - b);
    const trough = sorted[Math.floor(binsAzimuth * 0.05)]!;
    const crest = sorted[Math.floor(binsAzimuth * 0.95)]!;
    // A 3:1 density ratio leaves the trough at ~20% of the mean; a floor that never empties
    // keeps the disc a disc rather than two drawn curves.
    expect(trough).toBeGreaterThan((slice.length / binsAzimuth) * 0.1);
    expect(crest / trough).toBeGreaterThan(2.5);
  });
});