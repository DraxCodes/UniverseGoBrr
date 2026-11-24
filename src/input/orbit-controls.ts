/**
 * Orbit-and-zoom camera control, and panning (ADR-0014).
 *
 * The camera is stored as a **target**, the angles that look at it, and the distance to it. The eye
 * (`x`/`y`/`z`) is always *derived* from those three — `target − forward(yaw, pitch) · distance` —
 * and every function here returns a camera whose position satisfies that. The invariant is what
 * makes panning safe: when the target moves, the eye moves with it, so the next drag orbits the
 * point you panned to instead of snapping the view back to the frame origin.
 *
 * This is framing, not travel: it moves the camera within one frame and never rebases (ADR-0003
 * puts flight in Layer 4). It writes back through `onChange`/`onCommit` so the URL stays the
 * single source of truth.
 */

import { WORLD_ORIGIN, type Vec3 } from '../frame/position';
import { FOV_Y_RAD, cameraBasis } from '../render/camera';
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

/** Distance from the eye to the point it looks at, in metres. */
export function orbitDistance(camera: Camera): number {
  return Math.hypot(
    camera.x - camera.target.x,
    camera.y - camera.target.y,
    camera.z - camera.target.z,
  );
}

/**
 * The camera that looks at `target` from `distance`, at `yaw` and `pitch`.
 * Position is `target − forward(yaw, pitch) · distance`, which is exactly what the view basis
 * expects: `cameraBasis(yaw, pitch).forward` points from the eye to the target.
 */
export function orbitTo(
  yaw: number,
  pitch: number,
  distance: number,
  target: Vec3 = WORLD_ORIGIN,
): Camera {
  const clampedPitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
  const cosPitch = Math.cos(clampedPitch);
  return {
    x: target.x + Math.sin(yaw) * cosPitch * distance,
    y: target.y - Math.sin(clampedPitch) * distance,
    z: target.z + Math.cos(yaw) * cosPitch * distance,
    yaw,
    pitch: clampedPitch,
    // Copied, never aliased: `WORLD_ORIGIN` is frozen, and a caller's object must not become the
    // camera's live target by accident.
    target: { x: target.x, y: target.y, z: target.z },
  };
}

/** Read the orbit parameters back out of a camera. */
export function orbitParams(camera: Camera): {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
} {
  const dx = camera.x - camera.target.x;
  const dy = camera.y - camera.target.y;
  const dz = camera.z - camera.target.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance === 0) {
    return { yaw: camera.yaw, pitch: camera.pitch, distance: 0, target: camera.target };
  }
  const pitch = -Math.asin(Math.min(1, Math.max(-1, dy / distance)));
  const yaw = Math.atan2(dx, dz);
  return { yaw, pitch, distance, target: camera.target };
}

/** Drag in CSS pixels: horizontal turns, vertical tilts. Distance and target are preserved. */
export function dragOrbit(camera: Camera, dxPixels: number, dyPixels: number): Camera {
  const { yaw, pitch, distance, target } = orbitParams(camera);
  // Drag right turns the scene right (the eye moves left): `yaw - dx`.
  // Drag up raises the eye over the system, matching OrbitControls: moving up means a *smaller*
  // clientY, so a negative dy, and a more negative pitch is a higher camera.
  return orbitTo(
    yaw - dxPixels * DRAG_SENSITIVITY,
    pitch + dyPixels * DRAG_SENSITIVITY,
    distance,
    target,
  );
}

/**
 * Right-drag pan: slide the target (and the eye with it) across the view plane by the world
 * distance the cursor covered **at the target's depth**.
 *
 * `viewportHeightPx` turns pixels into metres: at distance `d` the vertical field spans
 * `2·d·tan(FOV/2)`, so one pixel is that over the viewport height. Using the target's depth, not
 * the frame's scale, is what makes the drag feel grabbed — the point under the cursor stays under
 * the cursor at any zoom.
 *
 * Signs match `dragOrbit`'s "drag the scene": dragging right moves the scene right, so the camera
 * moves left, and dragging down moves the scene down, so the camera moves up.
 */
export function panBy(
  camera: Camera,
  dxPixels: number,
  dyPixels: number,
  viewportHeightPx: number,
): Camera {
  const { yaw, pitch, distance, target } = orbitParams(camera);
  if (!(viewportHeightPx > 0) || !(distance > 0)) return orbitTo(yaw, pitch, distance, target);

  const basis = cameraBasis(yaw, pitch);
  const metresPerPixel = (2 * distance * Math.tan(FOV_Y_RAD / 2)) / viewportHeightPx;
  const dx = dxPixels * metresPerPixel;
  const dy = dyPixels * metresPerPixel;
  return orbitTo(yaw, pitch, distance, {
    x: target.x - basis.right.x * dx + basis.up.x * dy,
    y: target.y - basis.right.y * dx + basis.up.y * dy,
    z: target.z - basis.right.z * dx + basis.up.z * dy,
  });
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
  const { yaw, pitch, distance, target } = orbitParams(camera);
  const min = MIN_DISTANCE_FACTOR * frameScaleM;
  const next = Math.min(maxDistanceM, Math.max(min, distance * factor));
  return orbitTo(yaw, pitch, next, target);
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
  /** Which gesture the captured pointer is doing. Set on pointerdown, never changed mid-drag. */
  let gesture: 'orbit' | 'pan' = 'orbit';
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
    // Left button (and touch/pen, which report 0) orbits; right button pans (ADR-0014 D5).
    // Anything else — middle, back/forward — is left to the browser.
    if (event.button !== 0 && event.button !== 2) return;
    pointerId = event.pointerId;
    gesture = event.button === 2 ? 'pan' : 'orbit';
    lastX = event.clientX;
    lastY = event.clientY;
    target.setPointerCapture(event.pointerId);
    target.classList.add(gesture === 'pan' ? 'is-panning' : 'is-dragging');
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (dx === 0 && dy === 0) return;
    apply(
      gesture === 'pan'
        ? panBy(camera, dx, dy, target.clientHeight)
        : dragOrbit(camera, dx, dy),
    );
  };

  const endDrag = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    target.classList.remove('is-dragging', 'is-panning');
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    // One URL write per gesture, not per pixel: history.replaceState is rate-limited by browsers
    // (Chrome throws after ~100 calls in 30 s, which a drag would hit in a second).
    scheduleCommit();
  };

  // A right-drag is a pan, so the context menu must not open on release. Only on the canvas: the
  // rest of the page (and the HUD's own text selection) keeps its menu.
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
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
  target.addEventListener('contextmenu', onContextMenu);

  return {
    dispose() {
      if (commitTimer !== null) clearTimeout(commitTimer);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', endDrag);
      target.removeEventListener('pointercancel', endDrag);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContextMenu);
      target.classList.remove('is-dragging', 'is-panning');
    },
  };
}