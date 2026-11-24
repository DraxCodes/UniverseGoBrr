import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import {
  GALACTIC_PLANE_TILT_RAD,
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
// The disc is inclined, so the gallery camera is inclined with it: the same view of the disc
// needs `pitch + tilt` after the generator's rotation about world x. Without it this camera looks
// along the plane and `lod` correctly collapses to ~0 — an edge-on disc has no arms to read.
// Measured both ways on the v4 population: `orbitTo(0, PITCH)` gives lod 0.016 (collapsed),
// `orbitTo(0, PITCH + tilt)` gives lod 1.000. So the tilt belongs in the camera, and this is not
// a workaround for the legibility test — `galaxyLegibility` reads the disc normal either way.
const GALLERY_PITCH = PITCH + GALACTIC_PLANE_TILT_RAD;
const GALAXY_CAMERA = orbitTo(0, GALLERY_PITCH, GALAXY_MAX_DISTANCE_M);

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

  it('labels the galaxy by scale, not by whether its arms are turned toward us', () => {
    // The disc is inclined, so a straight zoom-out from the default view (yaw 0, the orrery
    // pitch) is edge-on for its whole run: `lod` stays ~0.02 because the arms are not readable,
    // yet the whole galaxy fills the frame. The HUD's scene row keys off `identity`, which drops
    // `inclination` so it can still say "one galaxy" there.
    const far = frameAt('rich', orbitTo(0, PITCH, GALAXY_MAX_DISTANCE_M));
    expect(far.frame.lod).toBeLessThan(0.1);
    expect(far.frame.identity).toBeGreaterThan(0.9);
    // The orrery is inside the disc; there is no galaxy to name yet.
    expect(frameAt('rich', ORRERY).frame.identity).toBeLessThan(0.05);
    // Face-on, both signals agree.
    const faceOn = frameAt('rich', GALAXY_CAMERA);
    expect(faceOn.frame.identity).toBeGreaterThan(0.9);
    expect(faceOn.frame.lod).toBeGreaterThan(0.9);
  });

  it('never decreases as the wheel retreats from the system to the galaxy', () => {
    let previous = -1;
    const start = Math.log10(Math.hypot(ORRERY.x, ORRERY.y, ORRERY.z));
    const end = Math.log10(GALAXY_MAX_DISTANCE_M);
    for (let log = start; log <= end; log += 0.02) {
      const camera = orbitTo(0, GALLERY_PITCH, 10 ** log);
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
      const camera = orbitTo(0, GALLERY_PITCH, 10 ** log);
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

  it('packs brightness as real emission, so a dim star emits less than a bright one', () => {
    // The clipped nucleus (gate iteration 1, flaw 2) was not a tone-map problem: `fs_star`
    // multiplies colour by `color.a * gain`, and `color.a` is the reveal, which is 1.0 for every
    // star at full lod. So a brightness-0.02 nucleus star and a brightness-1 arm star emitted the
    // *same* light, 289 nucleus impostors summed to ~13 and clipped into a flat 109 px plateau,
    // and the disc read as a field of identical dots. Scaling the packed colour by brightness is
    // what makes `GalaxyStar.brightness` an amplitude at all. A per-star emission of zero would
    // also pass a naive "is it dark" check, so compare the ratio to the brightness ratio.
    const { out, frame } = frameAt('rich', GALAXY_CAMERA);
    const local = GALAXY_TIER_STARS.rich.local;
    let dimmest = Infinity;
    let dimmestEmission = Infinity;
    let brightestStar = 0;
    let brightestEmission = 0;
    for (let index = local; index < frame.count; index += 1) {
      const base = index * GALAXY_INSTANCE_FLOATS;
      // `pack` skips the home star (index 0), so packed instance `i` is `galaxy.stars[i + 1]`.
      const star = GALAXY.stars[index + 1]!;
      const emission =
        0.2126 * out[base + 4]! + 0.7152 * out[base + 5]! + 0.0722 * out[base + 6]!;
      if (star.brightness < dimmest) {
        dimmest = star.brightness;
        dimmestEmission = emission;
      }
      if (star.brightness > brightestStar) {
        brightestStar = star.brightness;
        brightestEmission = emission;
      }
    }
    expect(dimmestEmission).toBeGreaterThan(0);
    // Emission must track brightness monotonically. The colour ramp adds a small hue-dependent
    // factor, so require the dimmest star to emit well under the brightest, not an exact ratio.
    expect(dimmestEmission).toBeLessThan(brightestEmission * 0.5);
  });

  it('reveals every disc star once the crossfade is complete', () => {
    // The ramp's window closes at lod 1; a fixed-width smoothstep would leave the dimmest third
    // of the disc suppressed in the finished galaxy, which reads as stipple. The local field is
    // excluded here: it has converged into the home star and is faded out on purpose (below),
    // and so is the findability gap around home (asserted separately just below).
    const { out, frame } = frameAt('rich', GALAXY_CAMERA);
    expect(frame.lod).toBeGreaterThan(0.99);
    const local = GALAXY_TIER_STARS.rich.local;
    let dimmest = Infinity;
    let inGap = 0;
    for (let index = local; index < frame.count; index += 1) {
      const reveal = out[index * GALAXY_INSTANCE_FLOATS + 7]!;
      if (reveal <= 0.99) {
        inGap += 1;
        continue;
      }
      dimmest = Math.min(dimmest, reveal);
    }
    expect(dimmest).toBeGreaterThan(0.99);
    // The only suppressed disc stars are the ones inside the home star's clear gap, and that is
    // a small fraction of the field — not a brightness class. The bound is looser than the gap's
    // naive screen area (8 px radius is ~0.1% of the disc) because the gap is an *angle*: the
    // thin disc's far side puts many stars inside that cone. Measured 427/40 000 (1.07%).
    expect(inGap).toBeGreaterThan(0);
    expect(inGap / (frame.count - local)).toBeLessThan(0.02);
  });

  it('clears a gap around the home star so it is findable at 1:1', () => {
    // Gate iteration 1 (D5): the home star peaked at 0.56 against a field reaching 0.99 in the
    // same warm hue, with nothing to separate it. The gap is one of the three cues; it has to be
    // centred on home, a few pixels wide, and absent at the orrery where Layer 2 is untouched.
    const { out } = frameAt('rich', GALAXY_CAMERA);
    const local = GALAXY_TIER_STARS.rich.local;
    expect(out[local * GALAXY_INSTANCE_FLOATS + 7]).toBeGreaterThan(0.99);
    // At the orrery the galaxy is a band behind the system; no hole is carved in it.
    const near = frameAt('rich', ORRERY);
    let visible = 0;
    for (let index = local; index < near.frame.count; index += 1) {
      if (near.out[index * GALAXY_INSTANCE_FLOATS + 7]! > 0) visible += 1;
    }
    expect(visible).toBeGreaterThan(0);
  });

  it('never erases the galaxy at an intermediate crossfade', () => {
    // Regression: the gap's inner edge was derived from the constant `HOME_GAP_PX` while its outer
    // edge was `HOME_GAP_PX * lod`. Below `lod = HOME_GAP_INNER` the inner edge was larger than
    // the outer one, and `smoothstep` with inverted edges *inverts* instead of saturating: it kept
    // the ring and culled the rest, erasing the whole field. Reported as "the galaxy disappears at
    // some pitches" and "it vanishes between the galaxy and K-type while zooming in, then comes
    // back". Sweeping the distance through every partial-lod value is what catches it.
    //
    // The floor is *relative* to the brightest frame in the sweep: disc emission is nearly
    // independent of `lod` (the reveal threshold moves with it), so a collapse to a handful of
    // stars near home shows up as two orders of magnitude below the peak. An absolute threshold
    // would pass on those few surviving impostors, which is exactly the failure mode.
    const local = GALAXY_TIER_STARS.rich.local;
    const samples: { log: number; lod: number; emitted: number; lit: number }[] = [];
    for (let log = Math.log10(GALAXY_MAX_DISTANCE_M); log >= 19.5; log -= 0.05) {
      const camera = orbitTo(2.273020050191636, -0.75, 10 ** log);
      const { out, frame } = frameAt('rich', camera);
      let emitted = 0;
      let lit = 0;
      for (let index = local; index < frame.count; index += 1) {
        const base = index * GALAXY_INSTANCE_FLOATS;
        const reveal = out[base + 7]!;
        if (reveal > 0.01) lit += 1;
        emitted += (out[base + 4]! + out[base + 5]! + out[base + 6]!) * reveal;
      }
      samples.push({ log, lod: frame.lod, emitted, lit });
    }
    // The sweep must actually visit the partial-crossfade regime, or it proves nothing.
    const partial = samples.filter((s) => s.lod > 0.02 && s.lod < 0.95);
    expect(partial.length).toBeGreaterThan(3);
    const peak = Math.max(...samples.map((s) => s.emitted));
    for (const s of samples) {
      expect(
        s.emitted,
        `disc emission at 10^${s.log.toFixed(2)} m (lod ${s.lod.toFixed(3)}, ${s.lit} lit)`,
      ).toBeGreaterThan(peak * 0.3);
    }
  });

  it('keeps the galaxy lit across every pitch, including partial legibility', () => {
    // Same defect seen through the other control: pitch drives `inclination`/`fit`, so it walks
    // `lod` through the band where the inverted gap erased the field.
    const local = GALAXY_TIER_STARS.rich.local;
    const samples: { pitch: number; lod: number; emitted: number; lit: number }[] = [];
    for (let pitch = -1.4; pitch <= 1.4; pitch += 0.05) {
      const camera = orbitTo(2.273020050191636, pitch, GALAXY_MAX_DISTANCE_M);
      const { out, frame } = frameAt('rich', camera);
      let emitted = 0;
      let lit = 0;
      for (let index = local; index < frame.count; index += 1) {
        const base = index * GALAXY_INSTANCE_FLOATS;
        const reveal = out[base + 7]!;
        if (reveal > 0.01) lit += 1;
        emitted += (out[base + 4]! + out[base + 5]! + out[base + 6]!) * reveal;
      }
      samples.push({ pitch, lod: frame.lod, emitted, lit });
    }
    expect(samples.filter((s) => s.lod > 0.02 && s.lod < 0.95).length).toBeGreaterThan(3);
    const peak = Math.max(...samples.map((s) => s.emitted));
    for (const s of samples) {
      expect(
        s.emitted,
        `disc emission at pitch ${s.pitch.toFixed(2)} (lod ${s.lod.toFixed(3)}, ${s.lit} lit)`,
      ).toBeGreaterThan(peak * 0.3);
    }
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