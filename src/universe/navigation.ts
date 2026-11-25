/**
 * Navigation from where you are: what the compass offers, and what "zoom out" means
 * (spec §3.2, §5; ADR-0003, ADR-0011, ADR-0013).
 *
 * Two questions, one module, because they are two answers to the same question — *what is within
 * reach of this address?*
 *
 * ## Anchors are content, not a trail
 *
 * The council's critique was that anchors could be the places you happened to visit (cheap, and a
 * lie about the neighbourhood) or the places that actually exist near you (honest, and a search).
 * They are content: an anchor is a star the galaxy really draws, with the address that produced it
 * (ADR-0011). The caller passes the drawn population it already has, so this module does no
 * generation and cannot disagree with the picture.
 *
 * That also decides the search: `nearestAnchors` scans what it is given once, keeping the nearest
 * `limit`, so its cost is linear in the drawn population and independent of the address. Nothing
 * here enumerates an address space — an unbounded level index must never become an unbounded loop.
 *
 * ## Two numbers, two origins, on purpose
 *
 * - **Distance is from the place** (the address node), because that is the `d` a jump is charged
 *   for (ADR-0010) and it does not move when you orbit or zoom.
 * - **Bearing is from the eye**, because a compass points where you are looking from.
 *
 * Mixing them is not an accident to tidy up later: a distance that changed every drag frame would
 * make a list flicker, and a bearing measured from the node would be a bearing you can never act
 * on.
 *
 * ## Zoom out means the galaxy, and only the galaxy
 *
 * "Each line clickable to zoom out" is spec §5, but a level does not yet say what it is
 * (ADR-0008): an address three levels deep is not known to be a body inside a system. Dropping one
 * level from such an address would re-render a *different system at zero motion* — a visible change
 * with no motion, which is the worst of both. So v1 offers exactly one honest target: the galaxy
 * this address belongs to, which is where the picture genuinely is a different scale.
 *
 * The root is refused rather than approximated: `galaxyPosition` now places each galaxy (ticket 06,
 * item 3), so a cross-galaxy *travel* has a distance - but there is still no root **scene** to zoom
 * out into, so "the whole universe" remains a destination without a view.
 *
 * Free is deliberate. A zoom-out changes the address but is not a journey: no universe time passes
 * (ADR-0013). It still gets a history entry, because Back retraces places and this is one.
 */

import { ancestorAddress, formatAddress, sameAddress, type Address } from '../frame/address';
import type { Vec3 } from '../frame/position';
import { cameraBasis } from '../render/camera';
import { galaxyFramingDistanceM } from '../render/scale';
import type { Camera } from '../state/url-state';
import { GALACTIC_PLANE_NORMAL, GALAXY_DEPTH } from './disc';

/** A drawn star: an address and where it sits, in its galaxy's frame. */
export interface AnchorCandidate {
  readonly address: Address;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Anchor {
  readonly address: Address;
  /** Metres from the current place, not from the eye. This is the jump's `d`. */
  readonly distanceM: number;
  /** Position relative to the current place's origin: what a bearing is computed from. */
  readonly offset: Vec3;
  /** True for the galaxy's home star, whose address is the galaxy itself. */
  readonly home: boolean;
}

/**
 * The `limit` nearest candidates to `fromPosition`, excluding the place itself.
 *
 * Deterministic: ties are broken by address text, so the list cannot reorder between two loads of
 * the same link. Positions are compared in one frame (the galaxy's), which is the only frame every
 * drawn star shares — the caller is responsible for that, and it is why a galaxy's star list is the
 * only sensible input.
 */
export function nearestAnchors(
  candidates: readonly AnchorCandidate[],
  from: Address,
  fromPosition: Vec3,
  limit: number,
): Anchor[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const home = galaxyOf(from);
  const best: Anchor[] = [];
  for (const candidate of candidates) {
    if (sameAddress(candidate.address, from)) continue;
    const offset = {
      x: candidate.x - fromPosition.x,
      y: candidate.y - fromPosition.y,
      z: candidate.z - fromPosition.z,
    };
    const distanceM = Math.hypot(offset.x, offset.y, offset.z);
    if (!Number.isFinite(distanceM) || distanceM === 0) continue;

    insert(
      best,
      {
        address: candidate.address,
        distanceM,
        offset,
        home: sameAddress(candidate.address, home),
      },
      limit,
    );
  }
  return best;
}

/** Insert keeping `best` sorted by distance, dropping the worst once it is full. */
function insert(best: Anchor[], anchor: Anchor, limit: number): void {
  let index = best.length;
  while (index > 0 && compare(anchor, best[index - 1]!) < 0) index -= 1;
  if (index >= limit) return;
  best.splice(index, 0, anchor);
  if (best.length > limit) best.pop();
}

function compare(a: Anchor, b: Anchor): number {
  if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
  return formatAddress(a.address) < formatAddress(b.address) ? -1 : 1;
}

/** The galaxy an address belongs to; used only to label the home star. */
function galaxyOf(address: Address): Address {
  return ancestorAddress(address, GALAXY_DEPTH);
}

/** Where a target sits relative to the camera: ahead/behind, left/right, up/down. */
export interface Bearing {
  /** Radians in the view plane: 0 is straight ahead, positive is to the right. */
  readonly bearingRad: number;
  /** Radians above the view plane, -π/2..π/2. */
  readonly elevationRad: number;
}

/**
 * The direction to `target` as seen from the camera, in the camera's own basis.
 *
 * Checked arithmetic, not an animation (council §9): it is the renderer's `cameraBasis` and two
 * dot products, so the number the HUD prints is the direction the eye is actually pointing. Both
 * arguments are offsets from the frame origin — the camera's position **is** the eye in a
 * camera-relative scene (ADR-0008), so no `origin + offset` is ever formed.
 */
export function bearingOf(camera: Camera, target: Vec3): Bearing {
  const { right, up, forward } = cameraBasis(camera.yaw, camera.pitch);
  const dx = target.x - camera.x;
  const dy = target.y - camera.y;
  const dz = target.z - camera.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 0)) return { bearingRad: 0, elevationRad: 0 };

  const x = dx * right.x + dy * right.y + dz * right.z;
  const y = dx * up.x + dy * up.y + dz * up.z;
  const z = dx * forward.x + dy * forward.y + dz * forward.z;

  return {
    bearingRad: Math.atan2(x, z),
    elevationRad: Math.asin(Math.min(1, Math.max(-1, y / length))),
  };
}

