/**
 * The root layout: where each galaxy sits in the frame that contains all galaxies (ticket 06, work
 * item 3).
 *
 * Before this, `planTravel` refused galaxy-to-galaxy with "no root layout", and the reason was
 * honest: a galaxy node was its own frame origin, so a universe-level distance would have read
 * zero and the jump would have cost no time. This module supplies the missing positions so that a
 * galaxy-to-galaxy crossing has a real `d` and therefore a real `Δt = d / v` (ADR-0010).
 *
 * ## What "no catalogue" means
 *
 * The ticket is explicit: this must be **a population law that can produce neighbours around any
 * position, not a fixed list**, so that "further out" always has something in it. So there is no
 * table here. `galaxyPosition` is total for every galaxy address and keeps producing positions
 * arbitrarily far out, which is what makes the universe effectively infinite rather than merely
 * large.
 *
 * ## The law
 *
 * Galaxy `0` - the Milky Way, because Sol is at `v1/0.0.0` - sits at the root origin. Every other
 * galaxy `g` gets:
 *
 * - a radius `SPACING · cbrt(|g|)` (with a small jitter so it is not a perfect shell), and
 * - a direction drawn from the uniform sphere by a hash of `(seed, address)`.
 *
 * That combination has a useful property: the number of galaxies within radius `r` grows like
 * `r³`, the same as the volume, so the field is roughly **constant density** rather than a shell of
 * all galaxies at one distance. A naive "one galaxy per integer on a ring" law would have put every
 * neighbour at the same range and read as a wall.
 *
 * Distance is what matters and it is deliberately not tuned to a table of real galaxies. ADR-0019
 * makes any method legal for any trip, so a wrong absolute scale changes the price of a crossing,
 * not whether it is possible - and the short anchor is an open question for the owner (ticket 06),
 * so pinning a "correct" megaparsec value here would only make a placeholder look authoritative.
 */

import { fnv1a32 } from '../lib/hash';
import { createRng } from '../lib/random';
import { formatAddress, type Address } from '../frame/address';
import { LY_M } from './disc';
import { GALAXY_DEPTH } from './levels';

export interface RootPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One megaparsec, metres (IAU: 1 pc = 648000/π au; kept as the round 3.26 Mly). */
export const MPC_M = 3.261_563_777 * 1e6 * LY_M;

/**
 * Mean separation between neighbouring galaxies, metres.
 *
 * ~2 Mpc, the order of a small galaxy group, chosen so the nearest neighbour sits at a distance a
 * hyperspace crossing prices plausibly against the week-per-galaxy-mile anchor. It is a **feel**
 * constant, not a measurement: the ticket leaves the absolute scale open and this is the one knob
 * the field density turns.
 */
export const GALAXY_SPACING_M = 2 * MPC_M;

/** The stream key for a galaxy's root position, versioned so the layout law can change loudly. */
function rootLayoutKey(seed: string, galaxyAddress: Address): string {
  return `${seed}|${formatAddress(galaxyAddress)}|root-layout|v1`;
}

/**
 * Where the galaxy at `galaxyAddress` sits in the root frame, metres.
 *
 * `galaxyAddress` must already be the galaxy's **own** level (`galaxyAddressOf`), like
 * `galaxyFrame`. Returns `null` for the root and for any address that is not at least a galaxy,
 * matching `placement`: a caller that wants "no position" gets it rather than a fabricated origin.
 *
 * The home star of the galaxy is this point plus the star's own offset inside its galaxy's frame
 * (which is `placement`), so a crossing between two stars is that sum on both ends. Keeping the two
 * pieces separate is what lets this module stay unaware of the disc law.
 */
export function galaxyPosition(seed: string, galaxyAddress: Address): RootPosition | null {
  if (galaxyAddress.levels.length < GALAXY_DEPTH) return null;

  const level = galaxyAddress.levels[GALAXY_DEPTH - 1];
  if (level === undefined) return null;
  // The home galaxy is the anchor: Sol lives in it, so it is the origin of the whole field.
  if (level === 0) return { x: 0, y: 0, z: 0 };

  const rng = createRng(fnv1a32(rootLayoutKey(seed, galaxyAddress)));
  const n = Math.abs(level);
  // Jitter the shell radius so galaxies at similar `|g|` are not all equidistant from home.
  const radius = GALAXY_SPACING_M * Math.cbrt(n) * rng.range(0.82, 1.18);

  // Uniform point on the sphere: `cosPolar` uniform in [-1, 1] is the correct measure, not a
  // uniform polar angle, or the field would clump at the poles.
  const cosPolar = rng.range(-1, 1);
  const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
  const azimuth = rng.range(0, Math.PI * 2);

  return {
    x: radius * sinPolar * Math.cos(azimuth),
    y: radius * cosPolar,
    z: radius * sinPolar * Math.sin(azimuth),
  };
}