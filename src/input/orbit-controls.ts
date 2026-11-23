/**
 * Orbit-and-zoom camera control.
 *
 * The camera is stored as a position plus the yaw/pitch that look at the star, so the two must
 * always be kept consistent — the renderer uses the position for translation and the angles for
 * the view basis. Every function here therefore returns a camera whose position is *derived from*
 * its angles and distance, never adjusted independently.
 *
 * This is framing, not travel: it moves the camera within one frame and never rebases (ADR-0003
 * puts flight in Layer 4). It writes back through `onChange`/`onCommit` so the URL stays the
 * single source of truth.
 */

import type { Camera } from '../state/url-state';
import { notchFactor } from '../render/scale';

/** Closest the camera may approach the star, as a fraction of the outermost orbit. */
export const MIN_DISTANCE_FACTOR = 0.08;
/** Furthest it may retreat. Beyond this the system is a dot and the orbits alias. */
export const MAX_DISTANCE_FACTOR = 14;
/** Radians per CSS pixel of drag. A 300 px drag is a little over 80°. */
export const DRAG_SENSITIVITY = 0.0048;
/** Pitch stops just short of the poles: looking straight down the up-axis is degenerate. */
export const PITCH_LIMIT = 1.45;

/** Distance from the camera to the frame origin, in metres. */
export function orbitDistance(camera: Camera): number {
  return Math.hypot(camera.x, camera.y, camera.z);
}

/**
 * The camera that looks at the origin from `distance`, at `yaw` and `pitch`.
 * Position is `-forward × distance`, which is exactly what the view basis expects.
 */
export function orbitTo(yaw: number, pitch: number, distance: number): Camera {
  const clampedPitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
  const cosPitch = Math.cos(clampedPitch);
  return {
    x: Math.sin(yaw) * cosPitch * distance,
    y: -Math.sin(clampedPitch) * distance,
    z: Math.cos(yaw) * cosPitch * distance,
    yaw,
    pitch: clampedPitch,
  };
}

/** Read the orbit parameters back out of a camera position. */
export function orbitParams(camera: Camera): { yaw: number; pitch: number; distance: number } {
  const distance = orbitDistance(camera);
  if (distance === 0) return { yaw: camera.yaw, pitch: camera.pitch, distance: 0 };
  const pitch = -Math.asin(Math.min(1, Math.max(-1, camera.y / distance)));
  const yaw = Math.atan2(camera.x, camera.z);
  return { yaw, pitch, distance };
}

/** Drag in CSS pixels: horizontal turns, vertical tilts. Distance is preserved exactly. */
export function dragOrbit(camera: Camera, dxPixels: number, dyPixels: number): Camera {
  const { yaw, pitch, distance } = orbitParams(camera);
  // Drag right turns the scene right (the eye moves left): `yaw - dx`.
  // Drag up raises the eye over the system, matching OrbitControls: moving up means a *smaller*
  // clientY, so a negative dy, and a more negative pitch is a higher camera.
  return orbitTo(yaw - dxPixels * DRAG_SENSITIVITY, pitch + dyPixels * DRAG_SENSITIVITY, distance);
}

/** Which end of the zoom range a wheel notch was pushed against, or null if it moved. */
export type ZoomEdge = 'min' | 'max';

/** Zoom by a factor, clamped against the frame's own scale so no address is unreachable. */
export function zoomBy(
  camera: Camera,
  factor: number,
  frameScaleM: number,
  maxDistanceM = MAX_DISTANCE_FACTOR * frameScaleM,
): Camera {
  const { yaw, pitch, distance } = orbitParams(camera);
  const min = MIN_DISTANCE_FACTOR * frameScaleM;
  const next = Math.min(maxDistanceM, Math.max(min, distance * factor));
  return orbitTo(yaw, pitch, next);
}

/**
 * The clamp a wheel notch ran into, for feedback. Only reports when the camera is **already**
 * at the limit: the notch that first reaches it still produced visible motion, so "max zoom"
 * would be a lie. This is what makes the clamp audible to the user (the Layer 2 gate recorded
 * wheel notches being swallowed with no feedback).
 */
