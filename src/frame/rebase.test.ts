import { describe, expect, it } from 'vitest';
import {
  DOUBLE_SLACK,
  maxOffsetM,
  offsetIsBeyondFrame,
  rebaseCamera,
  type FrameCamera,
} from './rebase';
import {
  fromLocal,
  maxComponentError,
  toCameraRelative,
  toCameraRelativeF32,
  vec3,
} from './position';
import {
  cameraBasis,
  multiply,
  projectPoint,
  reverseZProjection,
  viewFromBasis,
} from '../render/camera';
import { SOL_SYSTEM } from '../universe/authored/sol';
import { displayScaleM } from '../render/system-scene';

const LIGHT_YEAR_M = 9.460_730_472_580_8e15;

/** The projection the renderer uses for a 16:9 frame at the orrery's near plane. */
function viewProjection(): Float32Array {
  return multiply(reverseZProjection(16 / 9, 0.002), viewFromBasis(cameraBasis(0, 0)));
}

function projectPx(point: { x: number; y: number; z: number }, width = 1920, height = 1080) {
  const clip = projectPoint(viewProjection(), point);
  return { x: (clip.x * 0.5 + 0.5) * width, y: (0.5 - clip.y * 0.5) * height };
}

describe('rebaseCamera: the shift convention', () => {
  it('subtracts the shift, because the shift points from the old origin to the new one', () => {
    const camera: FrameCamera = { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 };
    const moved = rebaseCamera(camera, vec3(10, 20, 30));
    expect([moved.x, moved.y, moved.z]).toEqual([-9, -18, -27]);
  });

  it('leaves orientation untouched', () => {
    const camera: FrameCamera = { x: 100, y: -50, z: 25, yaw: 0.75, pitch: -0.4 };
    const moved = rebaseCamera(camera, vec3(1e9, -2e9, 3e9));
    expect(moved.yaw).toBe(0.75);
    expect(moved.pitch).toBe(-0.4);
  });

  it('is the identity for a zero shift', () => {
    const camera: FrameCamera = { x: 12, y: -3, z: 7, yaw: 1, pitch: 2 };
    expect(rebaseCamera(camera, vec3(0, 0, 0))).toEqual(camera);
  });

  it('round-trips exactly when the values are exactly representable', () => {
    const camera: FrameCamera = { x: 4, y: -6, z: 8, yaw: 0.1, pitch: 0.2 };
    const shift = vec3(10, 20, -30);
    const there = rebaseCamera(camera, shift);
    const back = rebaseCamera(there, vec3(-shift.x, -shift.y, -shift.z));
    expect([back.x, back.y, back.z]).toEqual([camera.x, camera.y, camera.z]);
  });

  it('shifts a target with the eye, so the view direction is preserved', () => {
    const camera: FrameCamera = {
      x: 100,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      target: { x: 90, y: 0, z: 0 },
    };
    const moved = rebaseCamera(camera, vec3(50, 0, 0));
    expect(moved.x).toBe(50);
    expect(moved.target).toEqual({ x: 40, y: 0, z: 0 });

    // The eye-to-target offset — which is the whole meaning of the view — is unchanged.
    const before = {
      x: camera.x - camera.target!.x,
      y: camera.y - camera.target!.y,
      z: camera.z - camera.target!.z,
    };
    const after = { x: moved.x - moved.target!.x, y: moved.y - moved.target!.y, z: moved.z - moved.target!.z };
    expect(after).toEqual(before);
  });

  it('leaves a camera that has no target exactly as it was', () => {
    const camera: FrameCamera = { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 };
    const moved = rebaseCamera(camera, vec3(1, 1, 1));
    expect('target' in moved).toBe(false);
  });
});

