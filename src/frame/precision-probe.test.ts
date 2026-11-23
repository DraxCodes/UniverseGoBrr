import { describe, expect, it } from 'vitest';
import {
  PROBE_ORIGIN_DISTANCE_M,
  createPrecisionProbe,
  focalLength,
  precisionReport,
  projectMarkers,
  spreadPx,
} from './precision-probe';

const probe = createPrecisionProbe();

describe('precision probe', () => {
  it('places three markers 10¹³ m from the frame origin', () => {
    expect(probe.markers).toHaveLength(3);
    expect(probe.camera.local.x).toBe(PROBE_ORIGIN_DISTANCE_M);
    expect(precisionReport(probe, 1920, 1080).originDistanceM).toBe(PROBE_ORIGIN_DISTANCE_M);
  });

  it('separates the markers on the fixed path and collapses them on the naive path', () => {
    const report = precisionReport(probe, 1920, 1080);

    expect(report.paths.fixed.spreadPx).toBeGreaterThan(100);
    expect(report.paths.naive.spreadPx).toBeLessThan(0.5);

    // The naive path does not merely move the markers: it lands all three on one pixel.
    const [a, b, c] = report.paths.naive.markers;
    expect(b!.px).toEqual(a!.px);
    expect(c!.px).toEqual(a!.px);
    expect(a!.px).toEqual([960, 540]);
  });

  it('reports the error in metres, which is the number the HUD shows', () => {
    const report = precisionReport(probe, 1920, 1080);

    // Naive loses a quarter of a megametre; fixed is under a centimetre — and ~2 mm of that
    // floor is the double's own resolution at 10¹³ m, not float32.
    expect(report.paths.naive.worstErrorM).toBeGreaterThan(2e5);
    expect(report.paths.fixed.worstErrorM).toBeLessThan(0.01);
    expect(
      report.paths.naive.worstErrorM / Math.max(report.paths.fixed.worstErrorM, 1e-9),
    ).toBeGreaterThan(1e7);
  });

  it('scales the pixel spread with the viewport, as a projection must', () => {
    const small = precisionReport(probe, 1920, 1080);
    const large = precisionReport(probe, 3840, 2160);
    expect(large.paths.fixed.spreadPx / small.paths.fixed.spreadPx).toBeCloseTo(2, 6);
    expect(large.paths.naive.spreadPx).toBeLessThan(0.5);
  });

  it('uses one focal length in the readout and the shader', () => {
    // 70° horizontal field of view, passed to WGSL through the uniform block.
    expect(focalLength()).toBeCloseTo(1 / Math.tan((70 * Math.PI) / 360), 12);
  });
});

describe('projectMarkers', () => {
  it('puts a point on the camera axis at the centre of the frame', () => {
    const [marker] = projectMarkers([{ x: 0, y: 0, z: 1000 }], ['A'], 1920, 1080);
    expect(marker!.px).toEqual([960, 540]);
  });

  it('puts a point to the right of the axis right of centre', () => {
    const [marker] = projectMarkers([{ x: 100, y: 0, z: 1000 }], ['A'], 1920, 1080);
    expect(marker!.px[0]).toBeGreaterThan(960);
    expect(marker!.px[1]).toBeCloseTo(540, 10);
  });

  it('measures spread between the furthest pair, not the first and last', () => {
    const markers = [
      { label: 'a', px: [0, 0] as [number, number] },
      { label: 'b', px: [3, 4] as [number, number] },
      { label: 'c', px: [0, 2] as [number, number] },
    ];
    expect(spreadPx(markers)).toBe(5);
  });
});