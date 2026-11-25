/**
 * `placement(seed, address)` — where a place is, in its parent's frame (ADR-0011).
 *
 * **Direction is the whole contract: address → position, never position → address.** Asking "that
 * star, there — which address is it?" would make the picture authoritative, and then a quality
 * drop or a nebula's extent would have to be reconciled against a list whose size changes. Here the
 * address is the identity (ADR-0005) and this function only says where it sits.
 *
 * It is the *same* function the picture calls. `generateGalaxy` walks the galaxy's children and
 * asks `placedStarIn` for each one, so a drawn light carries the address that produced it and
 * arriving there shows the same position. Nothing is mapped back from a drawn star.
 *
 * ## Which law a child gets
 *
 * The galaxy has two populations: the **local field** (a uniform ball inside 100 ly of home) and
 * the **disc** (bulge + exponential disc + two arms). Which one an address belongs to has to be a
 * property of the address, not of the iterator, or placement and the picture could disagree.
 *
 * Until levels carry kinds (ADR-0008), one integer in nine is local: `level % 9 === 0`. That is a
 * documented placeholder with two useful properties — it makes the scan bounded and exact (one in
 * nine is the rich/medium budget ratio), and it keeps a tier's lists prefixes of the richer
 * tier's. The day a level answers "local field" for itself, this rule becomes that answer and
 * nothing else changes.
 *
 * What this does **not** do: an authored node's placement is procedural like any other. Sol's real
 * 26,000 ly is a later data change, not a different mechanism. And a node deeper than a star is
 * still placed in the galaxy frame rather than its parent star's frame, because levels do not carry
 * a scale yet; the picture only draws depth-2 children, so no drawn light depends on that.
 */

import { fnv1a32 } from '../lib/hash';
import { createRng } from '../lib/random';
import { childAddress, formatAddress, type Address } from '../frame/address';
import {
  GALAXY_DEPTH,
  SECTOR_DEPTH,
  contentKey,
} from './levels';
import {
  galaxyAddressOf,
  galaxyFrame,
  sampleDiscStar,
  sampleLocalStar,
  sectorOfPoint,
  sectorPosition,
  type GalaxyFrame,
  type Vec3,
} from './disc';

/**
 * Bumped when a placed position changes for the same `(seed, address)`.
 *
 * Same rule as `SYSTEM_VERSION` and `GALAXY_VERSION`: a shared link must re-pin, and a position is
 * content. Changing the disc *law* moves every placed star, so it bumps this; changing only the
 * frame (centre and arm phase) bumps `GALAXY_STREAM_VERSION`, because that moves the frame the
 * positions are measured in without changing the placement rule itself.
 *
 * 1 → 2: one child in nine is now a local-field star rather than a disc star, so those addresses
 * are different places. The key change re-rolls all of them, which is the honest version signal.
 *
 * **Stays 2 through the sector insertion, deliberately.** The insertion moves no star, so bumping
 * this would be a claim that positions changed when the whole point is that they did not. The key
 * below reproduces the pre-re-key string exactly for every star, which is what makes that true.
 *
 * 2 → 3: **the galaxy variation law moves every placed star** (ticket 06, item 4). The radius is
 * drawn per galaxy rather than a constant, so every radial draw is a different number of metres;
 * and a disc-kind star now draws halo membership before its radius. Both are changes to the disc
 * *law*, which is exactly the case this comment says bumps the version. Unlike the sector
 * insertion, this one really does move positions, so the key has to say so.
 */
export const PLACEMENT_VERSION = 3;

/** One galaxy child in this many is a local-field star. Kept in step with the rich tier's ratio. */
export const LOCAL_STAR_EVERY = 9;

export type StarKind = 'local' | 'disc';

/**
 * Which population the star with identity integer `index` belongs to.
 *
 * The identity is the level the **old** address carried at depth 2 (`v1/4.-7` → `-7`), kept when
 * the sector rung is inserted above it (`v1/4.2.-7`). Before the insertion this rule read
 * `levels[GALAXY_DEPTH]` and got the same integer, so one child in nine is still local: the
 * insertion must not re-roll which stars are near home (ADR-0023).
 *
 * Written against the integer rather than an address because the generator walks **identities**,
 * not addresses: it has to place a star before it knows which sector that star's angle falls in.
 */
