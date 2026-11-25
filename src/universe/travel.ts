/**
 * Travel between two places: how far, how fast, and how much universe time it costs
 * (ADR-0003, ADR-0010, ADR-0019).
 *
 * A committed travel is **one state change**, not a simulation: the address moves once, the
 * clock advances by `Δt`, and the camera lands on the destination's opening view (ADR-0012). The
 * effect that hides the swap is presentation (Layer 4's tier masks); this module only decides what
 * is true afterwards.
 *
 * ## Method is a choice, not a consequence (ADR-0019)
 *
 * Earlier this module *derived* the method from the two addresses, so the method was a consequence
 * of the destination. ADR-0019 makes it an **input**: any method works for any trip at or above the
 * system rung, and they differ in cost, not in permission. So `planTravel` prices one method when
 * asked and always reports the cost of every method via `costs`, and a blank method means "recommend
 * the sensible one". The recommendation is advice, never a gate: no validator in this file rejects a
 * method for being too coarse or too fine.
 *
 * ## Distance is measured in the shared frame, and now every pair has one
 *
 * ADR-0010 says `d` is measured in the parent frame of the crossing. Two stars in one galaxy share
 * that galaxy's frame (ADR-0011). Two stars in **different** galaxies now share the root frame too,
 * because `galaxyPosition` gives each galaxy a position in it (ticket 06, item 3). So
 * galaxy-to-galaxy no longer refuses for lack of a distance - it has a real `d`, and therefore a real
 * `Δt = d / v` for every non-wormhole method, and a fixed `Δt` for a wormhole.
 *
 * Before the root layout existed this file refused the jump with "no root layout", which was the
 * honest answer to a missing law rather than a missing feature. That refusal is now gone because the
 * law is here.
 *
 * ## What is deliberately absent
 *
 * - **No effect duration.** Screen time is a constant per method (council §9), but that belongs to
 *   the tier mask, not the plan.
 * - **No time rewinding.** A distance is never negative and a speed is positive, so a travel always
 *   moves the clock forward. `advanceClock` enforces that.
 * - **No energy cost.** Faster is modelled as cheaper in time and nothing else, so hyperspace is not
 *   "expensive" yet. That is the open absolute-scale question in ticket 06, not a modelling choice
 *   this file can make alone.
 */

import { sameAddress, type Address } from '../frame/address';
import { GALAXY_DEPTH, LY_M, galaxyAddressOf } from './disc';
import { galaxyPosition } from './layout';
import { SYSTEM_DEPTH, SECTOR_DEPTH } from './levels';
import { placement, starKind } from './placement';

const SECONDS_PER_DAY = 86_400;
const SPEED_OF_LIGHT_M_PER_S = 299_792_458;

export type TravelMethod = 'impulse' | 'warp' | 'transwarp' | 'hyperspace' | 'wormhole';

/** Every method, in the order the spec's table lists them. Used to price all of them. */
export const TRAVEL_METHODS: readonly TravelMethod[] = Object.freeze([
  'impulse',
  'warp',
  'transwarp',
  'hyperspace',
  'wormhole',
]);

/**
 * ADR-0010's confirmed speed table, metres per second.
 *
 * The imperial spellings are deliberate: these are the numbers the owner confirmed, written as
 * `ly/day` so a reader can check them against the decision without a calculator. `hyperspace`
 * replaces the retired `subspace` name (ADR-0019 §5) at the same 10,000 ly/day. `wormhole` has no
 * speed: its cost is the fixed mouth time below, whatever the distance.
 */
export const TRAVEL_SPEED_M_PER_S: Readonly<Record<Exclude<TravelMethod, 'wormhole'>, number>> =
  Object.freeze({
    impulse: 0.01 * SPEED_OF_LIGHT_M_PER_S,
    warp: LY_M / SECONDS_PER_DAY,
    transwarp: (100 * LY_M) / SECONDS_PER_DAY,
    hyperspace: (10_000 * LY_M) / SECONDS_PER_DAY,
  });

/**
 * A wormhole's fixed cost, seconds, whatever the distance (ADR-0019 §4).
 *
 * **A feel constant and an open question** (ticket 06): the cost is "walking into the mouth", so a
 * moment rather than a voyage. It is not tuned against hyperspace here because the absolute speeds
 * are still open; when the owner settles the timescale this is the one number to revisit. Kept
 * deliberately separate from the speed table so "distance over speed" cannot silently apply to it.
 */
export const WORMHOLE_ELAPSED_S = 3_600;

/** The root-frame position of any place, metres: the galaxy's position plus its offset inside it. */
export function rootPosition(seed: string, address: Address): { x: number; y: number; z: number } | null {
  if (address.levels.length === 0) return null;
  const galaxy = galaxyPosition(seed, galaxyAddressOf(address));
  if (!galaxy) return null;
  const offset = placement(seed, address) ?? { x: 0, y: 0, z: 0 };
  return { x: galaxy.x + offset.x, y: galaxy.y + offset.y, z: galaxy.z + offset.z };
}

