import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import { SOL_SYSTEM } from '../universe/authored/sol';
import { generateSystem } from '../universe/system';
import {
  APPROACH_DIRECTIONS,
  APPROACH_MAX_POSITION_ERROR_PX,
  APPROACH_MIN_ULPS_ACROSS_DISC,
  aimFrom,
  approachReport,
  trueScaleReach,
  type ApproachReport,
  type ApproachSample,
} from './approach-probe';
import { projectPoint } from './camera';
import { buildSceneFrame, displayScaleM } from './system-scene';

const sol = approachReport(SOL_SYSTEM);
const procedural = approachReport(
  generateSystem('ugb-0000', parseAddressOrThrow('v1/4.-2.7')),
);

function pick(
  report: ApproachReport,
  bodyIndex: number,
  radiiOut: number,
  direction = 0,
): ApproachSample {
  const sample = report.samples.find(
    (s) => s.bodyIndex === bodyIndex && s.radiiOut === radiiOut && s.direction === APPROACH_DIRECTIONS[direction],
  );
  if (!sample) throw new Error(`no sample for body ${bodyIndex} at ${radiiOut} radii`);
  return sample;
}

describe('approach probe: does one frame hold all the way in?', () => {
  it('holds for the authored Sol system', () => {
    expect(sol.failures).toEqual([]);
    expect(sol.holds).toBe(true);
  });

  it('holds for a procedural system, not only the hand-authored one', () => {
    expect(procedural.failures).toEqual([]);
    expect(procedural.holds).toBe(true);
  });

  it('keeps the worst body displacement four orders below a pixel', () => {
    // The bar is 0.5 px; the measurement is ~10⁻⁵ px. Asserting the much tighter number means a
    // regression is caught while it is still invisible rather than when it becomes a judgement call.
    expect(sol.worstPositionErrorPx).toBeLessThan(0.001);
    expect(procedural.worstPositionErrorPx).toBeLessThan(0.001);
  });

  it('does not let the error grow as the camera approaches', () => {
    // This is the claim that matters: rounding happens *after* the camera-relative subtraction,
    // so the error is relative to the frame and does not accumulate with distance from the origin.
    const close = pick(sol, 0, 1.05);
    const far = pick(sol, 0, 1000);
    expect(far.positionErrorPx).toBeLessThan(0.001);
    expect(close.positionErrorPx).toBeLessThan(0.001);
    // And the close approach is not paying for it in float32 resolution either.
    expect(close.ulpsAcrossDisc).toBeGreaterThan(far.ulpsAcrossDisc);
  });

  it('gains float32 resolution across the disc as the camera closes in', () => {
    const near = pick(sol, 2, 10);
    const far = pick(sol, 2, 100);
    // Ten times closer means a ten times smaller coordinate magnitude. float32's step only
    // changes at powers of two, so a decade of distance must land on a ratio of 8 or 16 - never
    // 10. Asserting a smooth 10 would be asserting that floats are logarithmic, which they are
    // not.
    const ratio = near.ulpsAcrossDisc / far.ulpsAcrossDisc;
    expect([8, 16]).toContain(ratio);
  });

  it('keeps every body well inside the near plane', () => {
    expect(sol.maxReverseZDepth).toBeLessThan(0.5);
    expect(procedural.maxReverseZDepth).toBeLessThan(0.5);
  });

  it('reaches the surface without clipping in the drawn orrery', () => {
    // 1.05 drawn radii is just outside the sphere. If this ever failed, the closest legal
    // approach would be governed by the near plane rather than by the body.
    const grazing = sol.samples.filter((s) => s.radiiOut === 1.05);
    expect(grazing).toHaveLength(SOL_SYSTEM.planets.length * APPROACH_DIRECTIONS.length);
    expect(Math.max(...grazing.map((s) => s.reverseZDepth))).toBeLessThan(1);
  });

  it('passes from every approach direction, not one lucky ray', () => {
    // A single ray could pass because of the particular geometry it happened to cross.
    APPROACH_DIRECTIONS.forEach((_, index) => {
      const ray = sol.samples.filter((s) => s.direction === APPROACH_DIRECTIONS[index]);
      expect(Math.max(...ray.map((s) => s.positionErrorPx))).toBeLessThan(
        APPROACH_MAX_POSITION_ERROR_PX,
      );
      expect(Math.min(...ray.map((s) => s.ulpsAcrossDisc))).toBeGreaterThan(
        APPROACH_MIN_ULPS_ACROSS_DISC,
      );
    });
  });

  it('records how often the camera ends up inside the corona', () => {
    // Not a pass or a failure: the corona is an additive billboard of fixed radius, and the inner
    // planets orbit inside it. Recorded so the count is a number rather than an impression.
    expect(sol.glareSamples).toBeGreaterThan(0);
    expect(sol.coreSamples).toBe(0);
  });
});

describe('approach probe: the failure it must be able to report', () => {
  it('fails when the frame is stretched past what float32 can resolve', () => {
    // 10⁹ drawn radii is not a camera anyone would build, but it is the same failure mode as a
    // frame whose bodies shrank: fewer and fewer float32 steps across the disc. A probe that can
    // only pass would not be evidence for anything.
    const stretched = approachReport(SOL_SYSTEM, { radii: [1e9] });
    expect(stretched.holds).toBe(false);
    expect(stretched.fewestUlpsAcrossDisc).toBeLessThan(APPROACH_MIN_ULPS_ACROSS_DISC);
    expect(stretched.failures.join(' ')).toContain('float32 steps');
  });
});

describe('approach probe: aiming', () => {
  it('puts the target at the centre of the frame', () => {
    const system = SOL_SYSTEM;
    const scale = displayScaleM(system);
    const planet = system.planets[2]!;
    const world = {
      x: planet.semiMajorAxisM * 0.5,
      y: 0,
      z: planet.semiMajorAxisM * 0.3,
    };
    const camera = aimFrom({ x: world.x + 3e9, y: 1e9, z: world.z + 4e9 }, world);
    const frame = buildSceneFrame(system, camera, 0, 16 / 9, 1080);
    const target = {
      x: (world.x - camera.x) / scale,
      y: (world.y - camera.y) / scale,
      z: (world.z - camera.z) / scale,
    };
    const projected = projectPoint(frame.viewProjection, target);
    expect(projected.x).toBeCloseTo(0, 6);
    expect(projected.y).toBeCloseTo(0, 6);
  });

  it('reports the near plane in real body radii, which is where landing will bite', () => {
    // The pass above is about the *drawn* orrery, where bodies are exaggerated. At true scale the
    // near plane sits hundreds of real radii out, so "fly down to the surface" is a depth-range
    // problem for Layer 6, not something this layer's rebase can fix.
    const earth = SOL_SYSTEM.planets[2]!;
    const reach = trueScaleReach(SOL_SYSTEM, earth);
    expect(reach.nearInBodyRadii).toBeGreaterThan(100);
    expect(reach.realRadiusUnits).toBeLessThan(reach.nearUnits);
  });
});