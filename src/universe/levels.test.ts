import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import {
  BODY_DEPTH,
  GALAXY_DEPTH,
  SECTOR_COUNT_MAX,
  SECTOR_COUNT_MIN,
  SECTOR_DEPTH,
  SYSTEM_DEPTH,
  UNIVERSE_DEPTH,
  contentKey,
  galaxySizeFraction,
  hasSystemScene,
  isKind,
  kindOfAddress,
  levelKindAt,
  sectorCount,
  sectorCountForSize,
  sectorIndexForAngle,
} from './levels';

describe('the address ladder', () => {
  it('names every rung in the order the spec does', () => {
    expect(levelKindAt(UNIVERSE_DEPTH)).toBe('universe');
    expect(levelKindAt(GALAXY_DEPTH)).toBe('galaxy');
    expect(levelKindAt(SECTOR_DEPTH)).toBe('sector');
    expect(levelKindAt(SYSTEM_DEPTH)).toBe('system');
    expect(levelKindAt(BODY_DEPTH)).toBe('body');
  });

  it('is total below the root and unbounded above a body', () => {
    // A negative depth is not reachable from a parsed address, but a total function should still
    // answer rather than return undefined and let a caller read `.kind` off nothing.
    expect(levelKindAt(-3)).toBe('universe');
    expect(levelKindAt(4)).toBe('body');
    expect(levelKindAt(9)).toBe('body');
    expect(levelKindAt(64)).toBe('body');
  });

  it('reads the kind of a real address from its own last level', () => {
    expect(kindOfAddress(parseAddressOrThrow('v1/'))).toBe('universe');
    expect(kindOfAddress(parseAddressOrThrow('v1/0'))).toBe('galaxy');
    expect(kindOfAddress(parseAddressOrThrow('v1/0.3'))).toBe('sector');
    expect(kindOfAddress(parseAddressOrThrow('v1/0.3.1'))).toBe('system');
    expect(kindOfAddress(parseAddressOrThrow('v1/0.3.1.2'))).toBe('body');
    // Deep bodies keep answering "body" rather than running out of ladder.
    expect(kindOfAddress(parseAddressOrThrow('v1/0.3.1.2.5.6'))).toBe('body');
  });

  it('agrees with itself through the isKind helper', () => {
    const galaxy = parseAddressOrThrow('v1/0');
    expect(isKind(galaxy, 'galaxy')).toBe(true);
    expect(isKind(galaxy, 'sector')).toBe(false);
  });

  it('knows which rungs have a star system for a scene', () => {
    // The predicate the scene switch reads (`main.ts`). A sector is the interesting answer: the
    // generator is total, so *without* this a crafted `?addr=v1/4.0` drew a complete invented
    // planetary system for a wedge that has no star in it.
    expect(hasSystemScene(parseAddressOrThrow('v1/'))).toBe(false);
    expect(hasSystemScene(parseAddressOrThrow('v1/0'))).toBe(true);
    expect(hasSystemScene(parseAddressOrThrow('v1/0.3'))).toBe(false);
    expect(hasSystemScene(parseAddressOrThrow('v1/0.3.1'))).toBe(true);
    expect(hasSystemScene(parseAddressOrThrow('v1/0.3.1.2'))).toBe(true);
    // Deeper than a body is still a body, so it is still the star's system.
    expect(hasSystemScene(parseAddressOrThrow('v1/0.3.1.2.5'))).toBe(true);
  });

  it('puts a star one level deeper than it used to be', () => {
    // This is the re-key in one assertion. A star used to sit at depth 2 (v1/4.-2 is a star in
    // the layer-2 shots); after the sector rung, depth 2 is a sector and the star is at depth 3.
    expect(kindOfAddress(parseAddressOrThrow('v1/0.3'))).toBe('sector');
    expect(kindOfAddress(parseAddressOrThrow('v1/0.3.7'))).toBe('system');
    // A system address that already existed keeps its rung: depth 3 was and is a system.
    expect(kindOfAddress(parseAddressOrThrow('v1/4.-2.7'))).toBe('system');
  });

  it('keeps Sol at the same rung after the shift', () => {
    // Sol is reserved at v1/0.0.0 (ADR-0009) and that is depth 3 = system, which is what it is.
    // Inserting a *sector* at depth 2 does not move a system rung; what moves is depth 2, which
    // goes from "a star" to "a sector". So Sol's address is unchanged and the authored registry
    // does not have to move - but every address that named a star one level shallower does.
    expect(kindOfAddress(parseAddressOrThrow('v1/0.0.0'))).toBe('system');
    expect(kindOfAddress(parseAddressOrThrow('v1/0.0'))).toBe('sector');
  });
});

