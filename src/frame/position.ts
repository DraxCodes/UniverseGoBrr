/**
 * Absolute positions on the CPU, camera-relative float32 on the GPU (ADR-0008).
 *
 * A `Position` is a frame origin plus a local offset, both doubles. No function here returns
 * an absolute coordinate as a float32: the only route to the GPU is `toCameraRelativeF32`,
 * which subtracts in double precision *first*. That ordering is the whole fix — rounding
 * before subtracting is what destroys positions at 10¹³ m.
 *
 * `toCameraRelativeNaiveF32` reproduces the pre-Layer-1 path on purpose. It exists so the
 * negative-control capture has something real to compare against, and so a future reader can
 * see the bug in code rather than only in a document.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A point in absolute space: `origin + local`, both in metres. The origin is the frame's
 * origin, so positions inside one frame share it and cancel exactly in a subtraction.
 */
export interface Position {
  readonly origin: Vec3;
  readonly local: Vec3;
}

/** The frame origin at the centre of the coordinate space. */
export const WORLD_ORIGIN: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** A position in the frame whose origin is the world origin. */
export function fromLocal(local: Vec3): Position {
  return { origin: WORLD_ORIGIN, local };
}

export function atOrigin(origin: Vec3, local: Vec3 = WORLD_ORIGIN): Position {
  return { origin, local };
}

export function offsetLocal(position: Position, dx: number, dy: number, dz: number): Position {
  return {
    origin: position.origin,
    local: {
      x: position.local.x + dx,
      y: position.local.y + dy,
      z: position.local.z + dz,
    },
  };
}

/**
 * Absolute position in metres, as doubles. This is exact to the limit of a double, and it is
 * the value a test can compare against. It is deliberately not the value sent to the GPU.
 */
export function toAbsolute(position: Position): Vec3 {
  return {
    x: position.origin.x + position.local.x,
    y: position.origin.y + position.local.y,
    z: position.origin.z + position.local.z,
  };
}

/**
 * `target - camera`, in metres, in double precision.
 *
 * Written as origin-then-local so two positions in the same frame cancel their origin
 * exactly, with no cancellation error at all, whatever the origin's magnitude.
 */
export function toCameraRelative(target: Position, camera: Position): Vec3 {
  return {
    x: target.origin.x - camera.origin.x + (target.local.x - camera.local.x),
    y: target.origin.y - camera.origin.y + (target.local.y - camera.local.y),
    z: target.origin.z - camera.origin.z + (target.local.z - camera.local.z),
  };
}

/** The only shape the vertex shader accepts: camera-relative, already small, rounded to f32. */
export function toCameraRelativeF32(target: Position, camera: Position): Vec3 {
  const relative = toCameraRelative(target, camera);
  return {
    x: Math.fround(relative.x),
    y: Math.fround(relative.y),
    z: Math.fround(relative.z),
  };
}

/**
 * The bug, kept executable: round frame-local coordinates to float32 *before* subtracting,
 * which is what the GPU has to do when the CPU uploads absolute values (the Layer 0 path).
 *
 * Float32's step at 10¹³ m is about 1,048,576 m, so any two positions closer than ~500 km
 * become the same number and their difference is exactly zero.
 */
export function toCameraRelativeNaiveF32(target: Position, camera: Position): Vec3 {
  return {
    x: Math.fround(Math.fround(target.local.x) - Math.fround(camera.local.x)),
    y: Math.fround(Math.fround(target.local.y) - Math.fround(camera.local.y)),
    z: Math.fround(Math.fround(target.local.z) - Math.fround(camera.local.z)),
  };
}

/** Distance between two points, in metres. */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Largest component-wise difference between two points, in metres. */
export function maxComponentError(actual: Vec3, expected: Vec3): number {
  return Math.max(
    Math.abs(actual.x - expected.x),
    Math.abs(actual.y - expected.y),
    Math.abs(actual.z - expected.z),
  );
}

/**
 * One float32 unit in the last place at this magnitude: the distance between the two nearest
 * representable values. Used by the HUD and by tests to size a frame's accepted error.
 */
export function f32Ulp(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return Number.MIN_VALUE;
  if (!Number.isFinite(magnitude)) return Number.POSITIVE_INFINITY;
  const exponent = Math.floor(Math.log2(magnitude));
  return Math.pow(2, exponent - 23);
}