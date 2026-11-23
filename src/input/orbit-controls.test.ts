import { describe, expect, it } from 'vitest';
import {
  DRAG_SENSITIVITY,
  MAX_DISTANCE_FACTOR,
  MIN_DISTANCE_FACTOR,
  PITCH_LIMIT,
  dragOrbit,
  orbitDistance,
  orbitParams,
  orbitTo,
  zoomBy,
  zoomEdge,
} from './orbit-controls';
import { cameraBasis, projectPoint, multiply, reverseZProjection, viewFromBasis } from '../render/camera';

const SCALE = 1.96e12; // outermost orbit of the reference system, metres
const HOME = { x: 0, y: 1.75 * SCALE, z: 2.35 * SCALE, yaw: 0, pitch: -0.6400881527617461 };

/** Where the star appears on screen, given a camera and an aspect ratio. */
function starOnScreen(camera: { x: number; y: number; z: number; yaw: number; pitch: number }) {
  const vp = multiply(reverseZProjection(16 / 9, 0.002), viewFromBasis(cameraBasis(camera.yaw, camera.pitch)));
  return projectPoint(vp, { x: -camera.x, y: -camera.y, z: -camera.z });
}

describe('orbit parameters round-trip', () => {
  it('derives the home camera back from its own position', () => {
    const { yaw, pitch, distance } = orbitParams(HOME);
    expect(yaw).toBeCloseTo(HOME.yaw, 9);
    expect(pitch).toBeCloseTo(HOME.pitch, 9);
    expect(distance).toBeCloseTo(Math.hypot(HOME.x, HOME.y, HOME.z), 6);

    const rebuilt = orbitTo(yaw, pitch, distance);
    // These are 10¹² m values: a double's ulp there is ~0.001 m, so compare relatively.
    const relative = (left: number, right: number) =>
      Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1);
    expect(relative(rebuilt.x, HOME.x)).toBeLessThan(1e-12);
    expect(relative(rebuilt.y, HOME.y)).toBeLessThan(1e-12);
    expect(relative(rebuilt.z, HOME.z)).toBeLessThan(1e-12);
  });

  it('keeps position and angles consistent, which the renderer depends on', () => {
    // The renderer uses the position for translation and yaw/pitch for the basis. If a control
    // updated one without the other, the star would drift off-screen while the view still pointed
    // at where it used to be.
    for (const [yaw, pitch, distance] of [
      [0.3, -0.5, SCALE],
      [-2.1, 0.2, 3 * SCALE],
      [1.0, -1.4, 0.2 * SCALE],
    ] as const) {
      const camera = orbitTo(yaw, pitch, distance);
      const projected = starOnScreen(camera);
      expect(Math.abs(projected.x), `yaw ${yaw}`).toBeLessThan(1e-6);
      expect(Math.abs(projected.y), `pitch ${pitch}`).toBeLessThan(1e-6);
    }
  });
});

describe('dragging', () => {
  it('orbits without changing the distance to the star', () => {
    const before = orbitDistance(HOME);
    let camera = HOME;
    for (const [dx, dy] of [
      [40, 0],
      [0, -25],
      [-120, 60],
      [300, -15],
    ] as const) {
      camera = dragOrbit(camera, dx, dy);
      const relative = Math.abs(orbitDistance(camera) - before) / before;
      expect(relative).toBeLessThan(1e-12);
    }
  });

  it('turns the way the drag says it should', () => {
    const right = dragOrbit(HOME, 100, 0);
    // Dragging right rotates the system right, i.e. the eye moves left of the star.
    expect(right.x).toBeLessThan(HOME.x);

    const up = dragOrbit(HOME, 0, -100);
    // Dragging up raises the eye over the system: a more negative pitch, a higher y.
    expect(up.y).toBeGreaterThan(HOME.y);
    expect(up.pitch).toBeLessThan(HOME.pitch);

    const down = dragOrbit(HOME, 0, 100);
    expect(down.y).toBeLessThan(HOME.y);
    expect(down.pitch).toBeGreaterThan(HOME.pitch);
  });

  it('never flips past the pole, and never NaNs the basis', () => {
    let camera = HOME;
    // Dragging down sixty times walks the pitch to the lower limit (and clamps there).
    for (let step = 0; step < 60; step += 1) camera = dragOrbit(camera, 0, 60);
    expect(camera.pitch).toBeCloseTo(PITCH_LIMIT, 9);
    const basis = cameraBasis(camera.yaw, camera.pitch);
    for (const component of [basis.right.x, basis.up.y, basis.forward.z]) {
      expect(Number.isFinite(component)).toBe(true);
    }

    let up = HOME;
    for (let step = 0; step < 60; step += 1) up = dragOrbit(up, 0, -60);
    expect(up.pitch).toBeCloseTo(-PITCH_LIMIT, 9);
  });

  it('uses a sensitivity that makes a full turn reachable in one drag', () => {
    // A 2π turn should need about 1300 px, which fits on a 1440p screen in one gesture.
    expect((Math.PI * 2) / DRAG_SENSITIVITY).toBeLessThan(1400);
    expect((Math.PI * 2) / DRAG_SENSITIVITY).toBeGreaterThan(800);
  });

  it('keeps the star centred through a long drag', () => {
    let camera = HOME;
    for (let step = 0; step < 40; step += 1) {
      camera = dragOrbit(camera, 37, -11);
      const projected = starOnScreen(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1e-6);
      expect(Math.abs(projected.y)).toBeLessThan(1e-6);
    }
  });
});

