/**
 * Camera maths for the 3D scene: a rotation-only view matrix and a **reverse-Z** projection,
 * per ADR-0002.
 *
 * Two conventions matter here and are easy to get silently wrong:
 *
 * 1. **Camera-relative world.** Objects are uploaded already relative to the camera (see
 *    `toCameraRelativeF32`), so the view transform is a pure rotation — there is no translation
 *    to lose precision in. The camera sits at the origin looking down `-z`.
 * 2. **Reverse-Z.** Depth is 1 at the near plane and approaches 0 towards infinity, which spends
 *    float32's precision where the geometry is. That is why the depth compare is `greater` and
 *    the clear value is 0.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Vertical field of view. Wide enough for an orrery, narrow enough not to fish-eye the star. */
export const FOV_Y_RAD = (50 * Math.PI) / 180;

export interface CameraBasis {
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
}

/**
 * Look direction from yaw and pitch, in radians.
 * `yaw = 0, pitch = 0` looks down `-z`, which is the "front" of the scene.
 */
export function cameraBasis(yaw: number, pitch: number): CameraBasis {
  const cosPitch = Math.cos(pitch);
  const forward: Vec3 = {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };

  // right = normalize(forward × worldUp), with worldUp = (0, 1, 0). Degenerate only when looking
  // straight up or down; the clamp keeps the basis finite instead of producing NaN.
  const rightRaw = { x: -forward.z, y: 0, z: forward.x };
  const rightLength = Math.hypot(rightRaw.x, rightRaw.z);
  const right: Vec3 =
    rightLength < 1e-6
      ? { x: 1, y: 0, z: 0 }
      : { x: rightRaw.x / rightLength, y: 0, z: rightRaw.z / rightLength };

  // up = right × forward.
  const up: Vec3 = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };

  return { right, up, forward };
}

/** Column-major 4×4, as WGSL's `mat4x4<f32>` expects. */
export function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/**
 * View matrix for a camera-relative world: no translation, only the inverse of the camera's
 * orientation. A world point already relative to the camera maps into camera space, where the
 * camera looks down `-z`.
 */
export function viewFromBasis(basis: CameraBasis): Float32Array {
  const { right, up, forward } = basis;
  const m = new Float32Array(16);
  // Row 0 = right, row 1 = up, row 2 = -forward.
  m[0] = right.x;
  m[4] = right.y;
  m[8] = right.z;
  m[1] = up.x;
  m[5] = up.y;
  m[9] = up.z;
  m[2] = -forward.x;
  m[6] = -forward.y;
  m[10] = -forward.z;
  m[15] = 1;
  return m;
}

/**
 * Reverse-Z, infinite-far perspective. Depth = `near / distance`, so the near plane is 1 and
 * infinity is 0. There is no far plane: the scene is bounded by what we choose to draw, and an
 * infinite projection keeps every bit of depth precision at the near end where the geometry is.
 *
 * `near` is in the same world units as the vertices (orrery units here), not metres.
 */
export function reverseZProjection(aspect: number, near: number): Float32Array {
  if (!(aspect > 0)) throw new Error('aspect must be positive');
  if (!(near > 0)) throw new Error('near must be positive');

  const f = 1 / Math.tan(FOV_Y_RAD / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = 0;
  // Column-major: index 11 is row 3 of column 2 (the `w = -z` term), index 14 is row 2 of
  // column 3 (the constant `near` in the depth term). Swapping these two is the classic
  // reverse-Z bug: depth becomes 1/w and everything collapses to the near plane.
  m[11] = -1;
  m[14] = near;
  return m;
}

/** `out = a × b`, both column-major 4×4. */
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export interface ClipPoint {
  readonly x: number;
  readonly y: number;
  /** Depth in 0..1, reverse-Z: 1 at the near plane, 0 at infinity. */
  readonly depth: number;
  readonly w: number;
}

/** Apply a view-projection to a camera-relative point. Used by tests and by CPU picking. */
export function projectPoint(viewProjection: Float32Array, point: Vec3): ClipPoint {
  const m = viewProjection;
  const x = (m[0] ?? 0) * point.x + (m[4] ?? 0) * point.y + (m[8] ?? 0) * point.z + (m[12] ?? 0);
  const y = (m[1] ?? 0) * point.x + (m[5] ?? 0) * point.y + (m[9] ?? 0) * point.z + (m[13] ?? 0);
  const z = (m[2] ?? 0) * point.x + (m[6] ?? 0) * point.y + (m[10] ?? 0) * point.z + (m[14] ?? 0);
  const w = (m[3] ?? 0) * point.x + (m[7] ?? 0) * point.y + (m[11] ?? 0) * point.z + (m[15] ?? 0);
  return { x: x / w, y: y / w, depth: z / w, w };
}

/** A depth bias that keeps a nearby body's own surface in front of its orbit line. */
export function reverseZDepthBias(bias: number): [number, number] {
  // For reverse-Z, `depth > depthBias` is nearer, so the bias is positive.
  return [bias, 0];
}