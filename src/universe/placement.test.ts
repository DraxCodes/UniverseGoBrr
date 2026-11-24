import { describe, expect, it } from 'vitest';
import { parseAddress, childAddress } from '../frame/address';
import { createRng } from '../lib/random';
import { fnv1a32 } from '../lib/hash';
import { GALAXY_RADIUS_M } from '../render/scale';
import {
  GALAXY_TIER_STARS,
  LOCAL_RADIUS_M,
  galaxyAddressOf,
  generateGalaxy,
  toDiscFrame,
} from './galaxy';
import { galaxyFrame, galaxyKey, sampleDiscStar } from './disc';
import { PLACEMENT_VERSION, placement, placementKey } from './placement';

const SEED = 'ugb-0000';

function address(text: string) {
  const parsed = parseAddress(text);
  if (!parsed.address) throw new Error(parsed.issue ?? 'bad address');
  return parsed.address;
}

describe('placement is a pure function of (seed, address)', () => {
  it('returns the same position for the same inputs', () => {
    const a = address('v1/4.3.-2');
    expect(placement(SEED, a)).toEqual(placement(SEED, a));
  });

  it('answers the seed and the address, not either alone', () => {
    const a = address('v1/4.3.-2');
    expect(placement(SEED, a)).not.toEqual(placement('another-seed', a));
    expect(placement(SEED, a)).not.toEqual(placement(SEED, address('v1/4.3.-1')));
    expect(placement(SEED, a)).not.toEqual(placement(SEED, address('v1/4.3.-2.0')));
  });

  it('is versioned', () => {
    // A position is content: a shared link re-pins when it changes, like `SYSTEM_VERSION`.
    expect(PLACEMENT_VERSION).toBe(1);
    expect(placementKey(SEED, address('v1/4.3'))).toContain(`|placement|v${PLACEMENT_VERSION}`);
  });
});

describe('a placed star belongs to its galaxy', () => {
  it('lies inside that galaxy’s disc, in the same frame the picture uses', () => {
    // One galaxy, read once: placement must agree with the generator's centre and orientation,
    // or a compass built on it would point at a different disc from the one drawn.
    const galaxy = generateGalaxy(SEED, address('v1/4'), 'low');
    for (const text of [
      'v1/4.1',
      'v1/4.2',
      'v1/4.-7',
      'v1/4.1.2',
      'v1/4.999.0.0',
      'v1/4.-2147483647',
    ]) {
      const point = placement(SEED, address(text))!;
      const disc = toDiscFrame(galaxy, point);
      const radius = Math.hypot(disc.x, disc.z);
      expect(radius, text).toBeLessThanOrEqual(GALAXY_RADIUS_M * 1.001);
      // The disc field is deliberately never drawn inside the local field's sphere, so a placed
      // star is never a duplicate of a neighbourhood light drawn by the local field.
      expect(Math.hypot(point.x, point.y, point.z), text).toBeGreaterThanOrEqual(
        LOCAL_RADIUS_M * 1.2 * (1 - 1e-9),
      );
    }
  });

  it('gives distinct addresses distinct places', () => {
    const galaxy = address('v1/4');
    const points = Array.from(
      { length: 40 },
      (_, index) => placement(SEED, childAddress(galaxy, index))!,
    );
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        const left = points[a]!;
        const right = points[b]!;
        expect(Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)).toBeGreaterThan(1);
      }
    }
  });

  it('places a galaxy node at its own frame origin', () => {
    // A galaxy's home star *is* the origin the camera orbits at system scale. Its position in the
    // root is not modelled — no root layout exists — so this is the honest answer within its frame.
    expect(placement(SEED, address('v1/4'))).toEqual({ x: 0, y: 0, z: 0 });
    expect(placement('anything', address('v1/4'))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('does not place the root', () => {
    // The root contains everything and sits nowhere. `null`, not zero and not a throw: zooming out
    // to the top is a normal state (cf. `parentAddress`), so a caller can say "no position" instead
    // of crashing.
    expect(placement(SEED, address('v1/'))).toBeNull();
  });
});

describe('placement and the picture share one law', () => {
  it('replays the generator’s disc stream exactly', () => {
    // This is the ADR-0011 guarantee in executable form: the generator is not a second, drifting
    // copy of the disc law. Replaying its own `|disc` stream through `sampleDiscStar` must land on
    // the same stars it produced.
    const galaxyAddress = galaxyAddressOf(address('v1/4'));
    const frame = galaxyFrame(SEED, galaxyAddress);
    const rng = createRng(fnv1a32(`${galaxyKey(SEED, galaxyAddress)}|disc`));
    const galaxy = generateGalaxy(SEED, address('v1/4'), 'low');
    const firstDiscStar = 1 + GALAXY_TIER_STARS.low.local;

    for (let index = 0; index < 25; index += 1) {
      const sample = sampleDiscStar(rng, frame);
      // The generator draws brightness and colour from this same stream after the position, so a
      // faithful replay consumes those two draws before asking for the next star.
      rng.next();
      rng.next();
      const star = galaxy.stars[firstDiscStar + index]!;
      expect(star.x).toBe(sample.x);
      expect(star.y).toBe(sample.y);
      expect(star.z).toBe(sample.z);
    }
  });

  it('derives a placed position from the address’s own stream', () => {
    const target = address('v1/4.3');
    const frame = galaxyFrame(SEED, galaxyAddressOf(target));
    const expected = sampleDiscStar(createRng(fnv1a32(placementKey(SEED, target))), frame);
    expect(placement(SEED, target)).toEqual({
      x: expected.x,
      y: expected.y,
      z: expected.z,
    });
  });

  it('puts deeper addresses in the same galaxy, not in a private one', () => {
    // The galaxy-identity fix (GALAXY_VERSION 5) applied to positions: walking one star over and
    // asking where you are must answer in the sky you left, not a freshly rolled disc.
    const galaxy = generateGalaxy(SEED, address('v1/4'), 'low');
    const near = placement(SEED, address('v1/4.1'))!;
    const deep = placement(SEED, address('v1/4.1.1.1'))!;
    for (const point of [near, deep]) {
      const disc = toDiscFrame(galaxy, point);
      expect(Math.hypot(disc.x, disc.z)).toBeLessThanOrEqual(GALAXY_RADIUS_M * 1.001);
    }
  });
});