describe('the sector count law', () => {
  it('never leaves the 1..6 band', () => {
    for (const s of [-1, 0, 0.01, 0.5, 0.99, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const count = sectorCountForSize(s);
      expect(count).toBeGreaterThanOrEqual(SECTOR_COUNT_MIN);
      expect(count).toBeLessThanOrEqual(SECTOR_COUNT_MAX);
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it('gives a tiny galaxy one sector and the largest six', () => {
    expect(sectorCountForSize(0)).toBe(1);
    expect(sectorCountForSize(0.1)).toBe(1);
    expect(sectorCountForSize(1)).toBe(6);
  });

  it('gives a Milky-Way-sized galaxy four', () => {
    // The owner's model is concrete: "a Milky-Way-sized one gets 4".
    expect(sectorCountForSize(0.8)).toBe(4);
    expect(sectorCountForSize(0.75)).toBe(4);
  });

  it('never decreases as the galaxy grows', () => {
    // A bigger galaxy must not have fewer sectors than a smaller one, or size and sector count
    // would contradict each other in the HUD.
    let previous = 0;
    for (let s = 0; s <= 1; s += 0.01) {
      const count = sectorCountForSize(s);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('is stable and in band for a real galaxy address', () => {
    const galaxy = parseAddressOrThrow('v1/0');
    const first = sectorCount('ugb-0000', galaxy);
    expect(sectorCount('ugb-0000', galaxy)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(SECTOR_COUNT_MIN);
    expect(first).toBeLessThanOrEqual(SECTOR_COUNT_MAX);
  });

  it('varies across galaxies rather than giving every galaxy the same count', () => {
    const counts = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => sectorCount('ugb-0000', parseAddressOrThrow(`v1/${n}`))),
    );
    expect(counts.size).toBeGreaterThan(1);
  });
});

describe('the galaxy size law', () => {
  it('stays in [0, 1] and is deterministic', () => {
    for (let n = 0; n < 12; n += 1) {
      const address = parseAddressOrThrow(`v1/${n}`);
      const f = galaxySizeFraction('ugb-0000', address);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(galaxySizeFraction('ugb-0000', address)).toBe(f);
    }
  });

  it('does not give every galaxy the same size', () => {
    // The whole point of the rung: a single global GALAXY_RADIUS_M meant "size" did not exist.
    const sizes = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
        galaxySizeFraction('ugb-0000', parseAddressOrThrow(`v1/${n}`)).toFixed(6),
      ),
    );
    expect(sizes.size).toBeGreaterThan(1);
  });

  it('skews toward large galaxies', () => {
    // Most of the sky should be large, since small galaxies are faint. `sqrt(u)` has a median of
    // ~0.707; a uniform law would sit at 0.5.
    const sizes = Array.from({ length: 400 }, (_, n) =>
      galaxySizeFraction('ugb-0000', parseAddressOrThrow(`v1/${n}`)),
    ).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    expect(median).toBeGreaterThan(0.6);
  });

  it('derives the sector count from the same size it reports', () => {
    // The count must be consistent with the size, or a galaxy could be small and still have six
    // sectors. Recomputing through the public law is the check.
    for (let n = 0; n < 8; n += 1) {
      const address = parseAddressOrThrow(`v1/${n}`);
      expect(sectorCount('ugb-0000', address)).toBe(
        sectorCountForSize(galaxySizeFraction('ugb-0000', address)),
      );
    }
  });
});

describe('the content key', () => {
  it('is the address string without the sector rung, with a stream and its own version', () => {
    // One definition for the mechanic ADR-0023 depends on. Position, appearance and system content
    // all come through here, so pinning the shape here pins all three at once.
    expect(contentKey('ugb-0000', parseAddressOrThrow('v1/4.3.-7'), 'placement', 2)).toBe(
      'ugb-0000|v1/4.-7|placement|v2',
    );
    expect(contentKey('ugb-0000', parseAddressOrThrow('v1/4.3.-7'), 'appearance', 8)).toBe(
      'ugb-0000|v1/4.-7|appearance|v8',
    );
    // A bare sector is not stripped (the `withoutSectorRung` collision), so it keys on itself.
    expect(contentKey('ugb-0000', parseAddressOrThrow('v1/4.3'), 'placement', 2)).toBe(
      'ugb-0000|v1/4.3|placement|v2',
    );
    // The version is the stream's, not a shared one: the same address gives different strings.
    expect(contentKey('ugb-0000', parseAddressOrThrow('v1/4.3.-7'), 'placement', 1)).not.toBe(
      contentKey('ugb-0000', parseAddressOrThrow('v1/4.3.-7'), 'placement', 2),
    );
  });
});

describe('the slice law', () => {
  const TAU = Math.PI * 2;

  it('is total at one sector, the degenerate galaxy', () => {
    // ADR-0018 consequence 6 names this as the case most likely to crash the level model.
    for (const angle of [-10, -0.001, 0, 0.5, Math.PI, TAU, 100]) {
      expect(sectorIndexForAngle(angle, 1, 0)).toBe(0);
    }
  });

  it('always returns an index inside the count', () => {
    for (const count of [1, 2, 3, 4, 5, 6]) {
      for (let i = 0; i < 200; i += 1) {
        const angle = -20 + (i / 200) * 40;
        const index = sectorIndexForAngle(angle, count, 0.7);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
        expect(Number.isInteger(index)).toBe(true);
      }
    }
  });

  it('splits the circle evenly', () => {
    // Four sectors: each quarter belongs to its own sector, with no gap and no overlap.
    for (let k = 0; k < 4; k += 1) {
      const angle = (k + 0.5) * (TAU / 4);
      expect(sectorIndexForAngle(angle, 4, 0)).toBe(k);
    }
  });

  it('wraps rather than producing a negative index', () => {
    // A star at -1 rad in a four-sector galaxy is in the sector that contains 5.283 rad.
    expect(sectorIndexForAngle(-1, 4, 0)).toBe(sectorIndexForAngle(-1 + TAU, 4, 0));
    expect(sectorIndexForAngle(-1, 4, 0)).toBeGreaterThanOrEqual(0);
  });

  it('moves the boundary with the phase', () => {
    // The phase is where slice zero begins; shifting it must move the boundaries, not the count.
    const angle = 0.1;
    expect(sectorIndexForAngle(angle, 4, 0)).toBe(0);
    expect(sectorIndexForAngle(angle, 4, Math.PI / 2)).toBe(3);
  });
});
