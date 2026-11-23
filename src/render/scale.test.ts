import { describe, expect, it } from 'vitest';
import {
  GALAXY_RADIUS_M,
  SYSTEM_EXTENT_M,
  VOID_ZOOM_BOOST,
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
    const peak = notchFactor(1e17, BASE);
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
});