import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import {
  GALAXY_TIER_STARS,
  LOCAL_RADIUS_M,
  generateGalaxy,
} from '../universe/galaxy';
import { generateSystem } from '../universe/system';
import { orbitTo } from '../input/orbit-controls';
import { GALAXY_RADIUS_M } from './scale';
import { defaultSystemCamera, displayScaleM } from './system-scene';
import {
  GALAXY_INSTANCE_FLOATS,
  GALAXY_MAX_DISTANCE_M,
  GALAXY_MAX_INSTANCES,
  GALAXY_STAR_MAX_PX,
  GALAXY_STAR_MIN_PX,
  armModulation,
  f32Ulp,
  f64Ulp,
  galaxyLegibility,
  galaxyLod,
  nextQualityTier,
  writeGalaxyFrame,
} from './galaxy-scene';

const SEED = 'ugb-0000';
const ADDRESS = parseAddressOrThrow('v1/4.-2.7');
const SYSTEM = generateSystem(SEED, ADDRESS);
const SCALE = displayScaleM(SYSTEM);
const GALAXY = generateGalaxy(SEED, ADDRESS, 'rich');
const HEIGHT = 1080;
const ASPECT = 16 / 9;
const PITCH = -0.6390168339184684;
const ORRERY = defaultSystemCamera(SYSTEM);
const GALAXY_CAMERA = orbitTo(0, PITCH, GALAXY_MAX_DISTANCE_M);

function frameAt(tier: 'rich' | 'low', camera: typeof ORRERY) {
  const out = new Float32Array(GALAXY_MAX_INSTANCES * GALAXY_INSTANCE_FLOATS);
  const frame = writeGalaxyFrame(out, GALAXY, tier, camera, SCALE, HEIGHT, ASPECT);
  return { out, frame };
}

describe('the crossfade is triggered by galaxy legibility, not by the system', () => {
  it('is exactly zero at the orrery and resolved at the reachable galaxy view', () => {
    expect(galaxyLod(GALAXY, ORRERY, HEIGHT)).toBe(0);

    const far = galaxyLegibility(GALAXY, GALAXY_CAMERA, HEIGHT);
    expect(far.lod).toBeGreaterThan(0.9);
    expect(far.fit).toBeGreaterThan(0.9);
    expect(far.resolved).toBe(1);
    expect(far.contrast).toBeGreaterThan(0.4);
  });

  it('never decreases as the wheel retreats from the system to the galaxy', () => {
    let previous = -1;
    const start = Math.log10(Math.hypot(ORRERY.x, ORRERY.y, ORRERY.z));
    const end = Math.log10(GALAXY_MAX_DISTANCE_M);
    for (let log = start; log <= end; log += 0.02) {
      const camera = orbitTo(0, PITCH, 10 ** log);
      const lod = galaxyLod(GALAXY, camera, HEIGHT);
      expect(lod, `lod at 10^${log.toFixed(2)} m`).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = lod;
    }
    expect(previous).toBeGreaterThan(0.9);
  });

  it('starts only after the orrery is a sub-pixel diagram', () => {
    // The failure the council named is a legible galaxy while the orrery is still readable.
    // Find the first distance where the ramp moves at all, and project the outermost orbit and
    // the largest planet there. (The galaxy centre is behind home for this camera, so the eye
    // leaves the disc before the home distance does.)
    let firstLod = 0;
    let firstDistance = 0;
    const start = Math.log10(Math.hypot(ORRERY.x, ORRERY.y, ORRERY.z));
    for (let log = start; log <= Math.log10(GALAXY_MAX_DISTANCE_M); log += 0.01) {
      const camera = orbitTo(0, PITCH, 10 ** log);
      const lod = galaxyLod(GALAXY, camera, HEIGHT);
      if (lod > 0.05) {
        firstLod = lod;
        firstDistance = 10 ** log;
        break;
      }
    }

    expect(firstLod).toBeGreaterThan(0.05);
    // The eye has to be outside the disc, and home is at 0.55 R, so the ramp cannot start before
    // ~0.45 R from home even when the camera looks from the centre's far side.
    expect(firstDistance).toBeGreaterThan(0.4 * GALAXY_RADIUS_M);

    const focalPx = HEIGHT / (2 * Math.tan((50 * Math.PI) / 360));
    const orbitPx = (focalPx / (firstDistance / SCALE)) * 1; // outermost orbit = 1 display unit
    expect(orbitPx).toBeLessThan(0.01);

    const largestPlanet = Math.max(...SYSTEM.planets.map((planet) => planet.sizeFraction));
    const planetPx = (largestPlanet / (firstDistance / SCALE)) * focalPx;
    expect(planetPx).toBeLessThan(0.01);
  });

  it('completes while camera-relative positions still resolve the local field', () => {
    // The f32 upload is the second precision floor: two nearby stars are distinguishable only
    // while the quantum at the camera's distance is smaller than their separation. The local
    // field's mean nearest-neighbour spacing is the honest yardstick.
    const localCount = GALAXY_TIER_STARS.rich.local;
    const volume = (4 / 3) * Math.PI * LOCAL_RADIUS_M ** 3;
    const meanSpacingM = (volume / localCount) ** (1 / 3);

    // Double subtraction happens before rounding, so the binding quantum is one double ulp at
    // the camera distance; the crossfade has ~eleven orders of margin at the far end.
    expect(f64Ulp(GALAXY_MAX_DISTANCE_M)).toBeLessThan(meanSpacingM / 1e9);

    // And after the divide to display units, the f32 quantum is still far below the spacing.
    const distanceUnits = GALAXY_MAX_DISTANCE_M / SCALE;
    expect(f32Ulp(distanceUnits) * 10).toBeLessThan(meanSpacingM / SCALE);
  });
});

