import { describe, expect, it } from 'vitest';
import {
  FOV_Y_RAD,
  cameraBasis,
  multiply,
  projectPoint,
  reverseZProjection,
  viewFromBasis,
} from './camera';

const NEAR = 0.01;

function viewProjection(yaw: number, pitch: number, aspect = 16 / 9): Float32Array {
  return multiply(reverseZProjection(aspect, NEAR), viewFromBasis(cameraBasis(yaw, pitch)));
}

function near(left: number, right: number): void {
  expect(Math.abs(left - right)).toBeLessThan(1e-9);
}

describe('camera basis', () => {
  it('looks down -z at zero rotation', () => {
    const basis = cameraBasis(0, 0);
    near(basis.forward.x, 0);
    near(basis.forward.y, 0);
    near(basis.forward.z, -1);
    near(basis.right.x, 1);
    near(basis.up.y, 1);
  });

  it('is orthonormal at any rotation', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1.2, 0.4],
      [-2.5, -0.7],
      [0, Math.PI / 2 - 0.01],
    ] as const) {
      const { right, up, forward } = cameraBasis(yaw, pitch);
      const dot = (a: typeof right, b: typeof right) => a.x * b.x + a.y * b.y + a.z * b.z;
      near(dot(right, right), 1);
      near(dot(up, up), 1);
      near(dot(forward, forward), 1);
      near(dot(right, up), 0);
      near(dot(right, forward), 0);
      near(dot(up, forward), 0);
    }
  });

  it('stays finite when looking straight up, instead of producing NaN', () => {
    const basis = cameraBasis(0.7, Math.PI / 2);
    for (const vector of [basis.right, basis.up, basis.forward]) {
      expect(Number.isFinite(vector.x)).toBe(true);
      expect(Number.isFinite(vector.y)).toBe(true);
      expect(Number.isFinite(vector.z)).toBe(true);
    }
  });
});

describe('reverse-Z projection', () => {
  it('maps the near plane to depth 1 and aims at 0 towards infinity', () => {
    // Everything below is float32 (the matrices the GPU receives), so ~1e-7 is the resolution.
    const vp = viewProjection(0, 0);
    const atNear = projectPoint(vp, { x: 0, y: 0, z: -NEAR });
    expect(atNear.depth).toBeCloseTo(1, 6);

    const far = projectPoint(vp, { x: 0, y: 0, z: -1e6 });
    expect(far.depth).toBeGreaterThan(0);
    expect(far.depth).toBeLessThan(1e-4);

    // Monotone: nearer is a larger depth value, which is why the compare is 'greater'.
    const closer = projectPoint(vp, { x: 0, y: 0, z: -2 });
    const farther = projectPoint(vp, { x: 0, y: 0, z: -5 });
    expect(closer.depth).toBeGreaterThan(farther.depth);
  });

  it('puts the forward axis at the centre of the screen', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [0.9, 0.3],
      [-1.7, -0.55],
    ] as const) {
      const vp = viewProjection(yaw, pitch);
      const forward = cameraBasis(yaw, pitch).forward;
      const ahead = projectPoint(vp, {
        x: forward.x * 4,
        y: forward.y * 4,
        z: forward.z * 4,
      });
      expect(Math.abs(ahead.x)).toBeLessThan(1e-6);
      expect(Math.abs(ahead.y)).toBeLessThan(1e-6);
      expect(ahead.w).toBeCloseTo(4, 5);
    }
  });

  it('maps right to +x and up to +y on screen', () => {
    const vp = viewProjection(0, 0);
    expect(projectPoint(vp, { x: 1, y: 0, z: -4 }).x).toBeGreaterThan(0);
    expect(projectPoint(vp, { x: -1, y: 0, z: -4 }).x).toBeLessThan(0);
    expect(projectPoint(vp, { x: 0, y: 1, z: -4 }).y).toBeGreaterThan(0);
    expect(projectPoint(vp, { x: 0, y: -1, z: -4 }).y).toBeLessThan(0);
  });

  it('fills the horizontal field of view at the aspect-aware edge', () => {
    const aspect = 21 / 9;
    const vp = viewProjection(0, 0, aspect);
    const halfWidth = Math.tan(FOV_Y_RAD / 2) * aspect;
    const edge = projectPoint(vp, { x: halfWidth * 4, y: 0, z: -4 });
    expect(edge.x).toBeCloseTo(1, 5);

    // Vertical edge stays at 1 regardless of aspect, since FOV_Y is the fixed one.
    const top = projectPoint(vp, { x: 0, y: Math.tan(FOV_Y_RAD / 2) * 4, z: -4 });
    expect(top.y).toBeCloseTo(1, 5);
  });

  it('is camera-relative: the camera position does not enter the matrix', () => {
    // The view matrix must carry no translation, because the world is pre-translated by
    // `toCameraRelativeF32`. A translation term here would defeat ADR-0008 at 10¹¹ m.
    const view = viewFromBasis(cameraBasis(0.4, -0.2));
    expect(view[12]).toBe(0);
    expect(view[13]).toBe(0);
    expect(view[14]).toBe(0);
    expect(view[15]).toBe(1);

    // The projection's only constant term is `near` in the depth row; no lateral translation.
    const vp = viewProjection(0.4, -0.2);
    expect(vp[12]).toBe(0);
    expect(vp[13]).toBe(0);
    expect(Array.from(viewProjection(0.4, -0.2))).toEqual(Array.from(vp));
  });
});

describe('matrix multiply', () => {
  it('multiplies identity without changing a matrix', () => {
    const vp = viewProjection(0.3, 0.1);
    const id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(Array.from(multiply(id, vp))).toEqual(Array.from(vp));
    expect(Array.from(multiply(vp, id))).toEqual(Array.from(vp));
  });
});