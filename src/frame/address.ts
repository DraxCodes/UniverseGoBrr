/**
 * A frame address (ADR-0008). `v1/0.3.-7.12` is the version, then one integer per level,
 * outermost first. There is **no fixed depth**: that is what makes the universe unbounded
 * rather than merely large. Names ("Milky Way / Orion Spur / Sol") are presentation; the
 * integers are identity.
 *
 * `v1/` with nothing after the slash is the **root**: the frame that contains everything,
 * with no level dropped yet. It has to exist, because zooming out means dropping one level
 * (spec §5, "Cosmic address HUD — each line clickable to zoom out") and that walk has to
 * terminate somewhere. It is also the only frame whose link can say "the whole universe".
 */

export interface Address {
  /** Generator generation. Changing the seed -> content function bumps this; old links break loudly. */
  readonly version: number;
  /** One integer per level, outermost first. Length is unbounded in principle. */
  readonly levels: readonly number[];
}

/** Bounded only to keep a hostile URL from producing an absurd string. */
export const MAX_LEVELS = 64;
/** |level| is capped so every level is a safe 32-bit-ish integer. */
export const MAX_LEVEL = 2_147_483_647;
/** A 64-level address cannot be longer than this; checked before splitting. */
export const MAX_ADDRESS_LENGTH = 900;

export const DEFAULT_ADDRESS: Address = Object.freeze({
  version: 1,
  levels: Object.freeze([0]),
});

// `.*`, not `.+`: zero levels is the root, and `formatAddress` emits it as `v1/`.
const ADDRESS_PATTERN = /^v(\d{1,9})\/(.*)$/;
const LEVEL_PATTERN = /^-?(?:0|[1-9]\d{0,9})$/;

export interface ParsedAddress {
  address: Address | null;
  /** Why the text was rejected, for the HUD. `null` when it parsed. */
  issue: string | null;
}

export function parseAddress(text: string): ParsedAddress {
  const raw = text.trim();
  if (raw === '') return { address: null, issue: 'address is empty' };
  // Length before splitting: a URL-sized string must not be turned into an array first.
  if (raw.length > MAX_ADDRESS_LENGTH) {
    return { address: null, issue: 'address is too long' };
  }

  const match = ADDRESS_PATTERN.exec(raw);
  if (!match) {
    return {
      address: null,
      issue: `address "${raw}" must look like v1/0.3.-7, or v1/ for the whole universe`,
    };
  }

  const version = Number(match[1]);
  if (version < 1) {
    return { address: null, issue: `address "${raw}" needs a version of 1 or more` };
  }

  // Zero levels is the root, not a malformed address: an empty split would otherwise yield
  // one empty part and be rejected by the level pattern.
  const body = match[2] ?? '';
  if (body === '') return { address: { version, levels: [] }, issue: null };

  const parts = body.split('.');
  if (parts.length > MAX_LEVELS) {
    return { address: null, issue: `address "${raw}" has more than ${MAX_LEVELS} levels` };
  }

  const levels: number[] = [];
  for (const part of parts) {
    if (!LEVEL_PATTERN.test(part)) {
      return { address: null, issue: `address level "${part}" must be an integer` };
    }
    const level = Number(part);
    if (Math.abs(level) > MAX_LEVEL) {
      return { address: null, issue: `address level "${part}" is out of range` };
    }
    levels.push(level);
  }

  return { address: { version, levels }, issue: null };
}

export function parseAddressOrThrow(text: string): Address {
  const { address, issue } = parseAddress(text);
  if (!address) throw new Error(issue ?? `address "${text}" is invalid`);
  return address;
}

export function formatAddress(address: Address): string {
  return `v${address.version}/${address.levels.join('.')}`;
}

export function sameAddress(a: Address, b: Address): boolean {
  if (a.version !== b.version || a.levels.length !== b.levels.length) return false;
  return a.levels.every((level, index) => level === b.levels[index]);
}

/**
 * One level deeper: append a child index. This is how an unbounded universe is named —
 * there is always a valid address one level further out or in.
 */
export function childAddress(address: Address, level: number): Address {
  return { version: address.version, levels: [...address.levels, level] };
}

/**
 * One level out: the frame that contains `address`. This is the inverse of `childAddress`,
 * and the termination condition for zoom-out — it returns `null` at the root, because the
 * root is the only frame with nothing outside it. Returns `null` rather than throwing so a
 * caller can treat "already at the top" as a normal state rather than an error.
 */
export function parentAddress(address: Address): Address | null {
  if (address.levels.length === 0) return null;
  return { version: address.version, levels: address.levels.slice(0, -1) };
}

/**
 * The ancestor `depth` levels deep: the frame of `address` that contains it at that size.
 *
 * Unlike `parentAddress` this never returns `null` and never throws: a depth outside the
 * address is a normal question with an obvious answer. A depth of zero is the root, which
 * contains everything; a depth at or beyond the address's own length is the address itself,
 * because a frame cannot have an ancestor deeper than itself. Both cases come up when a
 * generator asks "which galaxy am I in?" for an address that may already *be* that galaxy.
 */
export function ancestorAddress(address: Address, depth: number): Address {
  if (depth <= 0) return { version: address.version, levels: [] };
  if (depth >= address.levels.length) return address;
  return { version: address.version, levels: address.levels.slice(0, depth) };
}

/**
 * The address as a person reads it. The root would otherwise show as "0 levels", which
 * looks like a missing value rather than the largest frame there is.
 */
export function describeAddress(address: Address): string {
  const depth = address.levels.length;
  const scale = depth === 0 ? 'root' : `${depth} ${depth === 1 ? 'level' : 'levels'}`;
  return `${formatAddress(address)} · ${scale}`;
}