import { describe, expect, it } from 'vitest';
import { childAddress, formatAddress, parseAddress, type Address } from '../frame/address';
import { createRng } from '../lib/random';
import { fnv1a32 } from '../lib/hash';
import { GALAXY_RADIUS_M } from '../render/scale';
import { LOCAL_RADIUS_M, galaxyAddressOf, generateGalaxy, toDiscFrame } from './galaxy';
import { galaxyFrame, sampleDiscStar, sectorPosition, discPlanePoint } from './disc';
import {
  LOCAL_STAR_EVERY,
  PLACEMENT_VERSION,
  placement,
  placementKey,
  sectorOfStar,
  starAddressAt,
  starKind,
  starKindOfIndex,
} from './placement';

const SEED = 'ugb-0000';
const GALAXY = 'v1/4';

function address(text: string) {
  const parsed = parseAddress(text);
  if (!parsed.address) throw new Error(parsed.issue ?? 'bad address');
  return parsed.address;
}

/** The address a star identity has in a galaxy: `galaxy.sector.index`, with the real sector. */
function star(galaxyText: string, index: number): Address {
  const galaxy = address(galaxyText);
  return starAddressAt(galaxy, sectorOfStar(SEED, galaxy, index), index);
}

describe('placement is a pure function of (seed, address)', () => {
  it('returns the same position for the same inputs', () => {
    const a = star(GALAXY, 3);
    expect(placement(SEED, a)).toEqual(placement(SEED, a));
  });

  it('answers the seed and the address, not either alone', () => {
    const a = star(GALAXY, 3);
    expect(placement(SEED, a)).not.toEqual(placement('another-seed', a));
    expect(placement(SEED, a)).not.toEqual(placement(SEED, star(GALAXY, 4)));
  });

  it('is versioned', () => {
    // A position is content: a shared link re-pins when it changes, like `SYSTEM_VERSION`.
    expect(PLACEMENT_VERSION).toBe(2);
    expect(placementKey(SEED, address('v1/4.3'))).toContain(`|placement|v${PLACEMENT_VERSION}`);
  });
});

describe('the sector rung is transparent to position (ADR-0023)', () => {
  it('keys a star on the address it had before the sector existed', () => {
    // The exact string is the mechanic: `v1/4.3.-7` (star -7 of sector 3) must key on
    // `v1/4.-7`, the pre-re-key address of that star. A full-address key would silently re-roll
    // every star while claiming the galaxy was unchanged.
    expect(placementKey(SEED, address('v1/4.3.-7'))).toBe(
      `${SEED}|v1/4.-7|placement|v${PLACEMENT_VERSION}`,
    );
    // And the generator's identity-keyed path produces the same string.
    expect(placementKey(SEED, address('v1/4.-7'))).toBe(placementKey(SEED, address('v1/4.3.-7')));
  });

  it('puts a star at the same point whichever valid sector labels it', () => {
    const frame = galaxyFrame(SEED, address(GALAXY));
    const index = 7;
    const first = placement(SEED, starAddressAt(address(GALAXY), 0, index))!;
    const second = placement(SEED, starAddressAt(address(GALAXY), 3, index))!;
    expect(second).toEqual(first);
    // And the point is the one the disc law draws from the star's own stream.
    const expected = sampleDiscStar(createRng(fnv1a32(placementKey(SEED, address('v1/4.7')))), frame);
    expect(first).toEqual({ x: expected.x, y: expected.y, z: expected.z });
  });

  it('places a sector at the middle of its wedge, as a real destination', () => {
    const frame = galaxyFrame(SEED, address(GALAXY));
    const here = placement(SEED, address('v1/4.0'))!;
    const expected = sectorPosition(frame, 0);
    expect(here).toEqual(expected);
    // Mid-radius, tilted with the disc, so it is inside the disc and not at the centre.
    const flat = discPlanePoint(frame.centre, here);
    expect(Math.hypot(flat.x, flat.z)).toBeGreaterThan(GALAXY_RADIUS_M * 0.1);
    expect(Math.hypot(flat.x, flat.z)).toBeLessThanOrEqual(GALAXY_RADIUS_M);
  });
});