describe('rebaseCamera: the picture must not change', () => {
  /**
   * The invariant ADR-0003 actually promises: the rebase is invisible, and only the tier crossing
   * is a visible effect. So rebasing the camera and expressing the same target in the new frame
   * must land it on the same pixel.
   *
   * The cost is `ulp(shift) / depth`: a double step at the new origin's magnitude, divided by how
   * far the nearest visible thing is. Both terms move with the frame, so the familiar case - a
   * closeup after a warp - is the one that has to pass, and the depth is stated per case rather
   * than assumed.
   */
  function displacementPx(shiftM: { x: number; y: number; z: number }, depthM: number): number {
    const camera: FrameCamera = { x: 4.5e12, y: 0, z: 0, yaw: 0, pitch: 0 };
    const moved = rebaseCamera(camera, shiftM);

    // A body 1,000 km to the side, at `depthM` in front. Placed by the same shift once, in the new
    // frame's own arithmetic - which is what a placement function would do at full precision.
    const body = { x: camera.x + 1e6, y: 0, z: -depthM };
    const bodyInNewFrame = {
      x: body.x - shiftM.x,
      y: body.y - shiftM.y,
      z: body.z - shiftM.z,
    };

    const before = projectPx(
      toCameraRelativeF32(fromLocal(body), fromLocal(camera)),
    );
    const after = projectPx(
      toCameraRelativeF32(fromLocal(bodyInNewFrame), fromLocal(moved)),
    );
    return Math.hypot(after.x - before.x, after.y - before.y);
  }

  it('survives a 10 ly rebase to well under a thousandth of a pixel', () => {
    // The realistic warp: a system frame 10 ly from its neighbour, with a body 10⁹ m deep. The
    // rebased camera carries ~16 m of double rounding, which at this depth is ~2×10⁻⁵ px.
    expect(displacementPx(vec3(10 * LIGHT_YEAR_M, 0, 0), 1e9)).toBeLessThan(0.001);
  });

  it('survives a rebase across a whole galaxy', () => {
    // At 50,000 ly a double step is ~65 km, so the bound only holds because the nearest visible
    // thing in a galaxy frame is itself ~10²⁰ m away. Quoting the pair is the point: the cost is a
    // ratio, and neither number means anything alone.
    expect(displacementPx(vec3(50_000 * LIGHT_YEAR_M, 0, 0), 1e20)).toBeLessThan(0.001);
  });

  it('costs a double step at the shifted magnitude, not at the frame scale', () => {
    // The shift sets the magnitude, so the error is bounded by the *new* origin's distance - not
    // by the frame the camera came from. Stated as a number so a future change to the arithmetic
    // shows up here rather than in a picture.
    const camera: FrameCamera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const shift = vec3(10 * LIGHT_YEAR_M, 0, 0);
    const moved = rebaseCamera(camera, shift);

    const exact = toCameraRelative(fromLocal(vec3(1e9, 0, 0)), fromLocal(camera));
    const rebuilt = toCameraRelative(
      fromLocal(vec3(1e9 - shift.x, 0, 0)),
      fromLocal(vec3(moved.x, moved.y, moved.z)),
    );
    // 10 ly needs a 16 m double step; allow one step and no more.
    expect(maxComponentError(rebuilt, exact)).toBeLessThan(32);
  });
});

describe('maxOffsetM: how far a frame can hold a camera', () => {
  const solRadiusM = displayScaleM(SOL_SYSTEM);

  it('puts the flat parser cap outside a solar-system frame, seven orders out', () => {
    // MAX_POSITION_M is 10³⁰ m. For a frame whose radius is Neptune's orbit the resolvable bound
    // is ~1.5×10²², so the flat cap is far outside it. That is recorded rather than acted on:
    // exceeding the bound shows an empty frame, not a wrong one (see `maxOffsetM`).
    expect(maxOffsetM(solRadiusM)).toBeLessThan(1e30 / 1e5);
    expect(offsetIsBeyondFrame({ x: 1e30, y: 0, z: 0 }, solRadiusM)).toBe(true);
  });

  it('stays inside the same cap at galaxy scale, where 10³⁰ m is not degenerate', () => {
    // GALAXY_RADIUS_M is 5×10²⁰ m, so the bound there is ~2×10³⁰ and the parser cap falls inside
    // it. The same camera value is therefore rejectable at one scale and fine at another - which
    // is exactly why no per-frame check is wired yet: "this frame's radius" depends on which
    // frame is being drawn, and one address currently spans both (capture shots at 1.3×10²¹ m
    // are galaxy framings under a system address).
    expect(offsetIsBeyondFrame({ x: 1e30, y: 0, z: 0 }, 5e20)).toBe(false);
  });

  it('accepts an offset a frame can actually resolve', () => {
    const limit = maxOffsetM(solRadiusM);
    expect(offsetIsBeyondFrame({ x: limit * 0.5, y: 0, z: 0 }, solRadiusM)).toBe(false);
    expect(offsetIsBeyondFrame({ x: limit * 2, y: 0, z: 0 }, solRadiusM)).toBe(true);
  });

  it('scales with the frame, so a bigger frame may hold a further camera', () => {
    expect(maxOffsetM(solRadiusM * 1e4) / maxOffsetM(solRadiusM)).toBeCloseTo(1e4, 6);
  });

  it('keeps one double step inside the frame tolerance it promises', () => {
    const limit = maxOffsetM(solRadiusM);
    const doubleStep = limit * Math.pow(2, -52);
    expect(doubleStep / solRadiusM).toBeLessThanOrEqual(DOUBLE_SLACK * 1.0000001);
  });

  it('refuses non-finite and non-positive frame radii instead of returning Infinity', () => {
    expect(maxOffsetM(0)).toBe(0);
    expect(maxOffsetM(-1)).toBe(0);
    expect(maxOffsetM(Number.POSITIVE_INFINITY)).toBe(0);
    expect(maxOffsetM(Number.NaN)).toBe(0);
  });

  it('treats a non-finite camera as outside every frame', () => {
    expect(offsetIsBeyondFrame({ x: Number.NaN, y: 0, z: 0 }, 1e12)).toBe(true);
    expect(offsetIsBeyondFrame({ x: Number.POSITIVE_INFINITY, y: 0, z: 0 }, 1e12)).toBe(true);
  });
});