/** Metres between two places in the root frame, or `null` when one of them has no position. */
function rootDistance(seed: string, from: Address, to: Address): number | null {
  const a = rootPosition(seed, from);
  const b = rootPosition(seed, to);
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * The recommended method for a crossing between two places in the same galaxy.
 *
 * Symmetric on purpose: a trip that touches the disc is a transwarp both ways, so going there and
 * coming back cannot pick two different speeds.
 *
 * **The one hard rule (ADR-0019 §3): inside one solar system, sublight.** Two addresses that agree
 * down to the system rung are two bodies of one system, and the sensible choice there is impulse.
 * Above that the recommendation falls back to the local-field-versus-disc heuristic until the sector
 * rung is populated; the ladder will replace that fallback with the rung crossed, and only the body
 * of the `else` branch changes.
 */
export function methodForPair(from: Address, to: Address): TravelMethod {
  if (sameSystem(from, to)) return 'impulse';
  const inDisc = (address: Address): boolean => {
    if (address.levels.length <= GALAXY_DEPTH) return false;
    // A **sector** is a slice of the disc by construction (ADR-0018), so a trip that touches one
    // crosses disc distance even though the sector node is not a star and has no star kind.
    if (address.levels.length <= SECTOR_DEPTH) return true;
    return starKind(address) === 'disc';
  };
  return inDisc(from) || inDisc(to) ? 'transwarp' : 'warp';
}

/**
 * Whether two addresses are bodies of the **same** system: they agree on every level down to and
 * including `SYSTEM_DEPTH` (`v1/0.0.0.1` and `v1/0.0.0.2` are two bodies of system `v1/0.0.0`).
 *
 * Both must be at least a body for this to mean anything; a system compared with itself is not two
 * bodies, so that case answers false and falls through to the galaxy-level advice.
 */
function sameSystem(from: Address, to: Address): boolean {
  // Both must at least *be* a system; a star one rung up has no system to belong to.
  if (from.levels.length < SYSTEM_DEPTH || to.levels.length < SYSTEM_DEPTH) return false;
  // And at least one must be a body inside it, or these are the same node rather than two bodies.
  if (from.levels.length === SYSTEM_DEPTH && to.levels.length === SYSTEM_DEPTH) return false;
  for (let i = 0; i < SYSTEM_DEPTH; i += 1) {
    if (from.levels[i] !== to.levels[i]) return false;
  }
  return true;
}

/** How long `method` takes over a crossing of `distanceM`, or `null` if it has no cost model. */
function elapsedFor(method: TravelMethod, distanceM: number | null): number | null {
  if (method === 'wormhole') return WORMHOLE_ELAPSED_S;
  if (distanceM === null) return null;
  return distanceM / TRAVEL_SPEED_M_PER_S[method];
}

export interface MethodCost {
  readonly method: TravelMethod;
  /** Universe seconds; `null` only when the distance is unknown and the method is distance-priced. */
  readonly elapsedS: number | null;
}

export interface TravelPlan {
  readonly from: Address;
  readonly to: Address;
  /** The method this plan applies: the requested one, or the recommended one when none was asked. */
  readonly method: TravelMethod;
  /** Metres in the shared root frame; `null` only when a place has no position (e.g. the root). */
  readonly distanceM: number | null;
  /** Universe seconds for `method`; `null` exactly when that method cannot be priced. */
  readonly elapsedS: number | null;
  /** Every method priced, so a UI can show the trade-off (ADR-0019). */
  readonly costs: readonly MethodCost[];
  /** Why this pair is not travellable; `null` when it is. */
  readonly reason: string | null;
}

function refused(
  from: Address,
  to: Address,
  method: TravelMethod,
  reason: string,
): TravelPlan {
  return {
    from,
    to,
    method,
    distanceM: null,
    elapsedS: null,
    costs: TRAVEL_METHODS.map((m) => ({ method: m, elapsedS: null })),
    reason,
  };
}

/** The recommended method for a pair: hyperspace across galaxies, else the same-galaxy rule. */
function recommendedMethod(from: Address, to: Address): TravelMethod {
  if (!sameAddress(galaxyAddressOf(from), galaxyAddressOf(to))) return 'hyperspace';
  return methodForPair(from, to);
}

function isTravelMethod(value: string): value is TravelMethod {
  return (TRAVEL_METHODS as readonly string[]).includes(value);
}

/**
 * The travel plan from `from` to `to`, or the reason there isn't one.
 *
 * `method` is optional: with it, the plan applies that method; without it, `recommendedMethod`
 * chooses and the plan reports every cost so the caller can offer a choice. Any method at or above
 * the system rung is legal for any trip (ADR-0019); this function never rejects one for being the
 * "wrong" rung.
 *
 * Always returns a plan so a caller can show *why* a destination is out of reach instead of
 * crashing. A plan with a `reason` must not be applied; `distanceM` and `elapsedS` are null together
 * for every distance-priced method.
 */
export function planTravel(
  seed: string,
  from: Address,
  to: Address,
  method?: string,
): TravelPlan {
  if (method !== undefined && !isTravelMethod(method)) {
    return refused(from, to, 'warp', `"${method}" is not a travel method`);
  }
  const requested: TravelMethod | null = method ?? null;

  if (sameAddress(from, to)) {
    return refused(from, to, requested ?? 'warp', 'you are already there');
  }
  if (from.version !== to.version) {
    return refused(
      from,
      to,
      requested ?? 'warp',
      `address version ${from.version} cannot travel to version ${to.version}`,
    );
  }
  if (from.levels.length === 0 || to.levels.length === 0) {
    return refused(
      from,
      to,
      requested ?? 'warp',
      'the root has no position; zoom out instead of travelling to it',
    );
  }

  const distanceM = rootDistance(seed, from, to);
  if (distanceM === null) {
    return refused(from, to, requested ?? 'warp', 'one of those places has no position');
  }

  const applied = requested ?? recommendedMethod(from, to);
  const elapsedS = elapsedFor(applied, distanceM);
  const costs = TRAVEL_METHODS.map((m) => ({ method: m, elapsedS: elapsedFor(m, distanceM) }));

  if (elapsedS === null) {
    // Only reachable if a distance-priced method is asked for with no distance, which cannot happen
    // past the guard above; keep it total rather than asserting.
    return refused(from, to, applied, `no cost model for ${applied} at this distance`);
  }

  return { from, to, method: applied, distanceM, elapsedS, costs, reason: null };
}