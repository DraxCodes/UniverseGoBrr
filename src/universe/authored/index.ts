/**
 * Hand-authored content, keyed by address (spec §3.6).
 *
 * The registry is **data, versioned like any address, not a special code path**: the procedural
 * generator stays a pure function of `(seed, address)`, and the only thing that changes for an
 * authored node is which producer answers the question. Everything downstream — the orrery, the
 * HUD, the capture harness, the URL — is untouched, because an authored node returns the same
 * `StarSystem` shape a generated one does.
 *
 * **Precedence is authored-first.** If an address is in the registry, its system is returned and
 * `seed` is ignored. That last part matters: a shared link to Sol must mean Sol for everyone, so
 * an authored node cannot depend on a per-user seed.
 */

import { formatAddress, type Address } from '../../frame/address';
import { generateSystem, type StarSystem } from '../system';
import { SOL_SYSTEM, SOL_ADDRESS } from './sol';

export interface AuthoredSystem {
  /** Canonical `formatAddress` string. The key, so a lookup never has to compare level arrays. */
  readonly address: string;
  /** Why this node is here, in one line, for the record and the HUD's future use. */
  readonly note: string;
  readonly system: StarSystem;
}

/**
 * The registry. One array, read-only, small on purpose: this is the sort of thing that rots into
 * a second generator if it grows unexamined, so each entry carries a reason.
 */
export const AUTHORED_SYSTEMS: readonly AuthoredSystem[] = Object.freeze([
  {
    address: SOL_ADDRESS,
    note: 'Sol: the compare-to-reality anchor. Real bodies, real radii, real periods.',
    system: SOL_SYSTEM,
  },
]);

const BY_ADDRESS = new Map(AUTHORED_SYSTEMS.map((entry) => [entry.address, entry.system]));

/** The authored system for an address, or `null` to fall through to the generator. */
export function authoredSystemFor(address: Address): StarSystem | null {
  return BY_ADDRESS.get(formatAddress(address)) ?? null;
}

/** Every reserved address, for tests and for a future address HUD. */
export function authoredAddresses(): readonly string[] {
  return AUTHORED_SYSTEMS.map((entry) => entry.address);
}

/**
 * The one entry point the app uses: authored first, generator second.
 *
 * The ordering is the whole specification (§3.6). Keeping it in a named function rather than
 * open-coding `authoredSystemFor(...) ?? generateSystem(...)` at each call site means there is
 * exactly one place that can get the precedence wrong, and one place a test has to cover.
 */
export function resolveSystem(seed: string, address: Address): StarSystem {
  return authoredSystemFor(address) ?? generateSystem(seed, address);
}
