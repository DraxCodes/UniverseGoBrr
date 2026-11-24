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
import { formatAddress, type Address } from '../frame/address';
import {
  GALAXY_DEPTH,
  galaxyAddressOf,
  galaxyFrame,
  sampleDiscStar,
  sampleLocalStar,
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
 */
export const PLACEMENT_VERSION = 2;

/** One galaxy child in this many is a local-field star. Kept in step with the rich tier's ratio. */
export const LOCAL_STAR_EVERY = 9;

export type StarKind = 'local' | 'disc';

/**
 * Which population the child at `address` belongs to.
 *
 * The child index is the first level below the galaxy (`levels[GALAXY_DEPTH]`); deeper levels are
 * sub-objects of the same star and do not change its kind.
 *
 * **The address must be deeper than a galaxy, and this throws if it is not.** It used to fall back
 * to level 0, which classified every child of the *root* as a local-field star; the generator then
 * never filled its disc list and spun forever on a crafted `?addr=v1/`. A contract violation must
 * be loud, not a plausible-looking kind. `generateGalaxy` guards the root before calling this.
 */
export function starKind(address: Address): StarKind {
  const level = address.levels[GALAXY_DEPTH];
  if (level === undefined) {
    throw new Error(
      `starKind needs an address deeper than a galaxy; got ${formatAddress(address)} ` +
        `(${address.levels.length} level${address.levels.length === 1 ? '' : 's'})`,
    );
  }
  return Math.abs(level) % LOCAL_STAR_EVERY === 0 ? 'local' : 'disc';
}

/** One placed star: its position plus the sample metadata the appearance law needs. */
export interface PlacedStar {
  readonly position: Vec3;
  readonly kind: StarKind;
  /** Disc-only; false for local stars. */
  readonly inBulge: boolean;
  /** Disc-only, metres from the galactic centre; 0 for local stars (their nucleus falloff is 1). */
  readonly fromCentre: number;
  /** Disc-only, 0..1; 0 for local stars. */
  readonly armMix: number;
}

/** The RNG key for one address's position. Exported so a test can replay it. */
export function placementKey(seed: string, address: Address): string {
  return `${seed}|${formatAddress(address)}|placement|v${PLACEMENT_VERSION}`;
}

/**
 * Place `address` in the galaxy described by `frame`.
 *
 * The hot path: the generator already has the frame, so it must not recompute it per star. The
 * address must be a child of that frame's galaxy (deeper than `GALAXY_DEPTH`).
 */
export function placedStarIn(frame: GalaxyFrame, seed: string, address: Address): PlacedStar {
  const kind = starKind(address);
  const rng = createRng(fnv1a32(placementKey(seed, address)));

  if (kind === 'local') {
    return {
      position: sampleLocalStar(rng),
      kind,
      inBulge: false,
      fromCentre: 0,
      armMix: 0,
    };
  }

  const sample = sampleDiscStar(rng, frame);
  return {
    position: { x: sample.x, y: sample.y, z: sample.z },
    kind,
    inBulge: sample.inBulge,
    fromCentre: sample.fromCentre,
    armMix: sample.armMix,
  };
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
 * - **anything deeper** is a star placed by the local or disc law, relative to the galaxy's home
 *   star — the same coordinate space `GalaxyStar` uses, so the renderer can subtract the camera
 *   exactly as Layer 2 already does (ADR-0008).
 */
export function placement(seed: string, address: Address): Vec3 | null {
  const depth = address.levels.length;

  if (depth === 0) return null;
  if (depth <= GALAXY_DEPTH) return { x: 0, y: 0, z: 0 };

  return placedStar(seed, address)!.position;
}