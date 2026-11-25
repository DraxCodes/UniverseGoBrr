/**
 * Where the wheel's effort goes between the orrery and the galaxy.
 *
 * Layer 3 has to cross ~8 decades of distance (a system at 10¹³ m, a galaxy at 5×10²⁰ m) with
 * one camera and no rebase. At the controls' constant rate that is ~150 notches of wheel, most
 * of them inside a void where nothing is legible — the wheel looks broken before the galaxy
 * arrives.
 *
 * The fix is deliberately **not** a position warp. Nothing in the scene is remapped; every
 * object keeps its real position and every upload stays camera-relative (ADR-0008). Only the
 * *traversal* is compressed: the multiplicative factor per notch rises smoothly through the
 * void and returns to its Layer 2 value before the galaxy's edge, so there is no rate change
 * at the crossfade and the galaxy itself is navigated at the rate the orrery uses.
 *
 * A distance map with identity at both ends cannot do this: monotone and identity at both ends
 * leaves no room to compress. Compressing the rate is the same intent — spend the emptiness,
 * not the structure — expressed in the variable the user actually turns.
 */

import { FOV_Y_RAD } from './camera';

/** At or below this, the controls behave exactly as Layer 2 did. */
export const SYSTEM_EXTENT_M = 1e13;
/**
 * The **reference** galaxy radius, not "the" radius.
 *
 * Galaxies vary in size now (`galaxyRadiusM` in `disc.ts`, ticket 06 item 4), so a single radius
 * cannot describe the population. This constant survives for two jobs that are deliberately
 * population-level rather than per-galaxy:
 *
 * - it is where the zoom-rate schedule returns to the Layer 2 rate (`voidCompression`), so the
 *   wheel feels the same on the way out of any system; and
 * - it is the yardstick the size law is written against.
 *
 * Anything that frames or measures **one** galaxy must use that galaxy's own `radius`, never this.
 */
export const GALAXY_RADIUS_M = 5e20;
/** The smallest and largest galaxies the size law draws. The spread is the variety. */
export const GALAXY_RADIUS_MIN_M = 0.5e20;
export const GALAXY_RADIUS_MAX_M = 9e20;
/** Bumped when the schedule changes. Like `SYSTEM_VERSION`: changing it changes the feel. */
export const SCALE_VERSION = 1;

/**
 * The camera distance at which a disc of radius `radiusM`, centred `centreOffsetM` from the frame
 * origin, just fits the vertical field of view.
 *
 * Derived, not tuned. Because the orbit camera always looks at the **frame origin** (the home
 * star) and the galactic centre is a fraction of the galaxy's own radius from it, the farthest
 * point in the disc is `centreOffsetM + radiusM` from the origin. A point at that distance in the
 * view plane subtends `atan((centreOffsetM + radiusM) / d)`, so
 * `d = (centreOffsetM + radiusM) / tan(FOV/2)` puts the whole disc inside the frame. Using the
 * radius alone — the first version — framed a disc that was not centred and cropped its far side.
 *
 * `radiusM` is the **galaxy's own** radius, not `GALAXY_RADIUS_M`: a galaxy reads as a galaxy when
 * it fills the frame, at any size, which is the whole reason the framing distance is a multiple of
 * the galaxy rather than a number of metres.
 */
export function galaxyFramingDistanceM(centreOffsetM: number, radiusM: number): number {
  return (centreOffsetM + radiusM) / Math.tan(FOV_Y_RAD / 2);
}

/**
 * How much faster the void is crossed, as an exponent on the base factor: 4 means the peak
 * notch factor is `base⁵` (≈1.8× the base at the controls' 1.127). Chosen as the smallest
 * value that brings the crossing under ~100 notches; pinned by a test.
 */
export const VOID_ZOOM_BOOST = 4;

const LOG_START = Math.log10(SYSTEM_EXTENT_M); // 13
/**
 * The schedule is anchored on the **smallest** galaxy, not on a typical one.
 *
 * It has to return to the Layer 2 rate before the nearest possible galaxy edge, or the wheel is
 * still in its fast void regime *inside* a small galaxy — the rate would change under the viewer
 * mid-disc. The smallest galaxy is `GALAXY_RADIUS_MIN_M`, so its edge is the constraint; anchoring
 * on `GALAXY_RADIUS_M` (a 10× larger reference) would put the end of the fast regime a decade past
 * every small galaxy's rim. The cost is that a 9e20 galaxy is crossed at the base rate for its
 * outer decades, which is the honest behaviour of one camera with one schedule.
 */
const LOG_END = Math.log10(GALAXY_RADIUS_MIN_M); // ≈19.70
/** Leave the last decade at the base rate, so the galaxy edge is not the fast part. */
const LOG_VOID_END = LOG_END - 1;
const LOG_VOID_PEAK = (LOG_START + LOG_VOID_END) / 2;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 0 outside the void, rising to 1 at the peak and back to 0 before the galaxy. Two smoothsteps
 * meeting at the peak, so the result is C1 at both ends and at the top — no step for the eye
 * to find, which a `min` of two ramps would produce.
 */
export function voidCompression(realDistanceM: number): number {
  if (!Number.isFinite(realDistanceM) || realDistanceM <= 0) return 0;
  const logD = Math.log10(realDistanceM);
  if (logD <= LOG_START || logD >= LOG_VOID_END) return 0;
  const rise = smoothstep(LOG_START, LOG_VOID_PEAK, logD);
  const fall = 1 - smoothstep(LOG_VOID_PEAK, LOG_VOID_END, logD);
  return rise * fall;
}

/**
 * The factor one wheel notch multiplies the camera distance by, at a given distance.
 * `base` is the controls' constant factor (≈1.127 for a 100 px wheel delta); this only ever
 * returns that value or a larger one.
 */
export function notchFactor(realDistanceM: number, base: number): number {
  if (!Number.isFinite(base) || base <= 0) throw new Error('notchFactor needs a positive base');
  return base ** (1 + VOID_ZOOM_BOOST * voidCompression(realDistanceM));
}