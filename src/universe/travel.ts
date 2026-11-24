/**
 * Travel between two places: how far, how fast, and how much universe time it costs
 * (ADR-0003, ADR-0010).
 *
 * A committed travel is **one state change**, not a simulation: the address moves once, the
 * clock advances by `d / v(method)`, and the camera lands on the destination's opening view
 * (ADR-0012). The effect that hides the swap is presentation (Layer 4's tier masks); this
 * module only decides what is true afterwards.
 *
 * ## Distance is measured in the shared frame, and only where one exists
 *
 * ADR-0010 says `d` is measured in the parent frame of the crossing. Today the only frame every
 * placed address shares is its **galaxy's** (ADR-0011), so:
 *
 * - two stars in one galaxy, or the galaxy's home star and one of its children, have a real
 *   distance: both are placed in that galaxy's frame;
 * - two galaxies do **not**. Every galaxy node is its own frame origin and no root layout
 *   exists, so a universe-level distance would read zero. `planTravel` returns a `reason`
 *   instead of a fabricated number, and the caller refuses the jump.
 *
 * That is a layout gap, not a different model, and the compass will meet the same one.
 *
 * ## Which method, while levels do not carry a scale
 *
 * ADR-0003's tiers are named by the hierarchy (warp sector-to-system, transwarp system-to-
 * quadrant, subspace galaxy-to-galaxy), but an address level does not say whether it is a
 * sector or a system yet (ADR-0008). Until it does, the method uses the one scale distinction the
 * address already carries: ADR-0011's **local field** (the ~100 ly neighbourhood the picture
 * parallaxes against) versus the **disc** (the rest of the galaxy). A trip inside the local field
 * is a warp; a trip that touches the disc is a transwarp; another galaxy is a subspace jump
 * (which this module then refuses for lack of a distance). The rule is symmetric — a local star
 * and a disc star are a transwarp in both directions — so a round trip cannot disagree with
 * itself. `impulse` is free flight inside one frame, not a travel action, so it is never
 * selected here.
 *
 * The day a level answers "this is a sector", this becomes the hierarchy rule and nothing else
 * changes.
 *
 * ## What is deliberately absent
 *
 * - **No effect duration.** Screen time is a constant per method (council §9), but there is no
 *   effect until the tier masks land, and a constant with no consumer would be a literal with a
 *   test. It arrives with the mask.
 * - **No time rewinding.** A distance is never negative and a speed is positive, so a travel
 *   always moves the clock forward. `advanceClock` in `state/url-state.ts` enforces that.
 */

import { formatAddress, sameAddress, type Address } from '../frame/address';
import { GALAXY_DEPTH, LY_M, galaxyAddressOf } from './disc';
import { placement, starKind } from './placement';

const SECONDS_PER_DAY = 86_400;
const SPEED_OF_LIGHT_M_PER_S = 299_792_458;

export type TravelMethod = 'impulse' | 'warp' | 'transwarp' | 'subspace';

/**
 * ADR-0010's confirmed speed table, metres per second.
 *
 * The imperial spellings are deliberate: these are the numbers the owner confirmed, written as
 * `ly/day` so a reader can check them against the decision without a calculator. The model never
 * depended on their values; the arrival times now do.
 */
export const TRAVEL_SPEED_M_PER_S: Readonly<Record<TravelMethod, number>> = Object.freeze({
  impulse: 0.01 * SPEED_OF_LIGHT_M_PER_S,
  warp: LY_M / SECONDS_PER_DAY,
  transwarp: (100 * LY_M) / SECONDS_PER_DAY,
  subspace: (10_000 * LY_M) / SECONDS_PER_DAY,
});

/** Whether this address belongs to the galaxy's disc population. A galaxy node is its home star. */
function inDisc(address: Address): boolean {
  return address.levels.length > GALAXY_DEPTH && starKind(address) === 'disc';
}

/**
 * The method for a crossing between two places in the same galaxy.
 *
 * Symmetric on purpose: a trip that touches the disc is a transwarp both ways, so going there and
 * coming back cannot pick two different speeds. See the module comment for why the local field is
 * the current stand-in for "sector".
 */
export function methodForPair(from: Address, to: Address): TravelMethod {
  return inDisc(from) || inDisc(to) ? 'transwarp' : 'warp';
}

export interface TravelPlan {
  readonly from: Address;
  readonly to: Address;
  readonly method: TravelMethod;
  /** Metres in the shared frame; `null` when the pair has no shared frame (galaxy to galaxy). */
  readonly distanceM: number | null;
  /** Universe seconds, `distance / speed`; `null` exactly when `distanceM` is. */
  readonly elapsedS: number | null;
  /** Why this pair is not travellable yet; `null` when it is. */
  readonly reason: string | null;
}

function refused(
  from: Address,
  to: Address,
  method: TravelMethod,
  reason: string,
): TravelPlan {
  return { from, to, method, distanceM: null, elapsedS: null, reason };
}

/**
 * The travel plan from `from` to `to`, or the reason there isn't one.
 *
 * Always returns a plan so a caller can show *why* a destination is out of reach instead of
 * crashing. A plan with a `reason` must not be applied; `distanceM` and `elapsedS` are null
 * together by construction.
 */
export function planTravel(seed: string, from: Address, to: Address): TravelPlan {
  if (sameAddress(from, to)) {
    return refused(from, to, 'warp', 'you are already there');
  }
  if (from.version !== to.version) {
    return refused(
      from,
      to,
      'warp',
      `address version ${from.version} cannot travel to version ${to.version}`,
    );
  }
  if (from.levels.length === 0 || to.levels.length === 0) {
    return refused(from, to, 'warp', 'the root has no position; zoom out instead of travelling to it');
  }

  const fromGalaxy = galaxyAddressOf(from);
  const toGalaxy = galaxyAddressOf(to);
  if (!sameAddress(fromGalaxy, toGalaxy)) {
    // Refuse rather than return zero: every galaxy node is its own origin, so a root-level
    // distance would read 0 and the jump would cost no time — a plausible-looking falsehood.
    return refused(
      from,
      to,
      'subspace',
      `distance between galaxies ${formatAddress(fromGalaxy)} and ${formatAddress(toGalaxy)} ` +
        'is not modelled yet (no root layout)',
    );
  }

  // Both addresses are in one galaxy, so both placements are in that galaxy's frame: a galaxy
  // node is its home star at the origin, and anything deeper is a placed star.
  const a = placement(seed, from);
  const b = placement(seed, to);
  if (!a || !b) {
    return refused(from, to, 'warp', 'one of those places has no position');
  }

  const distanceM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const method = methodForPair(from, to);
  return {
    from,
    to,
    method,
    distanceM,
    elapsedS: distanceM / TRAVEL_SPEED_M_PER_S[method],
    reason: null,
  };
}