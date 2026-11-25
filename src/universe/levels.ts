/**
 * What each address level *means* (spec §3.2 "octree levels", ADR-0008, ADR-0018).
 *
 * This is ticket 06's work item 1, and it is deliberately a pure module with no consumers yet:
 * every later item — sectors as a real address level, the sector law in `disc.ts`, the hierarchy
 * rule in `travel.ts` — asks this file what a depth *is* rather than hard-coding a number.
 *
 * ## Why the ladder needs naming at all
 *
 * ADR-0008 made the address a pure integer path on purpose: `v1/0.3.-7.12` says *where*, never
 * *what*. That unboundedness is what keeps the universe infinite. But it also meant the code had
 * to guess at scale wherever scale mattered, and the guesses are visible in the current tree:
 *
 * - `GALAXY_DEPTH = 1` is a fixed constant documented as "a shortcut, and it says so";
 * - `starKind` calls `level % 9 === 0` local vs disc, a placeholder for "this level is a star";
 * - `travel.ts` picks a method from *local field versus disc* because an address cannot say
 *   whether it is a sector or a system, and its own comment promises "the day a level answers
 *   'this is a sector', this becomes the hierarchy rule and nothing else changes."
 *
 * This module is that answer. The address stays an integer path; the *meaning* of a depth comes
 * from the ladder below, which is fixed for a given address version.
 *
 * ## The ladder
 *
 * | Address depth | Kind | Example |
 * | --- | --- | --- |
 * | 0 (the root `v1/`) | universe | everything, with no galaxy dropped yet |
 * | 1 (`v1/0`) | galaxy | a galaxy |
 * | 2 (`v1/0.3`) | sector | an angular slice of that galaxy's disc |
 * | 3 (`v1/0.3.1`) | system | a star and its bodies |
 * | 4+ (`v1/0.3.1.2`) | body | a planet, moon, station — anything below a system |
 *
 * Inserting the sector rung is what makes this a change rather than a comment: **every address at
 * depth 2 or deeper re-keys**. Depth 2 was a star and is now a sector, so a star that was `v1/4.-2`
 * is now `v1/4.<sector>.-2` — the rung is **inserted**, and the star identity keeps its value and
 * its position in the path. The system that was `v1/4.-2.7` therefore now reads
 * `v1/4.<sector>.-2.7`: still "star -2, body 7", not "sector -2, star 7". The module exists first so
 * the re-key has one authority to move rather than four independent guesses.
 *
 * ## The version boundary
 *
 * The ladder is fixed per address **version**, not globally. A future generator that wanted a
 * different depth ordering would bump the address version and old links would break loudly
 * (ADR-0005) rather than silently meaning something else. Nothing here reinterprets a version it
 * does not know: `levelKindAt` answers for the ladder this file defines, and the caller is
 * responsible for having parsed a version it understands.
 */

import { fnv1a32 } from '../lib/hash';
import { createRng } from '../lib/random';
import { formatAddress, type Address } from '../frame/address';

/**
 * The address depth at which each rung sits.
 *
 * These replace `GALAXY_DEPTH` as the authority. `GALAXY_DEPTH` survives as an alias so the
 * re-key can land in steps without two constants disagreeing; when the sector rung is wired the
 * alias is deleted.
 */
export const UNIVERSE_DEPTH = 0;
export const GALAXY_DEPTH = 1;
export const SECTOR_DEPTH = 2;
export const SYSTEM_DEPTH = 3;
/** Anything at or below this is a body. Bodies are the only rung without a fixed depth. */
export const BODY_DEPTH = 4;

export type LevelKind = 'universe' | 'galaxy' | 'sector' | 'system' | 'body';

/**
 * What the level at `depth` is.
 *
 * Total by construction: every depth has an answer, and there is no "unknown" branch for a caller
 * to fall through. That is the point — a guess at scale is what produced the placeholders this
 * module replaces.
 */
export function levelKindAt(depth: number): LevelKind {
  if (depth <= UNIVERSE_DEPTH) return 'universe';
  if (depth === GALAXY_DEPTH) return 'galaxy';
  if (depth === SECTOR_DEPTH) return 'sector';
  if (depth === SYSTEM_DEPTH) return 'system';
  return 'body';
}

/**
 * What the place at `address` *is* — the kind of its own last level.
 *
 * `v1/` is the universe; `v1/0` is a galaxy; `v1/0.3` is a sector. This is the question every
 * caller actually has ("what am I standing on?"), so it is the primary export and
 * `levelKindAt` is the mechanism behind it.
 */
export function kindOfAddress(address: Address): LevelKind {
  return levelKindAt(address.levels.length);
}

/** Whether `address` is deep enough to be the given kind. Used by guards and by travel. */
export function isKind(address: Address, kind: LevelKind): boolean {
  return kindOfAddress(address) === kind;
}

// ---------------------------------------------------------------------------
// The sector law
// ---------------------------------------------------------------------------

/** Six is the ceiling, so the rung never needs more than one digit (ADR-0018). */
export const SECTOR_COUNT_MAX = 6;
/** A very small galaxy gets one sector: there is nothing meaningful to split. */
export const SECTOR_COUNT_MIN = 1;

/**
 * The galaxy-size fraction at which a galaxy gets four sectors — a Milky-Way-sized one.
 *
 * The owner's model is concrete ("a Milky-Way-sized one gets 4"), so the law is anchored on that
 * rather than tuned: `sectorCountForSize` crosses to 4 here and reaches 6 only at the top of the
 * band. Written as a constant because a test should be able to point at it.
 */
export const MILKY_WAY_SIZE_FRACTION = 0.75;