export function starKindOfIndex(index: number): StarKind {
  return Math.abs(index) % LOCAL_STAR_EVERY === 0 ? 'local' : 'disc';
}

/**
 * Which population the star at `address` belongs to.
 *
 * A star's identity is the level **below the sector rung**: `v1/4.2.-7` is the star `-7` in
 * sector 2. The galaxy walk emits addresses of exactly that shape, and a body
 * (`v1/4.2.-7.3`) answers for the star it orbits — deeper levels do not change which star it is.
 *
 * **The address must be deeper than a sector, and this throws if it is not.** A sector
 * (`v1/4.2`) is not a star and must never be classified as one: it used to fall back to level 0,
 * which classified every child of the *root* as a local-field star, and the generator then never
 * filled its disc list and spun forever on a crafted `?addr=v1/`. A contract violation must be
 * loud, not a plausible-looking kind. `generateGalaxy` guards the root before calling this.
 */
export function starKind(address: Address): StarKind {
  if (address.levels.length <= SECTOR_DEPTH) {
    throw new Error(
      `starKind needs an address deeper than a sector; got ${formatAddress(address)} ` +
        `(${address.levels.length} level${address.levels.length === 1 ? '' : 's'})`,
    );
  }
  return starKindOfIndex(address.levels[SECTOR_DEPTH]!);
}

/** One placed star: its position plus the sample metadata the appearance law needs. */
export interface PlacedStar {
  readonly position: Vec3;
  readonly kind: StarKind;
  /** Disc-only; false for local stars. */
  readonly inBulge: boolean;
  /** Disc-only; true for a star on the galaxy's halo tail. */
  readonly inHalo: boolean;
  /** Disc-only, metres from the galactic centre; 0 for local stars (their nucleus falloff is 1). */
  readonly fromCentre: number;
  /** Disc-only, 0..1; 0 for local stars. */
  readonly armMix: number;
}

/**
 * The RNG key for one address's position. Exported so a test can replay it.
 *
 * **Keyed on the address with the sector rung removed**, so a sector is transparent to position:
 * `v1/4.2.-7` and the pre-re-key `v1/4.-7` produce the *same* string, hence the same stream, hence
 * the same point. This is the ADR-0023 mechanic, and it must stay in step with the identity the
 * sector was derived from — if this keyed on the full address, inserting the rung would re-roll
 * every star in every galaxy while the commit message claimed the galaxy was unchanged.
 */
export function placementKey(seed: string, address: Address): string {
  return contentKey(seed, address, 'placement', PLACEMENT_VERSION);
}

/**
 * Place `address` in the galaxy described by `frame`.
 *
 * The hot path: the generator already has the frame, so it must not recompute it per star. The
 * address must be a child of that frame's galaxy — deeper than `SECTOR_DEPTH`, so the star level
 * exists (`placementKey` then drops everything from the sector rung down, which is what makes
 * `v1/4.s.3` and `v1/4.3` the same place).
 */
export function placedStarIn(frame: GalaxyFrame, seed: string, address: Address): PlacedStar {
  return sampleStar(frame, seed, address, starKind(address));
}

/** The one sampling body, so the generator's index-keyed path and the address-keyed path agree. */
function sampleStar(
  frame: GalaxyFrame,
  seed: string,
  keyAddress: Address,
  kind: StarKind,
): PlacedStar {
  const rng = createRng(fnv1a32(placementKey(seed, keyAddress)));

  if (kind === 'local') {
    return {
      position: sampleLocalStar(rng),
      kind,
      inBulge: false,
      inHalo: false,
      fromCentre: 0,
      armMix: 0,
    };
  }

  const sample = sampleDiscStar(rng, frame);
  return {
    position: { x: sample.x, y: sample.y, z: sample.z },
    kind,
    inBulge: sample.inBulge,
    inHalo: sample.inHalo,
    fromCentre: sample.fromCentre,
    armMix: sample.armMix,
  };
}