export type ZoomOutPlan =
  | { readonly ok: true; readonly address: Address }
  | { readonly ok: false; readonly reason: string };

/**
 * The address one line of the address HUD stands for, or why that line cannot be followed.
 *
 * `depth` is the number of levels the target keeps: `0` is the root, `GALAXY_DEPTH` is the galaxy.
 * See the module comment for why only the galaxy is a real target yet.
 */
export function planZoomOut(from: Address, depth: number): ZoomOutPlan {
  if (!Number.isInteger(depth) || depth < 0) {
    return { ok: false, reason: `there is no level ${String(depth)} in an address` };
  }
  if (depth >= from.levels.length) {
    return { ok: false, reason: 'that line is where you already are' };
  }
  if (depth === 0) {
    return {
      ok: false,
      reason: 'the whole universe has no layout yet, so there is nowhere to stand outside a galaxy',
    };
  }
  if (depth !== GALAXY_DEPTH) {
    return {
      ok: false,
      reason:
        'the galaxy is the only rung with a scene to zoom out to so far; a sector is a real ' +
        'address level but its view is ticket 06 item 2, not built yet',
    };
  }
  return { ok: true, address: ancestorAddress(from, depth) };
}

/** The orbit angles and distance that show a whole galaxy. */
export interface GalaxyFraming {
  readonly yaw: number;
  readonly pitch: number;
  readonly distanceM: number;
}

/**
 * The camera for "zoom out to the galaxy", given the galactic centre's offset from the home star.
 *
 * Two decisions, both forced by the scene:
 *
 * - **Face-on.** The view is down the disc's own axis, from its `+normal` side. World `+y` is not
 *   that axis after `GALACTIC_PLANE_TILT_RAD`, and the first version of this kept the star's yaw,
 *   which put the eye almost exactly in the plane: the galaxy arrived as a band and the arm
 *   crossfade called it illegible. A zoom-out that does not show a galaxy is not a zoom-out.
 * - **Far enough for the whole disc.** The orbit camera looks at the frame origin, which is the
 *   home star and not the galactic centre, so the disc is off-centre in the view. The distance
 *   comes from `galaxyFramingDistanceM`, which accounts for that offset instead of assuming the
 *   disc is centred.
 *
 * The position is left to `orbitTo(framing.yaw, framing.pitch, framing.distanceM)`, so the eye
 * stays on the ray its angles describe and the next drag does not snap (the orbit invariant).
 */
export function galaxyFraming(centre: Vec3): GalaxyFraming {
  // Forward is the direction the camera looks: from the eye, on the +normal side, back at the
  // origin. `cameraBasis` inverts to yaw = atan2(−forward.x, −forward.z), pitch = asin(forward.y).
  const forward = {
    x: -GALACTIC_PLANE_NORMAL.x,
    y: -GALACTIC_PLANE_NORMAL.y,
    z: -GALACTIC_PLANE_NORMAL.z,
  };
  return {
    yaw: Math.atan2(-forward.x, -forward.z),
    pitch: Math.asin(Math.min(1, Math.max(-1, forward.y))),
    distanceM: galaxyFramingDistanceM(Math.hypot(centre.x, centre.y, centre.z)),
  };
}
