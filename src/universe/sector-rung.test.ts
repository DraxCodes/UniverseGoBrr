import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddressOrThrow } from '../frame/address';
import { createRng } from '../lib/random';
import { fnv1a32 } from '../lib/hash';
import { discAzimuthOf, galaxyFrame, sampleDiscStar, sectorOfPoint } from './disc';
import { appearanceKey, generateGalaxy } from './galaxy';
import { withoutSectorRung, hasSystemScene } from './levels';
import {
  PLACEMENT_VERSION,
  placement,
  placementKey,
  sectorOfStar,
  starAddressAt,
} from './placement';
import { generateSystem } from './system';

/**
 * ADR-0023's promise, executable: **the sector rung is a label, not a change**.
 *
 * Inserting a rung re-keys every address at depth 2 or deeper, which normally means every shared
 * link breaks and every drawn thing re-rolls. The ADR avoids the second half of that by keying
 * position, appearance and system content on `withoutSectorRung(address)` — the string the place
 * had before the rung existed. These tests pin that string, because a future "cleanup" that keys on
 * the whole address would pass every other test in this repo while silently redrawing the galaxy.
 *
 * The evidence for the whole population being byte-identical (six galaxy/tier dumps and three
 * systems, diffed against `4405c2d` at the re-key) was a throwaway script; this file is the part
 * that keeps the property from regressing.
 */

const SEED = 'ugb-0000';
const GALAXY = 'v1/4';

describe('the sector rung is inserted, not appended', () => {
  it('drops the sector level and keeps every other level in place', () => {
    expect(formatAddress(withoutSectorRung(parseAddressOrThrow('v1/4.3.-7')))).toBe('v1/4.-7');
    expect(formatAddress(withoutSectorRung(parseAddressOrThrow('v1/4.3.-7.1')))).toBe('v1/4.-7.1');
    // A bare sector is returned unchanged, and it has to be: `v1/4.3` is also the pre-re-key
    // address of a star, so stripping it would break the identity key every position is pinned on.
    expect(formatAddress(withoutSectorRung(parseAddressOrThrow('v1/4.3')))).toBe('v1/4.3');
    // Shallower than a sector there is nothing to remove; the address is returned unchanged.
    expect(formatAddress(withoutSectorRung(parseAddressOrThrow('v1/4')))).toBe('v1/4');
    expect(formatAddress(withoutSectorRung(parseAddressOrThrow('v1/')))).toBe('v1/');
  });
});

describe('position and appearance did not move with the re-key', () => {
  it('keys a star on the address it had before the sector existed', () => {
    // The exact string is the mechanic: `v1/4.3.-7` (star -7 filed under sector 3) must key on
    // `v1/4.-7`. A full-address key would move every star while claiming the galaxy was unchanged.
    expect(placementKey(SEED, parseAddressOrThrow('v1/4.3.-7'))).toBe(
      `${SEED}|v1/4.-7|placement|v${PLACEMENT_VERSION}`,
    );
    // And the generator's identity-keyed path produces the same string.
    expect(placementKey(SEED, parseAddressOrThrow('v1/4.-7'))).toBe(
      placementKey(SEED, parseAddressOrThrow('v1/4.3.-7')),
    );
    // A bare sector keeps its own string, because that string is also the star-identity form the
    // line above depends on. The collision is accepted (ADR-0023): a sector is redundant to
    // position, and a sector is never drawn as a star.
    expect(placementKey(SEED, parseAddressOrThrow('v1/4.3'))).toBe(
      `${SEED}|v1/4.3|placement|v${PLACEMENT_VERSION}`,
    );
  });

  it('keys appearance the same way, so the version bump does not re-roll it', () => {
    // `GALAXY_VERSION` is 9 and `APPEARANCE_VERSION` is deliberately still 8: a change to an
    // *address* must not change how a light looks. These numbers are literals on purpose — bumping
    // either re-rolls brightness, colour and size for every star in every galaxy, which is exactly
    // the regression this test exists to catch.
    expect(appearanceKey(SEED, parseAddressOrThrow('v1/4.3.-7'))).toBe(
      `${SEED}|v1/4.-7|appearance|v8`,
    );
    expect(appearanceKey(SEED, parseAddressOrThrow('v1/4.3.-7'))).toBe(
      appearanceKey(SEED, parseAddressOrThrow('v1/4.0.-7')),
    );
  });

  it('puts a star at the same point whichever valid sector labels it', () => {
    const frame = galaxyFrame(SEED, parseAddressOrThrow(GALAXY));
    const index = 7;
    const first = placement(SEED, starAddressAt(parseAddressOrThrow(GALAXY), 0, index))!;
    const second = placement(SEED, starAddressAt(parseAddressOrThrow(GALAXY), 3, index))!;
    expect(second).toEqual(first);
    // And the point is the one the disc law draws from the star's own stream, read through the
    // pre-re-key address. (Star 7 is positive, so its old and new keys agree here; the negative
    // case is pinned by the string test above, because `v1/4.-7` is now a *body* address.)
    const expected = sampleDiscStar(
      createRng(fnv1a32(placementKey(SEED, parseAddressOrThrow('v1/4.7')))),
      frame,
    );
    expect(first).toEqual({ x: expected.x, y: expected.y, z: expected.z });
  });

  it('keeps a system’s planets on the pre-re-key address, not on the sector', () => {
    // A system is deep content: if its key included the sector rung, every planet in the sky would
    // re-roll when the label above it changed. The key is `v1/4.-2.7` — the address this star's
    // system had before the rung existed, and the exact string the pre-re-key tree hashed.
    const sector0 = generateSystem(SEED, parseAddressOrThrow('v1/4.0.-2.7'));
    expect(formatAddress(withoutSectorRung(parseAddressOrThrow('v1/4.0.-2.7')))).toBe('v1/4.-2.7');
    // And the sector is redundant to content, not an input: a crafted link naming another sector
    // still resolves to that star's system. Accepted for now (ADR-0023): a label disagreement is
    // not a different place.
    expect(generateSystem(SEED, parseAddressOrThrow('v1/4.9.-2.7'))).toEqual(sector0);
  });
});

