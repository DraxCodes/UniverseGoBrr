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

/** At or below this, the controls behave exactly as Layer 2 did. */
export const SYSTEM_EXTENT_M = 1e13;
/** The galaxy's radius; at and beyond it the constant Layer 2 rate resumes. */
export const GALAXY_RADIUS_M = 5e20;
/** Bumped when the schedule changes. Like `SYSTEM_VERSION`: changing it changes the feel. */
export const SCALE_VERSION = 1;

/**
 * How much faster the void is crossed, as an exponent on the base factor: 4 means the peak
 * notch factor is `base⁵` (≈1.8× the base at the controls' 1.127). Chosen as the smallest
 * value that brings the crossing under ~100 notches; pinned by a test.
 */
export const VOID_ZOOM_BOOST = 4;

const LOG_START = Math.log10(SYSTEM_EXTENT_M); // 13
const LOG_END = Math.log10(GALAXY_RADIUS_M); // ≈20.70
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