describe('the impostor buffer', () => {
  it('packs the tier count, excludes the home star, and is camera-relative', () => {
    const { out, frame } = frameAt('rich', ORRERY);
    const counts = GALAXY_TIER_STARS.rich;
    expect(frame.count).toBe(counts.local + counts.disc);

    // Instance 0 is the first local star; the home star is the orrery's own glare quad.
    const firstLocal = GALAXY.stars[1]!;
    const expectedX = (firstLocal.x - ORRERY.x) / SCALE;
    expect(Math.abs(out[0]! - expectedX)).toBeLessThan(1e-6 * Math.abs(expectedX));
    const expectedY = (firstLocal.y - ORRERY.y) / SCALE;
    expect(Math.abs(out[1]! - expectedY)).toBeLessThan(1e-6 * Math.abs(expectedY));
    const expectedZ = (firstLocal.z - ORRERY.z) / SCALE;
    expect(Math.abs(out[2]! - expectedZ)).toBeLessThan(1e-6 * Math.abs(expectedZ));

    for (let index = 0; index < frame.count; index += 1) {
      const base = index * GALAXY_INSTANCE_FLOATS;
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Number.isFinite(out[base + channel]!)).toBe(true);
      }
      expect(out[base + 3]!).toBeGreaterThan(0);
      expect(out[base + 7]!).toBeGreaterThanOrEqual(0);
      expect(out[base + 7]!).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a minimum pixel footprint at every distance', () => {
    const focalPx = HEIGHT / (2 * Math.tan((50 * Math.PI) / 360));
    const counts = GALAXY_TIER_STARS.rich;
    const discStart = 1 + GALAXY_TIER_STARS.rich.local;
    const samples = [
      { index: 0, star: GALAXY.stars[1]! },
      { index: counts.local, star: GALAXY.stars[discStart]! },
      { index: counts.local + counts.disc - 1, star: GALAXY.stars[GALAXY.stars.length - 1]! },
    ];

    for (const camera of [ORRERY, orbitTo(0, PITCH, 1e18), GALAXY_CAMERA]) {
      const { out, frame } = frameAt('rich', camera);
      for (const sample of samples) {
        const base = sample.index * GALAXY_INSTANCE_FLOATS;
        const radius = out[base + 3]!;
        // The star's own camera-relative distance, not the camera's distance from home.
        const distance = Math.hypot(
          (sample.star.x - camera.x) / SCALE,
          (sample.star.y - camera.y) / SCALE,
          (sample.star.z - camera.z) / SCALE,
        );
        const px = (radius / distance) * focalPx;
        // 1080p is the footprint constants' reference height, so the scale is exactly 1 here.
        // The lower bound is the load-bearing one (a sub-pixel point disappears between samples);
        // the upper bound guards a runaway radius. Both read the constants, so tuning the look
        // does not leave a stale literal behind.
        expect(px, `instance ${sample.index} at ${frame.lod.toFixed(3)}`).toBeGreaterThanOrEqual(
          GALAXY_STAR_MIN_PX * 0.999,
        );
        expect(px, `instance ${sample.index} at ${frame.lod.toFixed(3)}`).toBeLessThanOrEqual(
          GALAXY_STAR_MAX_PX * 1.001,
        );
      }
    }
  });

  it('scales the footprint with the viewport, so 4K keeps 1080p density', () => {
    // A footprint fixed in device pixels would make a 4K frame four times sparser than 1080p at
    // the same camera. The height scale keeps the covered fraction constant: the world radius is
    // resolution-independent, so the *projected* size is what must double.
    const out = new Float32Array(GALAXY_MAX_INSTANCES * GALAXY_INSTANCE_FLOATS);
    const at1080 = writeGalaxyFrame(out, GALAXY, 'rich', GALAXY_CAMERA, SCALE, 1080, ASPECT);
    const radius = at1080.instances[3]!;
    const star = GALAXY.stars[1]!;
    const distance = Math.hypot(
      (star.x - GALAXY_CAMERA.x) / SCALE,
      (star.y - GALAXY_CAMERA.y) / SCALE,
      (star.z - GALAXY_CAMERA.z) / SCALE,
    );
    const focal = (height: number) => height / (2 * Math.tan((50 * Math.PI) / 360));
    expect(radius / distance).toBeGreaterThan(0);
    expect(((radius / distance) * focal(2160)) / ((radius / distance) * focal(1080))).toBeCloseTo(
      2,
      5,
    );
  });

  it('reveals every disc star once the crossfade is complete', () => {
    // The ramp's window closes at lod 1; a fixed-width smoothstep would leave the dimmest third
    // of the disc suppressed in the finished galaxy, which reads as stipple. The local field is
    // excluded here: it has converged into the home star and is faded out on purpose (below).
    const { out, frame } = frameAt('rich', GALAXY_CAMERA);
    expect(frame.lod).toBeGreaterThan(0.99);
    const local = GALAXY_TIER_STARS.rich.local;
    let dimmest = Infinity;
    for (let index = local; index < frame.count; index += 1) {
      dimmest = Math.min(dimmest, out[index * GALAXY_INSTANCE_FLOATS + 7]!);
    }
    expect(dimmest).toBeGreaterThan(0.99);
  });

  it('fades the local field once it has collapsed into the home star', () => {
    // 5k stars inside 100 ly project inside one pixel from 2.6 R away. At their full footprint
    // they stack into a hard-edged white disc *larger* than the home star's own glare, so the
    // galaxy pass must not draw them there: the orrery's star is the point that survives (D5).
    const local = GALAXY_TIER_STARS.rich.local;
    const far = frameAt('rich', GALAXY_CAMERA);
    let localSum = 0;
    for (let index = 0; index < local; index += 1) {
      localSum += far.out[index * GALAXY_INSTANCE_FLOATS + 7]!;
    }
    expect(localSum).toBe(0);
    // The disc block is untouched: the pile-up was the local field, not the galaxy.
    expect(far.out[(local + 10) * GALAXY_INSTANCE_FLOATS + 7]!).toBeGreaterThan(0.99);

    // Near the orrery the local field is visible at full strength: it is the real neighbourhood,
    // and the parallax it carries is the Layer 3 evidence that the sky is a volume.
    const near = frameAt('rich', ORRERY);
    let nearMax = 0;
    for (let index = 0; index < local; index += 1) {
      nearMax = Math.max(nearMax, near.out[index * GALAXY_INSTANCE_FLOATS + 7]!);
    }
    expect(nearMax).toBe(1);
  });

  it('cuts a tier from the tail, without re-rolling the field', () => {
    const rich = frameAt('rich', GALAXY_CAMERA);
    const low = frameAt('low', GALAXY_CAMERA);
    const richCounts = GALAXY_TIER_STARS.rich;
    const lowCounts = GALAXY_TIER_STARS.low;

    expect(low.frame.count).toBe(lowCounts.local + lowCounts.disc);
    expect(low.out.slice(0, lowCounts.local * GALAXY_INSTANCE_FLOATS)).toEqual(
      rich.out.slice(0, lowCounts.local * GALAXY_INSTANCE_FLOATS),
    );

    const richDisc = richCounts.local * GALAXY_INSTANCE_FLOATS;
    const lowDisc = lowCounts.local * GALAXY_INSTANCE_FLOATS;
    expect(
      low.out.slice(lowDisc, (lowCounts.local + lowCounts.disc) * GALAXY_INSTANCE_FLOATS),
    ).toEqual(rich.out.slice(richDisc, richDisc + lowCounts.disc * GALAXY_INSTANCE_FLOATS));
  });
});