describe('the sector is derived from the angle the star is drawn at', () => {
  it('files every star under the wedge its drawn angle falls in', () => {
    // ADR-0023's invariant: the sector is derived from the position, so the label and the wedge
    // cannot disagree. The wedge is computed **independently** here — slice `k` is the angular
    // interval `[phase + k·2π/count, phase + (k+1)·2π/count)` — so this is not the production
    // `sectorIndexForAngle` checked against itself, which would pass for any law at all.
    const galaxyAddress = parseAddressOrThrow('v1/0');
    const frame = galaxyFrame(SEED, galaxyAddress);
    const galaxy = generateGalaxy(SEED, galaxyAddress, 'low');
    const TAU = Math.PI * 2;
    const wedgeRad = TAU / frame.sectorCount;
    for (const star of galaxy.stars.slice(1)) {
      const offset =
        (((discAzimuthOf(frame, star) - frame.sectorPhaseRad) % TAU) + TAU) % TAU;
      const wedge = Math.min(frame.sectorCount - 1, Math.floor(offset / wedgeRad));
      expect(star.address.levels[1], formatAddress(star.address)).toBe(wedge);
      expect(wedge).toBeGreaterThanOrEqual(0);
      expect(wedge).toBeLessThan(frame.sectorCount);
    }
  });

  it('agrees with the sector the star’s address was written from', () => {
    // The re-key took the label from the drawn angle; `sectorOfStar` must still answer the same
    // number, or a regenerated address and the drawn star would disagree. Star -2 in `v1/4` is the
    // one `capture/shots.json` pins as `v1/4.0.-2.7`, so that shot's honesty is this assertion.
    expect(sectorOfStar(SEED, parseAddressOrThrow('v1/4'), -2)).toBe(0);
    // And the address the generator hands out is the one this predicate predicts.
    const galaxy = generateGalaxy(SEED, parseAddressOrThrow('v1/4'), 'low');
    for (const star of galaxy.stars.slice(1)) {
      const index = star.address.levels[2];
      if (index === undefined) throw new Error('a star address has no star level');
      expect(star.address.levels[1], formatAddress(star.address)).toBe(
        sectorOfStar(SEED, parseAddressOrThrow('v1/4'), index),
      );
    }
  });

  it('starts every galaxy in sector 0, so Sol keeps its reserved rung', () => {
    // The phase is centred on the home star, which is what lets `v1/0.0.0` mean "sector 0, star 0"
    // in every galaxy rather than in a lucky one. The sign is the trap: the centre is *opposite*
    // the home star, so the home azimuth is `homeAngle`, and it is easy to negate twice.
    for (const galaxyText of ['v1/0', 'v1/1', 'v1/4', 'v1/7']) {
      const frame = galaxyFrame(SEED, parseAddressOrThrow(galaxyText));
      // The home star is the frame origin, so its drawn azimuth is where slice zero must start.
      expect(sectorOfPoint(frame, { x: 0, y: 0, z: 0 }), galaxyText).toBe(0);
    }
  });
});

describe('a sector is not a star', () => {
  it('has no system scene, even though the generator would happily make one', () => {
    // The trap: `generateSystem` is total. Nothing in it refuses a sector address, so a scene
    // switch that asked it to resolve `?addr=v1/4.0` got a complete, invented planetary system for
    // a wedge of the disc. `hasSystemScene` is what the switch now reads; this pins the reason it
    // has to, so a future "simplification" that drops the guard fails here instead of in a shot.
    expect(hasSystemScene(parseAddressOrThrow('v1/4.0'))).toBe(false);
    // It is not that the generator refuses — it does not, and that is the whole hazard.
    expect(generateSystem(SEED, parseAddressOrThrow('v1/4.0')).planets.length).toBeGreaterThan(0);
    // The galaxy itself and a real star both keep their orrery.
    expect(hasSystemScene(parseAddressOrThrow('v1/4'))).toBe(true);
    expect(hasSystemScene(parseAddressOrThrow('v1/4.0.-2.7'))).toBe(true);
  });
});