/**
 * Rebasing a frame: the one place a camera is re-expressed against a new origin (ADR-0003, A).
 *
 * Under A (Layer 4 council §8) a frame's origin **is** its address node. Crossing a tier changes
 * the address, and the camera's frame-local coordinates must be rewritten so the picture does not
 * jump. That rewrite is a translation and nothing else: orientation is frame-independent, and the
 * address is the caller's to change, never this module's.
 *
 * Three rules live here so no caller can get them subtly different:
 *
 * 1. **Translation only.** `yaw` and `pitch` pass through untouched. A rebase that rotated the
 *    view would be a different feature wearing the same name.
 * 2. **Shift, never absolute.** The arithmetic is `local - shift`, on numbers of comparable
 *    magnitude. It is never `absolute - absolute`, which would add a small coordinate to a huge
 *    one and lose the small one. ADR-0008's ordering, applied to rebasing.
 * 3. **Pure.** No history, no address, no state. Those are policy and belong to the caller.
 *
 * ## What this module deliberately does not do
 *
 * - **No dead band.** The council asked for a hysteresis band to stop an address flapping across
 *   a threshold. Under A **no threshold changes the address**: arriving in a frame is a committed
 *   action - a warp, or a click on one line of the address HUD - not a distance the camera drifts
 *   past. A band with no continuous trigger would be an unused constant with a test that proves
 *   nothing. It lands the day an automatic trigger does, and `rebasesOnThreshold()` below is where
 *   that starts.
 * - **No focus rebase.** The approach probe closed that question with a number
 *   (`approach-probe.ts`, council §8): a body's float32 displacement stays at ~10⁻⁵ px all the
 *   way down to 1.05 drawn radii, so the origin never has to move to a body you approach.
 * - **No framing.** A warp may want to arrive at a chosen view rather than at the same offset.
 *   That is travel policy - ADR-0003's framing-versus-travel split - and belongs to the tier code.
 */

import type { Vec3 } from './position';

/**
 * A camera as far as a rebase is concerned: a frame-local position plus an orientation.
 *
 * Structurally identical to the URL's `Camera` on purpose. Declaring it here keeps `src/frame/`
 * free of a dependency on `src/state/`, while still accepting and returning the URL type
 * unchanged - no conversion, no cast, no second definition to drift.
 */
export interface FrameCamera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  /**
   * The point the camera looks at (ADR-0014), when the caller has one. Optional so a camera that
   * predates the target still rebases; when present it is shifted with the eye, because a rebase
   * that moved only the eye would silently rotate the view.
   */
  readonly target?: Vec3;
}

/**
 * How much finer than the frame radius a double's own step must stay.
 *
 * A double's step at magnitude `m` is `m × 2⁻⁵²`. Requiring that step to be at most `DOUBLE_SLACK`
 * times the frame radius is what says "the subtraction in `toCameraRelative` is not the binding
 * error here". float32's relative step is 2⁻²³ ≈ 1.2×10⁻⁷, so 10⁻⁶ keeps the double roughly an
 * order of magnitude ahead of the float32 the GPU uses.
 */
export const DOUBLE_SLACK = 1e-6;

/** A double's relative step: 2⁻⁵². Named so `maxOffsetM` reads as arithmetic rather than magic. */
const DOUBLE_RELATIVE_STEP = Math.pow(2, -52);

/**
 * Re-express `camera` against an origin that has moved.
 *
 * `originShiftM` is the new origin **measured from the old one**, in metres - not the new origin's
 * absolute position. A camera sitting 1 m past the old origin, with the new origin 10 ly further
 * out, lands at `1 m - 10 ly` in the new frame: far on the negative side, which is correct and is
 * exactly what makes the picture continuous.
 *
 * Taking a shift rather than two absolutes is the precision choice: both inputs are translated but
 * never added to a large third value, so a frame-global translation cannot silently lose the
 * camera's position inside the frame.
 *
 * **A camera now also carries a `target` (ADR-0014).** When it is present it is shifted by the
 * same vector as the eye, because a rebase that moved the eye and left the target behind would
 * silently rotate the view — the opposite of rule 1. A camera without a target rebases exactly as
 * before, so this stayed a compatible addition rather than a breaking change.
 */