describe('zooming', () => {
  it('scales distance and keeps the angles', () => {
    const before = orbitParams(HOME);
    const closer = zoomBy(HOME, 0.5, SCALE);
    const after = orbitParams(closer);
    expect(after.distance).toBeCloseTo(before.distance * 0.5, 3);
    expect(after.yaw).toBeCloseTo(before.yaw, 9);
    expect(after.pitch).toBeCloseTo(before.pitch, 9);
  });

  it('clamps at both ends so the frame always has a usable view', () => {
    let camera = HOME;
    for (let step = 0; step < 80; step += 1) camera = zoomBy(camera, 1.3, SCALE);
    expect(orbitDistance(camera)).toBeCloseTo(MAX_DISTANCE_FACTOR * SCALE, 0);

    for (let step = 0; step < 200; step += 1) camera = zoomBy(camera, 0.7, SCALE);
    expect(orbitDistance(camera)).toBeCloseTo(MIN_DISTANCE_FACTOR * SCALE, 0);
  });

  it('never reaches the origin, which would put the camera inside the star', () => {
    let camera = HOME;
    for (let step = 0; step < 500; step += 1) camera = zoomBy(camera, 0.5, SCALE);
    expect(orbitDistance(camera)).toBeGreaterThan(0.01 * SCALE);
  });

  it('reaches the galaxy when given a farther bound, and still clamps there', () => {
    // Layer 3 raises the reachable distance; the URL keeps real metres, so this is the only
    // bound that changes.
    const galaxyMax = 6e21;
    let camera = HOME;
    for (let step = 0; step < 400; step += 1) {
      camera = zoomBy(camera, 1.3, SCALE, galaxyMax);
    }
    expect(orbitDistance(camera)).toBeCloseTo(galaxyMax, 0);
    expect(zoomEdge(camera, 1.3, SCALE, galaxyMax)).toBe('max');
  });
});

describe('zoom clamp feedback', () => {
  it('does not report an edge while the notch still moves the camera', () => {
    expect(zoomEdge(HOME, 1.1, SCALE)).toBeNull();
    expect(zoomEdge(HOME, 0.9, SCALE)).toBeNull();
  });

  it('reports max only once the camera is at the limit and the notch is swallowed', () => {
    let camera = HOME;
    // Bounded, because "at the limit" is a ±1 ulp question: see zoomEdge.
    for (let step = 0; step < 80; step += 1) camera = zoomBy(camera, 1.3, SCALE);
    expect(orbitDistance(camera)).toBeCloseTo(MAX_DISTANCE_FACTOR * SCALE, 0);
    // The notch that arrived at the limit still moved; the next one is the silent one.
    expect(zoomEdge(camera, 1.3, SCALE)).toBe('max');
    expect(orbitDistance(zoomBy(camera, 1.3, SCALE))).toBeCloseTo(orbitDistance(camera), 6);
  });

  it('reports min once the camera is at the limit and the notch is swallowed', () => {
    let camera = HOME;
    for (let step = 0; step < 200; step += 1) camera = zoomBy(camera, 0.7, SCALE);
    expect(orbitDistance(camera)).toBeCloseTo(MIN_DISTANCE_FACTOR * SCALE, 0);
    expect(zoomEdge(camera, 0.7, SCALE)).toBe('min');
    expect(zoomEdge(camera, 1.3, SCALE)).toBeNull();
  });
});