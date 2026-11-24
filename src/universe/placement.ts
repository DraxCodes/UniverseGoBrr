/**
 * `placement(seed, address)` — where a place is, in its parent's frame (ADR-0011).
 *
 * **Direction is the whole contract: address → position, never position → address.** Asking "that
 * star, there — which address is it?" would make the picture authoritative, and then a quality
 * drop or a nebula's extent would have to be reconciled against a list whose size changes. Here the
 * address is the identity (ADR-0005) and this function only says where it sits.
 *
 * It uses the *same* disc law as `generateGalaxy` (`disc.ts`), not a copy of it: a placed star lands
 * in the same bulge, the same exponential disc and on the same two arms the picture draws. Without
 * that, the compass would point at empty space and `d` in `Δt = d/v` (ADR-0010) would be a number
 * about nothing.
 *
 * What this does **not** yet do, stated plainly:
 *
 * - the renderer still draws its own stream sample, so a drawn light does not carry an address
 *   until the picture is switched to draw placement results. Placement and the population agree on
 *   the *law* today; agreeing on the *list* is the next step;
 * - the local field (the ~100 ly neighbourhood) is a separate sample and is not addressable yet;
 * - an authored node's placement is procedural like any other. Sol's real 26,000 ly is a later
 *   data change, not a different mechanism (ADR-0011).
 */

import { fnv1a32 } from '../lib/hash';
import { createRng } from '../lib/random';
import { formatAddress, type Address } from '../frame/address';
import { GALAXY_DEPTH, galaxyAddressOf, type Vec3 } from './galaxy';
import { galaxyFrame, sampleDiscStar } from './disc';

/**
 * Bumped when a placed position changes for the same `(seed, address)`.
 *
 * Same rule as `SYSTEM_VERSION` and `GALAXY_VERSION`: a shared link must re-pin, and a position is
 * content. Tuning the disc law bumps `GALAXY_STREAM_VERSION` as well; this constant exists so a
 * placement-only change cannot silently move the picture too.
 */
export const PLACEMENT_VERSION = 1;

/** The RNG key for one address's placement. Exported so a test can replay it. */
export function placementKey(seed: string, address: Address): string {
  return `${seed}|${formatAddress(address)}|placement|v${PLACEMENT_VERSION}`;
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
 * - **anything deeper** is a star placed by the disc law, relative to the galaxy's home star —
 *   the same coordinate space `GalaxyStar` uses, so the renderer can subtract the camera exactly as
 *   Layer 2 already does (ADR-0008).
 */
export function placement(seed: string, address: Address): Vec3 | null {
  const depth = address.levels.length;

  if (depth === 0) return null;

  // The galaxy's own node is the frame origin. Deeper levels are stars in that same galaxy: the
  // normalisation is why two neighbours share one sky (ADR-0011), and why this function's answer
  // for `v1/4.9` and `v1/4.9.9` is in the same disc.
  if (depth <= GALAXY_DEPTH) return { x: 0, y: 0, z: 0 };

  const frame = galaxyFrame(seed, galaxyAddressOf(address));
  const rng = createRng(fnv1a32(placementKey(seed, address)));
  const sample = sampleDiscStar(rng, frame);
  return { x: sample.x, y: sample.y, z: sample.z };
}