export function zoomEdge(
  camera: Camera,
  factor: number,
  frameScaleM: number,
  maxDistanceM = MAX_DISTANCE_FACTOR * frameScaleM,
): ZoomEdge | null {
  const { distance } = orbitParams(camera);
  const min = MIN_DISTANCE_FACTOR * frameScaleM;
  const max = maxDistanceM;
  const requested = distance * factor;
  // Tolerance, not equality: `zoomBy` clamps to exactly `min`/`max`, but rebuilding the camera
  // from its angles and taking the hypotenuse round-trips to that value ±1 ulp, so a strict
  // comparison reports "not at the limit" forever. (A test that trusted equality spun for
  // sixteen minutes before anyone noticed.)
  const atMax = distance >= max * (1 - 1e-9);
  const atMin = distance <= min * (1 + 1e-9);
  if (factor > 1 && requested > max && atMax) return 'max';
  if (factor < 1 && requested < min && atMin) return 'min';
  return null;
}

export interface OrbitControlOptions {
  element: HTMLElement;
  /** Mutated in place, so the renderer keeps its reference. */
  camera: Camera;
  /** The frame's outermost orbit in metres: the unit the zoom limits are expressed in. */
  frameScaleM: number;
  /**
   * The furthest the camera may retreat, in metres. Omitted means the Layer 2 framing limit
   * (`MAX_DISTANCE_FACTOR` × the frame scale); Layer 3 passes the galaxy's reachable distance.
   */
  maxDistanceM?: number;
  /** Called on every animation-worthy change. Must be cheap. */
  onChange(): void;
  /** Called when the gesture settles. This is where the URL is rewritten. */
  onCommit(): void;
  /** Called when a wheel notch is swallowed by the zoom clamp, so the UI can say so. */
  onZoomEdge?(edge: ZoomEdge): void;
}

export interface OrbitControls {
  dispose(): void;
}

const COMMIT_DELAY_MS = 250;

export function attachOrbitControls(options: OrbitControlOptions): OrbitControls {
  const { element, camera, frameScaleM } = options;
  const maxDistanceM = options.maxDistanceM ?? MAX_DISTANCE_FACTOR * frameScaleM;
  const target = element;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;

  const apply = (next: Camera): void => {
    // Preserve the object identity: the renderer holds this exact reference.
    Object.assign(camera, next);
    options.onChange();
  };

  const scheduleCommit = (): void => {
    if (commitTimer !== null) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commitTimer = null;
      options.onCommit();
    }, COMMIT_DELAY_MS);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // Left button or touch/pen only; a right-drag is the browser's or the user's.
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    target.setPointerCapture(event.pointerId);
    target.classList.add('is-dragging');
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (dx === 0 && dy === 0) return;
    apply(dragOrbit(camera, dx, dy));
  };

  const endDrag = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    target.classList.remove('is-dragging');
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    // One URL write per gesture, not per pixel: history.replaceState is rate-limited by browsers
    // (Chrome throws after ~100 calls in 30 s, which a drag would hit in a second).
    scheduleCommit();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Normalise the three deltaMode units to roughly "lines", then to a multiplicative factor.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const base = Math.exp(event.deltaY * unit * 0.0012);
    // Layer 3: the void is crossed faster, but the rate is bit-identical to Layer 2 inside the
    // system and at the galaxy edge. `notchFactor` is a pure function of the distance the wheel
    // is at, so the same gesture is one rate across the joint.
    const factor = notchFactor(orbitDistance(camera), base);
    const edge = zoomEdge(camera, factor, frameScaleM, maxDistanceM);
    apply(zoomBy(camera, factor, frameScaleM, maxDistanceM));
    if (edge) options.onZoomEdge?.(edge);
    scheduleCommit();
  };

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);
  target.addEventListener('wheel', onWheel, { passive: false });

  return {
    dispose() {
      if (commitTimer !== null) clearTimeout(commitTimer);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', endDrag);
      target.removeEventListener('pointercancel', endDrag);
      target.removeEventListener('wheel', onWheel);
      target.classList.remove('is-dragging');
    },
  };
}