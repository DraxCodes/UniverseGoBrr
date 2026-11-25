import { describe, expect, it } from 'vitest';
import { parseAddress } from '../frame/address';
import {
  GALAXY_TIER_STARS,
  GALAXY_VERSION,
  LOCAL_RADIUS_M,
  galaxyAddressOf,
  generateGalaxy,
  toDiscFrame,
} from './galaxy';
import { armStrength, ARM_SWEEP_MAX_RAD, ARM_SWEEP_MIN_RAD, galaxyFrame } from './disc';

const SEED = 'ugb-0000';

function address(text: string) {
  const parsed = parseAddress(text);
  if (!parsed.address) throw new Error(parsed.issue ?? 'bad address');
  return parsed.address;
}

const HOME = address('v1/4.-2.7');

describe('the galaxy is a pure function of (seed, address)', () => {
  it('produces identical stars for identical inputs', () => {
    const a = generateGalaxy(SEED, HOME, 'low');
    const b = generateGalaxy(SEED, HOME, 'low');
    expect(a.version).toBe(GALAXY_VERSION);
    expect(a.stars).toEqual(b.stars);
    expect(a.centre).toEqual(b.centre);
  });

  it('produces a different galaxy for a different galaxy', () => {
    const a = generateGalaxy(SEED, HOME, 'low');
    const b = generateGalaxy(SEED, address('v1/5.-2.7'), 'low');
    // The centre is seeded, so it is the cheapest stable discriminator.
    expect(a.centre).not.toEqual(b.centre);
  });

  it('keeps a tier as a prefix of the address order, field by field', () => {
    const rich = generateGalaxy(SEED, HOME, 'rich');
    const low = generateGalaxy(SEED, HOME, 'low');
    const richLocal = 1 + GALAXY_TIER_STARS.rich.local;
    const lowLocal = 1 + GALAXY_TIER_STARS.low.local;
    expect(low.stars.length).toBeLessThan(rich.stars.length);
    // The walk is ordered by child level, so a lower tier keeps the first N addresses of each
    // field verbatim — the same star, the same place, the same light — not a re-draw.
    expect(low.stars.slice(1, lowLocal)).toEqual(rich.stars.slice(1, lowLocal));
    expect(low.stars.slice(lowLocal)).toEqual(
      rich.stars.slice(richLocal, richLocal + GALAXY_TIER_STARS.low.disc),
    );
  });

  it('gives every star the address that produced it', () => {
    // The half of ADR-0011 that was missing: a drawn light carries an address, so "that star
    // there" can be linked to and travelled to rather than only seen. Since ADR-0023 that address
    // is `galaxy.sector.star` — two levels below the galaxy, not one.
    const galaxy = generateGalaxy(SEED, HOME, 'low');
    const galaxyAddress = galaxyAddressOf(HOME);
    for (const star of galaxy.stars.slice(1)) {
      expect(galaxyAddressOf(star.address), JSON.stringify(star.address)).toEqual(galaxyAddress);
      expect(star.address.levels.length).toBe(galaxyAddress.levels.length + 2);
    }
  });

  // The sector half of this — which sector a star is filed under, and that sector 0 is always the
  // home star — lives in `sector-rung.test.ts`, next to the key-stripping it depends on.

  it('uses compile-time counts independent of the address', () => {
    const a = generateGalaxy(SEED, HOME, 'rich');
    const b = generateGalaxy(SEED, address('v1/9.9.-9'), 'rich');
    const counts = GALAXY_TIER_STARS.rich;
    expect(a.stars.length).toBe(1 + counts.local + counts.disc);
    expect(b.stars.length).toBe(a.stars.length);
  });

  it('treats the root as having no galaxy, and terminates', () => {
    // Regression: the root is shallower than a galaxy, so its children have no kind to read.
    // Before the guard every root child classified as local, the disc list never filled, and a
    // crafted `?addr=v1/` (or an ordinary zoom-out to the top) hung the tab forever.
    const galaxy = generateGalaxy(SEED, address('v1/'), 'low');
    expect(galaxy.stars).toHaveLength(1);
    expect(galaxy.stars[0]).toMatchObject({ home: true, x: 0, y: 0, z: 0 });
    expect(galaxy.centre).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('a galaxy is identified by its own level, not by where you stand', () => {
  /**
   * This is the bug the placement decision exposed: the generator used to key on the full
   * address, so every address was the centre of a private galaxy. Warp one star over, look
   * back, and the arms had been redrawn. ADR-0011 fixes the identity at the galaxy's own level.
   */

  it('returns one galaxy for every address inside it, at any depth', () => {
    const galaxy = generateGalaxy(SEED, address('v1/4'), 'low');
    for (const inside of ['v1/4.-2.7', 'v1/4.-2.8', 'v1/4.0', 'v1/4.-2.7.1', 'v1/4.9.9.9.9']) {
      const star = generateGalaxy(SEED, address(inside), 'low');
      expect(star.stars, inside).toEqual(galaxy.stars);
      expect(star.centre, inside).toEqual(galaxy.centre);
    }
  });

  it('still separates two galaxies', () => {
    const a = generateGalaxy(SEED, address('v1/4.-2.7'), 'low');
    const b = generateGalaxy(SEED, address('v1/5.-2.7'), 'low');
    expect(a.centre).not.toEqual(b.centre);
  });

  it('reports the level it keyed on, so a caller can ask rather than guess', () => {
    expect(galaxyAddressOf(address('v1/4.-2.7.1'))).toEqual(address('v1/4'));
    expect(galaxyAddressOf(address('v1/4'))).toEqual(address('v1/4'));
    // The root is shallower than a galaxy; it is returned unchanged rather than rejected, so an
    // address that is already that big still has an answer.
    expect(galaxyAddressOf(address('v1/')).levels).toEqual([]);
  });
});

describe('the population has the right shape', () => {
  const galaxy = generateGalaxy(SEED, HOME, 'rich');
  const firstLocal = galaxy.stars[1];
  const localCount = GALAXY_TIER_STARS.rich.local;
  const local = galaxy.stars.slice(1, 1 + localCount);
  const disc = galaxy.stars.slice(1 + localCount);

  it('has exactly one home star, at the origin, with its own colour', () => {
    const homes = galaxy.stars.filter((star) => star.home);
    expect(homes).toHaveLength(1);
    expect(homes[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(firstLocal?.home).toBe(false);
  });

  it('keeps the local field inside its radius and off a shell', () => {
    const distances = local.map((star) => Math.hypot(star.x, star.y, star.z));
    expect(Math.max(...distances)).toBeLessThanOrEqual(LOCAL_RADIUS_M * (1 + 1e-9));
    const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    // Uniform 3D density puts the mean at 3/4 of the radius; a shell would sit at 1.
    expect(mean).toBeGreaterThan(0.6 * LOCAL_RADIUS_M);
    expect(mean).toBeLessThan(0.85 * LOCAL_RADIUS_M);
  });

  it('keeps the disc inside the galaxy, relative to the centre', () => {
    let farthest = 0;
    for (const star of disc) {
      const distance = Math.hypot(
        star.x - galaxy.centre.x,
        star.y - galaxy.centre.y,
        star.z - galaxy.centre.z,
      );
      farthest = Math.max(farthest, distance);
    }
    // The local-field exclusion pushes a handful outwards; the bound stays near the disc edge.
    // It is *this* galaxy's radius now — the size is drawn, so a global constant would pass for
    // one galaxy and fail for every other.
    expect(farthest).toBeLessThanOrEqual(galaxy.radius * 1.1);
  });

  it('never emits NaN, a zero brightness, or an out-of-range colour', () => {
    for (const star of galaxy.stars) {
      for (const value of [star.x, star.y, star.z, star.brightness, star.size]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(star.brightness).toBeGreaterThan(0);
      expect(star.brightness).toBeLessThanOrEqual(1);
      expect(star.size).toBeGreaterThan(0);
      for (const channel of star.color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sits the home star inside the disc, not at its centre', () => {
    const distance = Math.hypot(galaxy.centre.x, galaxy.centre.y, galaxy.centre.z);
    expect(distance).toBeGreaterThan(galaxy.radius * 0.4);
    expect(distance).toBeLessThan(galaxy.radius * 0.7);
  });

  it('stays under the floor budget', () => {
    const counts = GALAXY_TIER_STARS.rich;
    expect(counts.local + counts.disc).toBeLessThanOrEqual(60_000);
  });

  it('puts the disc on a readable spiral at its own arm count', () => {
    // The arm wave is measured per radial slice at the galaxy's **own** harmonic: the spiral's
    // phase moves with radius, so one DFT over the whole disc would cancel its own arms. This is
    // the acceptance the renderer's crossfade depends on, and it is measured at `m = armCount`
    // because a four-armed galaxy measures near zero at m=2 (its own two-and-two beat).
    const bins = 20;
    const m = galaxy.shape.armCount;
    const inner = 0.2 * galaxy.radius;
    const outer = 1.0 * galaxy.radius;
    const cosine = new Float64Array(bins);
    const sine = new Float64Array(bins);
    const counts = new Float64Array(bins);
    for (const star of disc) {
      // Measured in the disc's own frame: the plane is inclined to the orrery's, so world `x`/`z`
      // would see an ellipse and smear the wave.
      const { x, z } = toDiscFrame(galaxy, star);
      const radius = Math.hypot(x, z);
      if (radius < inner || radius > outer) continue;
      const bin = Math.min(bins - 1, Math.floor(((radius - inner) / (outer - inner)) * bins));
      const azimuth = Math.atan2(z, x);
      cosine[bin]! += Math.cos(m * azimuth);
      sine[bin]! += Math.sin(m * azimuth);
      counts[bin]! += 1;
    }

    let weighted = 0;
    let total = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const n = counts[bin]!;
      if (n === 0) continue;
      weighted += (Math.hypot(cosine[bin]!, sine[bin]!) / n) * n;
      total += n;
    }
    // The bar stays at 0.25: it is the "reads as arms, not as an oval" threshold, not a record of
    // one roll. The normaliser and the harmonic both follow the galaxy now, so this is comparable
    // across arm counts instead of only valid at m=2.
    expect(weighted / total).toBeGreaterThan(0.25);

    // And the arms are not filaments over black: the uniform inter-arm fraction keeps a visible
    // floor, so the gaps do not close. Measured in one thin radial slice, because a thick annulus
    // averages the spiral's own phase change back into a uniform ring.
    const binsAzimuth = 36;
    const slice = disc.filter((star) => {
      const { x, z } = toDiscFrame(galaxy, star);
      const radius = Math.hypot(x, z);
      return radius > 0.47 * galaxy.radius && radius < 0.53 * galaxy.radius;
    });
    const cells = new Float64Array(binsAzimuth);
    for (const star of slice) {
      const { x, z } = toDiscFrame(galaxy, star);
      const azimuth = Math.atan2(z, x);
      cells[Math.floor(((azimuth + Math.PI) / (2 * Math.PI)) * binsAzimuth)]! += 1;
    }
    const sorted = [...cells].sort((a, b) => a - b);
    const trough = sorted[Math.floor(binsAzimuth * 0.05)]!;
    const crest = sorted[Math.floor(binsAzimuth * 0.95)]!;
    // A 3:1 density ratio leaves the trough at ~20% of the mean; a floor that never empties
    // keeps the disc a disc rather than drawn curves. Loosened from 0.1 to 0.05 because a
    // four-armed slice at this radius is sparser in every cell, and the source of truth for "not
    // filaments" is the ratio below, which stays strict.
    expect(trough).toBeGreaterThan((slice.length / binsAzimuth) * 0.05);
    expect(crest / trough).toBeGreaterThan(2.5);
  });

  it('weights luminosity toward arms and keeps the core warm', () => {
    const frame = galaxyFrame(SEED, galaxyAddressOf(HOME));
    const scale = frame.shape.scaleLengthFraction * galaxy.radius;
    let armSum = 0;
    let armCount = 0;
    let laneSum = 0;
    let laneCount = 0;
    let coreR = 0;
    let coreG = 0;
    let coreB = 0;
    let coreCount = 0;

    for (const star of disc) {
      const { x, z } = toDiscFrame(galaxy, star);
      const r = Math.hypot(x, z);
      if (r < 0.12 * galaxy.radius) {
        coreR += star.color[0];
        coreG += star.color[1];
        coreB += star.color[2];
        coreCount += 1;
      } else if (r > 0.25 * galaxy.radius) {
        const strength = armStrength(r, Math.atan2(z, x), scale, frame.armOffsets, frame.shape.winding);
        if (strength > 0.8) {
          armSum += star.brightness;
          armCount += 1;
        } else if (strength < 0.2) {
          laneSum += star.brightness;
          laneCount += 1;
        }
      }
    }

    expect(coreCount).toBeGreaterThan(0);
    expect(coreR / coreCount).toBeGreaterThan(coreG / coreCount);
    expect(coreG / coreCount).toBeGreaterThan(coreB / coreCount);
    expect(armCount).toBeGreaterThan(0);
    expect(laneCount).toBeGreaterThan(0);
    expect(armSum / armCount).toBeGreaterThan((laneSum / laneCount) * 1.5);
  });

  it('draws a real spiral at every arm count and pitch, not a pinwheel of spokes', () => {
    // **This is the shape law's acceptance test, and it exists because the first cut of the law
    // shipped spokes.** `winding` (radians per scale length) and `scaleLengthFraction` were drawn
    // independently, and their *ratio* — the arm's total turn from centre to rim — is what makes a
    // spiral. Drawn freely, that turn ranged 217°..561° across twelve galaxies; at the loose end
    // the swoop through the nucleus is shallow enough that the lanes between arms read as radial
    // wedges and the galaxy looks like a dark pinwheel (measured ridge/trough 1.3, i.e. no arms).
    // The law now draws the sweep and derives the pitch, so this asserts the invariant directly
    // rather than trusting whichever roll happens to be in `HOME`.
    //
    // The check is the harmonic amplitude at the galaxy's *own* arm count, because a four-armed
    // galaxy measures near zero at m=2. It is a per-slice measurement for the same reason the
    // spiral test above is: the phase moves with radius.
    const armCounts = new Set<number>();
    for (let galaxyIndex = 0; galaxyIndex < 12; galaxyIndex += 1) {
      const seed = `ugb-${String(galaxyIndex).padStart(4, '0')}`;
      const candidate = address(`v1/${galaxyIndex}`);
      const frame = galaxyFrame(seed, galaxyAddressOf(candidate));
      const built = generateGalaxy(seed, galaxyAddressOf(candidate), 'rich');
      const localEnd = 1 + GALAXY_TIER_STARS.rich.local;
      const stars = built.stars.slice(localEnd);
      const m = frame.shape.armCount;
      armCounts.add(m);

      // Sweep is what the law draws, and it is bounded. This is the failing assertion if anyone
      // re-introduces a free `winding` draw: the product would drift outside the range again.
      expect(frame.shape.armSweepRad).toBeGreaterThanOrEqual(ARM_SWEEP_MIN_RAD);
      expect(frame.shape.armSweepRad).toBeLessThanOrEqual(ARM_SWEEP_MAX_RAD);
      expect(frame.shape.winding).toBeCloseTo(frame.shape.armSweepRad * frame.shape.scaleLengthFraction, 12);

      // And the drawn field actually has arms at that count. A fixed floor per galaxy: the loose
      // end of the sweep still measures ~0.30, the tight end ~0.45, so 0.25 is the spoke boundary
      // this test is about (the old failing galaxies measured ~0.02-0.11).
      const bins = 16;
      const inner = 0.25 * frame.radius;
      const outer = 0.95 * frame.radius;
      const cosine = new Float64Array(bins);
      const sine = new Float64Array(bins);
      const counts = new Float64Array(bins);
      for (const star of stars) {
        const { x, z } = toDiscFrame(built, star);
        const radius = Math.hypot(x, z);
        if (radius < inner || radius > outer) continue;
        const bin = Math.min(bins - 1, Math.floor(((radius - inner) / (outer - inner)) * bins));
        const azimuth = Math.atan2(z, x);
        cosine[bin]! += Math.cos(m * azimuth);
        sine[bin]! += Math.sin(m * azimuth);
        counts[bin]! += 1;
      }
      let weighted = 0;
      let total = 0;
      for (let bin = 0; bin < bins; bin += 1) {
        const n = counts[bin]!;
        if (n === 0) continue;
        weighted += Math.hypot(cosine[bin]!, sine[bin]!);
        total += n;
      }
      expect(weighted / total, `galaxy v1/${galaxyIndex} (arms=${m}) has no arm wave`).toBeGreaterThan(0.25);
    }

    // The law actually varies the axis it claims to vary.
    expect(armCounts.size).toBeGreaterThan(1);
  });
});