describe('a placed star belongs to its galaxy', () => {
  it('lies inside that galaxy’s disc, in the same frame the picture uses', () => {
    // One galaxy, read once: placement must agree with the generator's centre and orientation,
    // or a compass built on it would point at a different disc from the one drawn.
    const galaxy = generateGalaxy(SEED, address(GALAXY), 'low');
    for (const index of [1, 2, -7, 998]) {
      const point = placement(SEED, star(GALAXY, index))!;
      const disc = toDiscFrame(galaxy, point);
      const radius = Math.hypot(disc.x, disc.z);
      expect(radius, String(index)).toBeLessThanOrEqual(GALAXY_RADIUS_M * 1.001);
      // The disc field is deliberately never drawn inside the local field's sphere, so a placed
      // disc star is never a duplicate of a neighbourhood light drawn by the local field.
      expect(Math.hypot(point.x, point.y, point.z), String(index)).toBeGreaterThanOrEqual(
        LOCAL_RADIUS_M * 1.2 * (1 - 1e-9),
      );
    }
  });

  it('refuses to classify a sector or anything shallower as a star', () => {
    // The kind rule reads the level *below* the sector rung. At the root, at a galaxy and at a
    // sector that level does not exist; a silent fallback there is what used to hang the generator.
    expect(() => starKind(address('v1/'))).toThrow(/deeper than a sector/);
    expect(() => starKind(address('v1/4'))).toThrow(/deeper than a sector/);
    expect(() => starKind(address('v1/4.3'))).toThrow(/deeper than a sector/);
    expect(starKind(star(GALAXY, 3))).toBe('disc');
    expect(starKind(star(GALAXY, LOCAL_STAR_EVERY))).toBe('local');
    // A body answers for the star it orbits.
    expect(starKind(childAddress(star(GALAXY, LOCAL_STAR_EVERY), 2))).toBe('local');
  });

  it('classifies by the star identity, not by the address', () => {
    // The generator walks identities before it can build addresses, so the two entry points
    // must agree for every identity.
    for (const index of [0, 1, 8, 9, 17, 18, -9]) {
      expect(starKind(star(GALAXY, index))).toBe(starKindOfIndex(index));
    }
  });

  it('places local-field addresses inside the ball, off a shell', () => {
    // One child in nine is a local-field star (`starKind`), and its kind is a property of the
    // identity rather than of an iterator, so these addresses answer the local law however they
    // are reached. This is what makes the neighbours the camera parallaxes against addressable.
    const points = Array.from({ length: 60 }, (_, n) =>
      placement(SEED, star(GALAXY, n * LOCAL_STAR_EVERY))!,
    );
    const distances = points.map((point) => Math.hypot(point.x, point.y, point.z));
    expect(Math.max(...distances)).toBeLessThanOrEqual(LOCAL_RADIUS_M * (1 + 1e-9));
    const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    expect(mean).toBeGreaterThan(0.6 * LOCAL_RADIUS_M);
    expect(mean).toBeLessThan(0.85 * LOCAL_RADIUS_M);
  });

  it('gives distinct star identities distinct places', () => {
    const points = Array.from({ length: 40 }, (_, index) => placement(SEED, star(GALAXY, index))!);
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
    expect(placement(SEED, address(GALAXY))).toEqual({ x: 0, y: 0, z: 0 });
    expect(placement('anything', address(GALAXY))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('does not place the root', () => {
    // The root contains everything and sits nowhere. `null`, not zero and not a throw: zooming out
    // to the top is a normal state (cf. `parentAddress`), so a caller can say "no position" instead
    // of crashing.
    expect(placement(SEED, address('v1/'))).toBeNull();
  });
});

describe('placement and the picture share one law', () => {
  it('draws exactly what placement places, for every star in the population', () => {
    // This is the ADR-0011 guarantee in executable form, and it is now the *whole* population
    // rather than a replay of a stream that no longer exists: every drawn light carries the
    // address that produced it, and asking placement for that address must return the same
    // point. A mismatch would mean the picture shows a light you cannot travel to.
    const galaxy = generateGalaxy(SEED, address(GALAXY), 'low');
    for (const star of galaxy.stars) {
      expect(placement(SEED, star.address), formatAddress(star.address)).toEqual({
        x: star.x,
        y: star.y,
        z: star.z,
      });
    }
  });

  it('gives every drawn star a distinct address, and the home star the galaxy’s own', () => {
    const galaxyAddress = address(GALAXY);
    const galaxy = generateGalaxy(SEED, galaxyAddress, 'low');
    const home = galaxy.stars[0]!;
    // The home star is the frame origin, so its address is the galaxy node itself, not a child.
    expect(home.home).toBe(true);
    expect(home.address).toEqual(galaxyAddress);

    const drawn = galaxy.stars.slice(1).map((star) => formatAddress(star.address));
    expect(new Set(drawn).size).toBe(drawn.length);
    // And every drawn star is `galaxy.sector.star`: two levels below the galaxy.
    for (const star of galaxy.stars.slice(1)) {
      expect(star.address.levels.length).toBe(galaxyAddress.levels.length + 2);
    }
  });

  it('derives a placed position from the address’s own stream', () => {
    const target = star(GALAXY, 3);
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
    const galaxy = generateGalaxy(SEED, address(GALAXY), 'low');
    const near = placement(SEED, star(GALAXY, 1))!;
    const deep = placement(SEED, childAddress(childAddress(star(GALAXY, 1), 0), 0))!;
    for (const point of [near, deep]) {
      const disc = toDiscFrame(galaxy, point);
      expect(Math.hypot(disc.x, disc.z)).toBeLessThanOrEqual(GALAXY_RADIUS_M * 1.001);
    }
  });
});