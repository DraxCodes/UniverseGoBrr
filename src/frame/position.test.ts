import { describe, expect, it } from 'vitest';
import {
  WORLD_ORIGIN,
  f32Ulp,
  fromLocal,
  maxComponentError,
  offsetLocal,
  toAbsolute,
  toCameraRelative,
  toCameraRelativeF32,
  toCameraRelativeNaiveF32,
  type Position,
} from './position';

/** A camera 10¹³ m from the frame origin, which is ADR-0002's system-frame scale. */
const ORIGIN_DISTANCE_M = 1e13;

function cameraAtOriginDistance(): Position {
  return fromLocal({ x: ORIGIN_DISTANCE_M, y: 0, z: 0 });
}

describe('camera-relative positions', () => {
  it('keeps a kilometre at 10¹³ m, where the naive path loses it entirely', () => {
    const camera = cameraAtOriginDistance();
    const target = offsetLocal(camera, 1000, 0, 0);
    const exact = toCameraRelative(target, camera);

    const fixed = toCameraRelativeF32(target, camera);
    const naive = toCameraRelativeNaiveF32(target, camera);

    expect(fixed).toEqual({ x: 1000, y: 0, z: 0 });
    expect(maxComponentError(fixed, exact)).toBe(0);

    // Float32 rounds 10¹³ + 1000 back to 10¹³, so the difference is exactly zero: the marker
    // is drawn on the camera instead of a kilometre away.
    expect(naive.x).toBe(0);
    expect(maxComponentError(naive, exact)).toBe(1000);
  });

  it('collapses every separation below half a float32 step, and only on the naive path', () => {
    const camera = cameraAtOriginDistance();
    const step = f32Ulp(ORIGIN_DISTANCE_M);
    expect(step).toBeGreaterThan(1e6);
    expect(step).toBeLessThan(1.1e6);

    for (const separation of [1, 10, 1000, 100_000]) {
      expect(separation).toBeLessThan(step / 2);
      const target = offsetLocal(camera, separation, 0, 0);
      expect(toCameraRelativeF32(target, camera).x).toBe(separation);
      expect(toCameraRelativeNaiveF32(target, camera).x).toBe(0);
    }
  });

  it('cancels the frame origin exactly when both positions share it', () => {
    const origin = { x: ORIGIN_DISTANCE_M, y: -4e12, z: 7e11 };
    const camera: Position = { origin, local: { x: 0, y: 0, z: 0 } };
    const target: Position = { origin, local: { x: 0, y: 0, z: 1 } };

    // Origin difference is exactly 0.0, so a one-metre offset survives untouched.
    expect(toCameraRelative(target, camera)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('rounds to float32 once, after subtracting, and costs under one float32 step', () => {
    const camera = cameraAtOriginDistance();
    const target = offsetLocal(camera, 0, 0, 1_300_000.123);
    const exact = toCameraRelative(target, camera);
    const fixed = toCameraRelativeF32(target, camera);

    const error = maxComponentError(fixed, exact);
    expect(error).toBeGreaterThan(0);
    expect(error).toBeLessThan(f32Ulp(exact.z));
    expect(error / exact.z).toBeLessThan(1e-7);
  });

  it('does not pretend a double resolves millimetres at 10¹³ m', () => {
    // The honest floor: a double's step at 10¹³ m is ~1.95 mm, before any float32 rounding.
    // Adding a millimetre therefore lands on the next step, not on a millimetre. That floor,
    // not the design, is why no readout claims sub-millimetre precision.
    const step = ORIGIN_DISTANCE_M + 0.001 - ORIGIN_DISTANCE_M;
    expect(step).toBeCloseTo(0.001953125, 12);
    expect(step).toBeGreaterThan(0.001);
    expect(f32Ulp(1)).toBeCloseTo(1.1920928955078125e-7, 15);
  });

  it('has the float32 steps that ADR-0008 quotes', () => {
    // The ADR's table, asserted here so it cannot drift into folklore. A step is the distance
    // between neighbouring float32 values, i.e. the smallest separation representable there.
    const steps: Array<[number, number]> = [
      [1e3, 6.103515625e-5],
      [1.496e11, 1.6384e4],
      [1e13, 1.048576e6],
      [1e15, 6.7108864e7],
      [9.461e15, 1.073741824e9],
    ];

    for (const [magnitude, expected] of steps) {
      expect(f32Ulp(magnitude) / expected).toBeCloseTo(1, 12);
    }

    // At 1 AU the step is 16 km, so a 1 km separation is not representable at all.
    expect(f32Ulp(1.496e11)).toBeGreaterThan(1000);
  });
});

describe('absolute positions', () => {
  it('adds the origin and the local offset as doubles', () => {
    const origin = WORLD_ORIGIN;
    const position: Position = { origin, local: { x: 1e13, y: 2, z: -3 } };
    expect(toAbsolute(position)).toEqual({ x: 1e13, y: 2, z: -3 });
  });

  it('is not something the GPU can receive: only the relative form is exported', () => {
    // Guards the interface, not arithmetic: `toAbsolute` returns doubles, and the only
    // float32-returning functions are the relative ones. This asserts the rounding really
    // loses the value, which is why sending an absolute would be a bug.
    const absolute = toAbsolute(fromLocal({ x: 1e13, y: 0, z: 0 }));
    expect(absolute.x).toBe(1e13);
    expect(Math.fround(absolute.x)).not.toBe(1e13);
  });

  it('keeps the frame origin out of the relative value', () => {
    // The origin contributes exactly zero to a same-frame subtraction, so a hostile or
    // merely enormous origin cannot leak magnitude into what the GPU receives.
    const origin = { x: 1e17, y: -1e17, z: 1e17 };
    const camera: Position = { origin, local: { x: 0, y: 0, z: 0 } };
    const target: Position = { origin, local: { x: 5, y: -5, z: 5 } };
    expect(toCameraRelativeF32(target, camera)).toEqual({ x: 5, y: -5, z: 5 });
  });
});