describe('the arm contrast is measured from the population', () => {
  it('finds a two-arm modulation in the disc', () => {
    const modulation = armModulation(GALAXY);
    expect(modulation).toBeGreaterThan(0.02);
    expect(modulation).toBeLessThan(0.6);
  });

  it('normalises the reported contrast into 0..1', () => {
    for (const camera of [ORRERY, orbitTo(0, PITCH, 1e19), GALAXY_CAMERA]) {
      const legibility = galaxyLegibility(GALAXY, camera, HEIGHT);
      expect(legibility.lod).toBeGreaterThanOrEqual(0);
      expect(legibility.lod).toBeLessThanOrEqual(1);
      expect(legibility.contrast).toBeGreaterThanOrEqual(0);
      expect(legibility.contrast).toBeLessThanOrEqual(1);
    }
  });
});

describe('the frame-time watchdog', () => {
  it('drops one tier only after a sustained long frame', () => {
    expect(nextQualityTier('rich', 20, 600)).toBeNull();
    expect(nextQualityTier('rich', 45, 10)).toBeNull();
    expect(nextQualityTier('rich', 45, 60)).toBe('medium');
    expect(nextQualityTier('medium', 45, 60)).toBe('low');
    expect(nextQualityTier('low', 45, 60)).toBeNull();
  });

  it('reports the ulp of both precisions at a power of two', () => {
    expect(f64Ulp(1)).toBe(2 ** -52);
    expect(f32Ulp(1)).toBe(2 ** -23);
    expect(f64Ulp(Number.NaN)).toBe(0);
    expect(f32Ulp(0)).toBe(0);
  });
});