export function rebaseCamera(camera: FrameCamera, originShiftM: Vec3): FrameCamera {
  const rebased: FrameCamera = {
    x: camera.x - originShiftM.x,
    y: camera.y - originShiftM.y,
    z: camera.z - originShiftM.z,
    yaw: camera.yaw,
    pitch: camera.pitch,
  };
  if (!camera.target) return rebased;
  // The target travels with the eye, so the view direction is preserved exactly.
  return {
    ...rebased,
    target: {
      x: camera.target.x - originShiftM.x,
      y: camera.target.y - originShiftM.y,
      z: camera.target.z - originShiftM.z,
    },
  };
}

/**
 * The largest frame-local offset at which a double still resolves the frame.
 *
 * Beyond this, one double step exceeds `DOUBLE_SLACK` of the frame radius, so the arithmetic in
 * `toCameraRelative` starts to cost more than the frame's own tolerance allows.
 *
 * **Nothing rejects on it, and that is the finding, not an omission.** The risk seat asked for a
 * crafted `cam=1e30` to report in `issues` rather than silently render a wrong image (council §4,
 * Ask 1). Measurement says it renders a *correct but empty* image, so a note would be a false
 * alarm:
 *
 * - The parser's flat cap is 10³⁰ m. For a solar-system frame (~3×10¹² m) this bound is ~1.5×10²²,
 *   so 10³⁰ is seven orders beyond it.
 * - Past the bound, bodies stop being separable by a double — but the scene already divides by the
 *   frame's scale *before* rounding, so what reaches the GPU is a large-but-finite number, and the
 *   system is drawn as a sub-pixel dot at a stable position. Nothing goes NaN, nothing lands in
 *   the wrong place.
 * - At galaxy scale (radius 5×10²⁰ m) the bound is ~2×10³⁰ and 10³⁰ is *inside* it, so the same
 *   value is not even degenerate there.
 *
 * The honest description of the failure mode is therefore "you see nothing, correctly", not "you
 * see something wrong". Reporting it would train people to ignore the HUD.
 *
 * The number still has a consumer to come: the address HUD has to say which frame the camera is
 * actually in, and existing capture shots already sit at 1.3×10²¹ m — a galaxy framing under a
 * *system* address — so this bound is part of settling that, not of validating the URL.
 */
export function maxOffsetM(frameRadiusM: number): number {
  if (!Number.isFinite(frameRadiusM) || frameRadiusM <= 0) return 0;
  return (frameRadiusM * DOUBLE_SLACK) / DOUBLE_RELATIVE_STEP;
}

/**
 * True when the camera is further from its frame's origin than a double can usefully resolve.
 *
 * Exposed because the predicate is where the reasoning above would be applied if anything ever
 * needed to; no caller uses it today, and `maxOffsetM` carries the argument for why.
 */
export function offsetIsBeyondFrame(
  camera: Pick<FrameCamera, 'x' | 'y' | 'z'>,
  frameRadiusM: number,
): boolean {
  const offset = Math.hypot(camera.x, camera.y, camera.z);
  return !Number.isFinite(offset) || offset > maxOffsetM(frameRadiusM);
}

/**
 * Whether a level change should happen automatically at a distance, and with what dead band.
 *
 * **It does not, yet, and there is deliberately no function for it here.** Under A an address
 * changes only when the user commits to it - a warp, or a click on one line of the address HUD -
 * so there is no distance threshold and therefore nothing to hysterese. A dead-band constant with
 * a test would be asserting a literal, not a property of the system; the honest record of this
 * decision is the absence of the code plus this paragraph.
 *
 * The day zooming out drops a level by itself, that trigger needs a band, the band needs one
 * constant, and the constant needs one test. That is precisely what the risk seat asked for, and
 * this layer has no consumer for it.
 */