/**
 * How many sectors a galaxy of this relative size has (ADR-0018).
 *
 * `sizeFraction` is the galaxy's radius as a fraction of the largest galaxy the generator makes,
 * in `[0, 1]`. Steps rather than a smooth curve because the count must be an integer, and explicit
 * thresholds because "which count does a 0.7 galaxy get" should be answerable by reading, not by
 * evaluating `round(1 + 5s^1.5)`.
 *
 * Total at both ends, which matters: a one-sector galaxy is the degenerate case and it must work
 * (ADR-0018 consequence 6), and out-of-range input must not produce a seventh sector.
 */
export function sectorCountForSize(sizeFraction: number): number {
  if (!Number.isFinite(sizeFraction)) return SECTOR_COUNT_MIN;
  const s = Math.min(1, Math.max(0, sizeFraction));
  if (s < 0.15) return 1;
  if (s < 0.35) return 2;
  if (s < 0.6) return 3;
  if (s < MILKY_WAY_SIZE_FRACTION + 0.1) return 4;
  if (s < 0.95) return 5;
  return 6;
}

/**
 * Which sector an angle belongs to.
 *
 * A sector spans the **whole disc radially** (ADR-0018 consequence 7), so only the angle matters.
 * `phaseRad` is where slice zero begins; passing it in rather than deriving it here keeps this
 * function independent of the frame law and therefore testable on its own.
 *
 * The result is always in `[0, count)`, including for negative angles and for `count === 1` — the
 * degenerate galaxy is the one most likely to expose an off-by-one, so it is total by
 * construction rather than by a special case in the caller.
 */
export function sectorIndexForAngle(
  angleRad: number,
  count: number,
  phaseRad: number,
): number {
  if (!Number.isFinite(angleRad) || !Number.isFinite(phaseRad)) return 0;
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n <= 1) return 0;

  const TAU = Math.PI * 2;
  // Normalise the offset into [0, TAU) before dividing: a raw negative angle would otherwise
  // floor to -1 and index a sector that does not exist.
  const offset = (((angleRad - phaseRad) % TAU) + TAU) % TAU;
  const index = Math.floor((offset / TAU) * n);
  // The only way to reach `n` is a floating-point offset that rounds up to exactly TAU.
  return index >= n ? n - 1 : index;
}

/**
 * How many sectors a *specific* galaxy has.
 *
 * Keyed on `(seed, galaxyAddress)` like every other piece of content (ADR-0005), and stable for a
 * given galaxy: changing the law would change how many sectors it has, which re-keys every link
 * into it, so it is a `GALAXY_VERSION` event rather than a free tweak (ADR-0018 consequence 5).
 */
export function sectorCount(seed: string, galaxyAddress: Address): number {
  // Deliberately the same size draw as `galaxySizeFraction`: the count is *derived* from the
  // size, not an independent roll, so a galaxy cannot report one size and a contradictory count.
  // The test `derives the sector count from the same size it reports` pins that.
  return sectorCountForSize(galaxySizeFraction(seed, galaxyAddress));
}

/**
 * The address a place has once the sector rung is **removed** — the address as it was written
 * before sectors existed, and therefore the key for everything that must not re-roll (ADR-0023).
 *
 * This is the mechanic that keeps the promise. A drawn star's position and appearance are keyed on
 * its star level, and a system's planets are keyed on this address, so inserting the sector rung
 * changes a *link* without changing a single drawn number. With no sector rung there is nothing to
 * remove and the address is returned unchanged.
 *
 * Only the rung at `SECTOR_DEPTH` is dropped; everything shallower and deeper keeps its order, so
 * `v1/4.<sector>.-2.7` answers `v1/4.-2.7` — the string that named the same system before the
 * re-key.
 *
 * **A two-level address is returned unchanged, and that is load-bearing.** `v1/4.-7` is both the
 * pre-re-key address of a star (the identity `placedStarForIndex` keys on) and a well-formed
 * `galaxy.sector` address under the new ladder. Those are literally the same string, and position
 * and appearance *depend* on that: the star-identity path must produce the pre-re-key key, so a
 * bare sector has to pass through untouched. The cost is that a sector's content key equals the
 * star-identity key (a crafted `?addr=v1/4.3` resolves to the system of star 3), which ADR-0023
 * accepts: the sector is redundant to content, so the link names a real place either way. A sector
 * is never *drawn* as a system, so nothing user-facing depends on the collision.
 */
export function withoutSectorRung(address: Address): Address {
  const levels = address.levels;
  if (levels.length <= SECTOR_DEPTH) return address;
  return {
    version: address.version,
    levels: [...levels.slice(0, SECTOR_DEPTH - 1), ...levels.slice(SECTOR_DEPTH)],
  };
}

/**
 * The galaxy's radius as a fraction of the largest one, in `[0, 1]`.
 *
 * This is the missing rung that made `GALAXY_RADIUS_M` a global constant: every galaxy in the app
 * is currently the same size, so "a small galaxy" and "a large one" do not exist to be varied
 * (ticket 06, work item 4). Deliberately biased upward — most of the visible sky is large galaxies
 * because small ones are faint. `sectorCount` derives from this same function, so there is one
 * size law with two readers rather than two laws that could disagree.
 */
export function galaxySizeFraction(seed: string, galaxyAddress: Address): number {
  const rng = createRng(fnv1a32(`${seed}|${formatAddress(galaxyAddress)}|size|v1`));
  // Skew toward the upper band: `sqrt(u)` pushes the median to ~0.7, so a typical galaxy is
  // Milky-Way-ish rather than tiny. This is draw 0; `sectorCount` reuses it rather than drawing
  // again, so the count is always consistent with the size it was derived from.
  const u = rng.next();
  return Math.sqrt(u);
}
