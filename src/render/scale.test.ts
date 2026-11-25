import { describe, expect, it } from 'vitest';
import { FOV_Y_RAD } from './camera';
import { galaxyMaxDistanceM } from './galaxy-scene';
import {
  GALAXY_RADIUS_M,
  GALAXY_RADIUS_MAX_M,
  GALAXY_RADIUS_MIN_M,
  SYSTEM_EXTENT_M,
  VOID_ZOOM_BOOST,
  galaxyFramingDistanceM,
  notchFactor,
  voidCompression,
} from './scale';

/** The controls' factor for one 100 px wheel notch: `exp(100 × 0.0012)`. */
const BASE = Math.exp(0.12);

describe('the void is compressed in traversal, not in position', () => {
  it('is exactly the Layer 2 rate at and below the system extent', () => {
    for (const distance of [0, 1, 1e6, 1e11, SYSTEM_EXTENT_M]) {
      expect(notchFactor(distance, BASE)).toBe(BASE);
    }
  });

  it('returns to the Layer 2 rate before the galaxy edge and keeps it beyond', () => {
    for (const distance of [GALAXY_RADIUS_M, GALAXY_RADIUS_M * 10, 1e30]) {
      expect(notchFactor(distance, BASE)).toBe(BASE);
    }
  });

  it('is faster than the base rate through the void, and bounded', () => {
    // The peak is where the schedule's two smoothsteps meet, which is no longer 1e17 now that the
    // schedule ends before the *smallest* galaxy rather than at the reference radius. Find it
    // instead of hard-coding a distance, so moving the schedule cannot silently stop testing it.
    let peak = 0;
    for (let log = 13; log <= 19; log += 0.01) {
      peak = Math.max(peak, notchFactor(10 ** log, BASE));
    }
    expect(peak).toBeGreaterThan(BASE * 1.5);
    expect(peak).toBeLessThanOrEqual(BASE ** (1 + VOID_ZOOM_BOOST) * (1 + 1e-12));
  });

  it('is finite and total, including hostile inputs', () => {
    for (const distance of [0, 1e30, Number.MAX_VALUE, Number.POSITIVE_INFINITY, -5, Number.NaN]) {
      const factor = notchFactor(distance, BASE);
      expect(Number.isFinite(factor)).toBe(true);
      expect(factor).toBeGreaterThanOrEqual(BASE);
    }
  });

  it('never steps: a log sweep changes the factor by less than 0.5% per 0.01 decade', () => {
    // The peak slope is ~0.2% per 0.01 decade; a real discontinuity would be tens of percent.
    let previous = notchFactor(1e8, BASE);
    for (let log = 8.01; log <= 25; log += 0.01) {
      const factor = notchFactor(10 ** log, BASE);
      expect(factor / previous).toBeLessThan(1.005);
      expect(factor / previous).toBeGreaterThan(0.995);
      previous = factor;
    }
  });

  it('compresses the crossing to under 100 notches, where the base rate needs ~150', () => {
    const notches = (from: number, to: number, rate: (d: number) => number): number => {
      // Integrate over log-distance: d(ln d) / ln(factor) per notch, sampled finely.
      let total = 0;
      const steps = 4000;
      const start = Math.log(from);
      const end = Math.log(to);
      for (let index = 0; index < steps; index += 1) {
        const mid = Math.exp(start + ((end - start) * (index + 0.5)) / steps);
        total += (end - start) / steps / Math.log(rate(mid));
      }
      return total;
    };

    const compressed = notches(SYSTEM_EXTENT_M, GALAXY_RADIUS_M, (d) => notchFactor(d, BASE));
    const constant = notches(SYSTEM_EXTENT_M, GALAXY_RADIUS_M, () => BASE);
    expect(compressed).toBeLessThan(100);
    expect(compressed).toBeLessThan(constant * 0.7);
  });

  it('is zero at both ends of the void and non-zero inside it', () => {
    expect(voidCompression(SYSTEM_EXTENT_M)).toBe(0);
    expect(voidCompression(GALAXY_RADIUS_M)).toBe(0);
    expect(voidCompression(1e17)).toBeGreaterThan(0.5);
  });

  it('returns to the base rate before the smallest galaxy edge', () => {
    // The schedule used to anchor on `GALAXY_RADIUS_M`, which was *the* radius. Now galaxies vary,
    // and the constraint is the smallest one: if the fast void regime ran past a small galaxy's
    // rim, the wheel would change rate underneath the viewer mid-disc. Every galaxy, so every
    // radius the law draws, has to be navigated at the base rate.
    for (const radius of [GALAXY_RADIUS_MIN_M, GALAXY_RADIUS_M, GALAXY_RADIUS_MAX_M]) {
      expect(voidCompression(radius), `${radius}`).toBe(0);
      expect(notchFactor(radius, BASE), `${radius}`).toBe(BASE);
    }
  });
});
describe('the galaxy framing distance', () => {
  it('fits the whole disc, which is off-centre from the star the camera orbits', () => {
    // The orbit camera looks at the home star; the galactic centre is a fraction of the galaxy's
    // radius away from it, so the farthest disc point is `centre offset + radius` from the origin.
    // Framing on the radius alone (the first version) put the disc's far edge outside the frame.
    const radius = 5e20;
    const centreOffsetM = 0.55 * radius;
    const distanceM = galaxyFramingDistanceM(centreOffsetM, radius);
    expect(Math.atan((centreOffsetM + radius) / distanceM)).toBeCloseTo(FOV_Y_RAD / 2, 12);
  });

  it('frames every galaxy the law can draw, not just the reference size', () => {
    // A framing distance that ignored the galaxy's own radius would crop a large galaxy and put a
    // small one at a dot. The seam is the size range, so test its ends.
    for (const radius of [GALAXY_RADIUS_MIN_M, GALAXY_RADIUS_M, GALAXY_RADIUS_MAX_M]) {
      const centreOffsetM = 0.55 * radius;
      const distanceM = galaxyFramingDistanceM(centreOffsetM, radius);
      expect(Math.atan((centreOffsetM + radius) / distanceM), `${radius}`).toBeCloseTo(
        FOV_Y_RAD / 2,
        12,
      );
    }
  });

  it('is inside the range the orbit controls allow the camera to reach', () => {
    // The zoom-out reframe writes this distance into the URL; a value the controls clamp would
    // snap on the next wheel notch, which is the class of bug the "position is derived" rule
    // exists to prevent. The ceiling is per galaxy now, so check every size the law draws.
    for (const radius of [GALAXY_RADIUS_MIN_M, GALAXY_RADIUS_M, GALAXY_RADIUS_MAX_M]) {
      const distanceM = galaxyFramingDistanceM(0.55 * radius, radius);
      expect(distanceM, `${radius}`).toBeLessThan(galaxyMaxDistanceM(radius));
      expect(distanceM, `${radius}`).toBeGreaterThan(radius);
    }
  });

  it('moves the camera out when the centre is farther from the star', () => {
    const radius = GALAXY_RADIUS_M;
    expect(galaxyFramingDistanceM(0.1 * radius, radius)).toBeLessThan(
      galaxyFramingDistanceM(0.9 * radius, radius),
    );
  });
});