/**
 * Place the star with identity integer `index` in `galaxyAddress`.
 *
 * This is the **generator's** entry point, and it exists because the walk runs in the opposite
 * order from `placedStarIn`: the generator knows the star's identity before it knows the sector
 * its angle falls in, so it cannot build the address first. It does not need to — the sector rung
 * is transparent to position, so keying on the rung-stripped address (`galaxy.index`) is exactly
 * the same stream the finished address (`galaxy.sector.index`) would produce.
 */
export function placedStarForIndex(
  frame: GalaxyFrame,
  seed: string,
  galaxyAddress: Address,
  index: number,
): PlacedStar {
  return sampleStar(frame, seed, childAddress(galaxyAddress, index), starKindOfIndex(index));
}

/**
 * The address the star with identity `index` has, once its sector is known: `galaxy.sector.index`
 * (ADR-0023). In one place because a star's address is derived, never typed, and a caller that
 * built it by hand could disagree with the generator.
 */
export function starAddressAt(
  galaxyAddress: Address,
  sectorIndex: number,
  index: number,
): Address {
  return childAddress(childAddress(galaxyAddress, sectorIndex), index);
}

/**
 * Which sector the star with identity `index` belongs to, derived from the angle it is drawn at.
 *
 * This is the whole of ADR-0023 in one call, and it is deliberately computed from the **placed
 * position** rather than from a separate roll: the sector a star is filed under and the wedge it is
 * visibly inside can then never disagree. `generateGalaxy` inlines the same two steps because it
 * already has the `PlacedStar`; this export is for callers (and tests) that only know the identity.
 */
export function sectorOfStar(seed: string, galaxyAddress: Address, index: number): number {
  const frame = galaxyFrame(seed, galaxyAddress);
  const placed = placedStarForIndex(frame, seed, galaxyAddress, index);
  return sectorOfPoint(frame, placed.position);
}

/**
 * Place `address`, computing its galaxy frame first. Returns `null` for the root and for a galaxy
 * node — those are not stars; use `placement` if you want the galaxy node's origin.
 */
export function placedStar(seed: string, address: Address): PlacedStar | null {
  if (address.levels.length <= GALAXY_DEPTH) return null;
  return placedStarIn(galaxyFrame(seed, galaxyAddressOf(address)), seed, address);
}

/**
 * The position of the node at `address`, in its parent frame, in metres, or `null` for the root.
 *
 * Cases, because an address is not always a star:
 *
 * - **the root** (`v1/`) is the container of everything and sits nowhere. It returns `null`, the
 *   same way `parentAddress` does: zooming out to the top is a normal state, not a programmer
 *   error, and a compass built on this must be able to say "no position" without crashing.
 * - **a galaxy** (its own level, `v1/4`) is that frame's origin: its home star *is* where the
 *   camera orbits, so `{0,0,0}` is the honest position **within the galaxy's own frame**. Its
 *   position in the root is not modelled yet; no root layout exists.
 * - **a sector** (`v1/4.2`) is the middle of its wedge at mid-radius (ADR-0023). A sector owns the
 *   whole radial extent of its slice, so this is a representative point rather than a centroid —
 *   but it is a real place with a real distance and bearing, which is what makes a sector a travel
 *   destination rather than only a label.
 * - **anything deeper** is a star placed by the local or disc law, relative to the galaxy's home
 *   star — the same coordinate space `GalaxyStar` uses, so the renderer can subtract the camera
 *   exactly as Layer 2 already does (ADR-0008). A body sits where its star is: the star is the
 *   level below the sector rung, so `placementKey` discards the body's own levels too.
 */
export function placement(seed: string, address: Address): Vec3 | null {
  const depth = address.levels.length;

  if (depth === 0) return null;
  if (depth <= GALAXY_DEPTH) return { x: 0, y: 0, z: 0 };
  if (depth === SECTOR_DEPTH) {
    const frame = galaxyFrame(seed, galaxyAddressOf(address));
    return sectorPosition(frame, address.levels[SECTOR_DEPTH - 1]!);
  }

  return placedStar(seed, address)!.position;
}