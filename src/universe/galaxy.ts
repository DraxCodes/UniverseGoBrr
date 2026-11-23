/**
 * One galaxy, generated from `(seed, address)` and rendered nowhere in particular.
 *
 * Structure only, no GPU and no camera: the same address produces the same stars in any order,
 * on any machine (ADR-0005). Positions are **real metres relative to the home star**, so the
 * renderer can subtract the camera in doubles exactly as Layer 2 already does (ADR-0008).
 *
 * Two fields, because they answer two different questions:
 *
 * - the **local field** is the neighbourhood the camera can parallax against while still inside
 *   the system: a *sample* of a uniform density, not a census. At the spec's ~1 star / 5 ly a
 *   100 ly sphere holds ~800k stars; the renderer's budget is a few thousand, so the sample
 *   preserves the *scale* of nearest neighbours (r ∝ u^⅓) and says so rather than pretending to
 *   be complete;
 * - the **disc field** is the galaxy read as a shape: a bulge, a truncated exponential disc and
 *   two log-spiral arms as **density modulation**. The arm is where the generator puts more
 *   stars; no curve is ever drawn.
 *
 * Counts are compile-time constants per quality tier and never depend on the seed, the address
 * or the URL. A crafted link must not be able to ask for a billion stars.
 */

import { fnv1a32 } from '../lib/hash';
import { createRng, type Rng } from '../lib/random';
import { formatAddress, type Address } from '../frame/address';
import { GALAXY_RADIUS_M } from '../render/scale';

/** Bumped whenever the generator's output would change; old links break loudly (ADR-0005). */
export const GALAXY_VERSION = 2;

/** One light-year, metres (IAU). */
export const LY_M = 9.460_730_472_580_8e15;

export type GalaxyTier = 'rich' | 'medium' | 'low';

/** The renderer's star budget. Each tier is a prefix of the richer stream. */
export const GALAXY_TIER_STARS: Readonly<Record<GalaxyTier, { local: number; disc: number }>> =
  Object.freeze({
    rich: Object.freeze({ local: 5000, disc: 40000 }),
    medium: Object.freeze({ local: 2500, disc: 20000 }),
    low: Object.freeze({ local: 1600, disc: 12000 }),
  });

/** The local field's radius: far enough to parallax, small enough to stay inside the galaxy. */
export const LOCAL_RADIUS_M = 100 * LY_M;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GalaxyStar {
  /** Real metres, relative to the home star (the frame origin). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 0..1, heavy-tailed: most stars dim, a few bright. */
  readonly brightness: number;
  /** Linear RGB, dim stars warm, bright stars white-blue. */
  readonly color: readonly [number, number, number];
  /** Impostor size multiplier; the renderer owns the pixel footprint. */
  readonly size: number;
  /** True for the home system's own star, so the crossfade can give it identity. */
  readonly home: boolean;
}

export interface Galaxy {
  readonly version: number;
  readonly tier: GalaxyTier;
  /** Galactic centre, relative to the home star, metres. */
  readonly centre: Vec3;
  readonly stars: readonly GalaxyStar[];
}

/** Where the home star sits in the disc, as a fraction of the radius. */
const HOME_RADIUS_FRACTION = 0.55;
/** Disc scale length, as a fraction of the radius: an exponential disc falls off here. */
const DISC_SCALE_LENGTH_FRACTION = 0.36;
/** Two arms; the log-spiral pitch is this many radians of winding per scale length. */
const ARM_WINDING = 2.4;
/** Fraction of the disc budget in the bulge. */
const BULGE_FRACTION = 0.06;
/** Bulge radius, as a fraction of the radius: a compact nucleus, not a wash over the inner arms. */
const BULGE_RADIUS_FRACTION = 0.11;
/**
 * Bulge stars are drawn dimmer than disc stars. They are a dense 3D cluster, so the same
 * brightness stacks into an additive white blob that swallows the inner arms; the nucleus still
 * reads as the brightest part of the galaxy, but as a core rather than a clipped hole.
 */
const BULGE_BRIGHTNESS = 0.55;
/** Disc thickness, as a fraction of the radius. */
const DISC_THICKNESS_FRACTION = 0.025;
/** Fraction of the disc that is always inter-arm, so the gaps do not close. */
const INTER_ARM_FRACTION = 0.08;
/**
 * The arm's minimum acceptance. A rejected draw is re-aimed (not kept), so this is the
 * acceptance floor at the arm's edge; it keeps the arm soft rather than a drawn filament. It is
 * deliberately low: the *density* ratio is what makes the arm read at 45k impostors, and a high
 * floor fills the gap with haze until the wave measures flat (the oval failure).
 */
const ARM_FLOOR = 0.05;
/**
 * Bound on the rejection loop. Re-aiming a rejected star uniformly (the first implementation)
 * deposited ~60% of the disc as haze, which flattened the m=2 wave into an oval and made the
 * arms unreadable at the render budget. Rejection-sampling *into* the arm keeps the population
 * on the arms; the loop is bounded so a pathological seed cannot spin.
 */
const ARM_ATTEMPTS = 40;

export function generateGalaxy(seed: string, address: Address, tier: GalaxyTier): Galaxy {
  const counts = GALAXY_TIER_STARS[tier];
  // The tier is deliberately not in the keys: each field draws its own stream and keeps a
  // prefix when the count falls, so a quality drop does not re-roll the galaxy.
  const key = `${seed}|${formatAddress(address)}|galaxy|v${GALAXY_VERSION}`;
  const frameRng = createRng(fnv1a32(`${key}|frame`));
  const localRng = createRng(fnv1a32(`${key}|local`));
  const discRng = createRng(fnv1a32(`${key}|disc`));

  const radius = GALAXY_RADIUS_M;
  const homeAngle = frameRng.range(0, Math.PI * 2);
  const homeRadius = HOME_RADIUS_FRACTION * radius;
  const homeHeight = frameRng.range(-0.02, 0.02) * radius;
  const firstArm = frameRng.range(0, Math.PI * 2);
  const armOffsets: readonly number[] = [firstArm, firstArm + Math.PI];

  const centre: Vec3 = {
    x: -Math.cos(homeAngle) * homeRadius,
    y: -homeHeight,
    z: -Math.sin(homeAngle) * homeRadius,
  };

  const stars: GalaxyStar[] = [
    // The home star is a real member of the population and is marked so it can keep identity
    // through the crossfade (issue 04 D5). It is what the camera orbits at system scale.
    { x: 0, y: 0, z: 0, brightness: 1, color: [1, 0.96, 0.9], size: 1.6, home: true },
  ];

  // --- Local field: a sample of a uniform density, not a census. ---------------------------
  for (let index = 0; index < counts.local; index += 1) {
    // r ∝ u^(1/3) is the radial law of a uniform 3D density; it keeps the nearest-neighbour
    // scale honest for the budget instead of painting a shell.
    const r = LOCAL_RADIUS_M * Math.cbrt(localRng.next());
    const cosPolar = localRng.range(-1, 1);
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    const azimuth = localRng.range(0, Math.PI * 2);
    const brightness = starBrightness(localRng);
    stars.push({
      x: r * sinPolar * Math.cos(azimuth),
      y: r * cosPolar,
      z: r * sinPolar * Math.sin(azimuth),
      brightness,
      color: starColor(brightness, localRng),
      size: 0.55 + brightness * 1.10,
      home: false,
    });
  }

  // --- Disc field: bulge + exponential disc + two log-spiral arms as density ----------------
  const discCount = counts.disc;
  for (let index = 0; index < discCount; index += 1) {
    // Drawn per star, not from the index: the tier counts must keep a prefix of one stream.
    const inBulge = discRng.chance(BULGE_FRACTION);
    let x: number;
    let y: number;
    let z: number;

    if (inBulge) {
      // A flattened spheroid: radius ∝ u^(1/3) keeps it solid, not a shell.
      const r = BULGE_RADIUS_FRACTION * radius * Math.cbrt(discRng.next());
      const cosPolar = discRng.range(-1, 1);
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      const azimuth = discRng.range(0, Math.PI * 2);
      x = r * sinPolar * Math.cos(azimuth);
      y = r * cosPolar * 0.62;
      z = r * sinPolar * Math.sin(azimuth);
    } else {
      // Truncated exponential disc: r = -scale·ln(1-u), rejected beyond the radius.
      const scale = DISC_SCALE_LENGTH_FRACTION * radius;
      let r = 0;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        r = -scale * Math.log(1 - discRng.next() * 0.999_999);
        if (r <= radius) break;
      }
      const azimuth = discRng.range(0, Math.PI * 2);
      // Density modulation, not a drawn curve: most stars are rejection-sampled onto the arm,
      // and a fixed fraction is placed uniformly so the inter-arm gaps stay populated.
      let finalAngle: number;
      if (discRng.chance(INTER_ARM_FRACTION)) {
        finalAngle = discRng.range(0, Math.PI * 2);
      } else {
        finalAngle = azimuth;
        for (let attempt = 0; attempt < ARM_ATTEMPTS; attempt += 1) {
          const arm = armStrength(r, finalAngle, scale, armOffsets);
          if (discRng.next() <= ARM_FLOOR + (1 - ARM_FLOOR) * arm) break;
          finalAngle = discRng.range(0, Math.PI * 2);
        }
      }
      x = r * Math.cos(finalAngle);
      z = r * Math.sin(finalAngle);
      y = gaussian(discRng) * DISC_THICKNESS_FRACTION * radius;
    }

    // Keep the disc field out of the local field's sphere, or the same neighbourhood is drawn
    // twice with different statistics. Relative to the **home star**, not the galactic centre:
    // pushing the centre-relative vector would move the star toward the bulge instead.
    let homeX = x + centre.x;
    let homeY = y + centre.y;
    let homeZ = z + centre.z;
    const homeDistance = Math.hypot(homeX, homeY, homeZ);
    const exclusion = LOCAL_RADIUS_M * 1.2;
    if (homeDistance < exclusion) {
      const factor = exclusion / Math.max(homeDistance, 1e-9);
      homeX *= factor;
      homeY *= factor;
      homeZ *= factor;
    }

    const brightness = inBulge
      ? starBrightness(discRng) * BULGE_BRIGHTNESS
      : starBrightness(discRng);
    stars.push({
      x: homeX,
      y: homeY,
      z: homeZ,
      brightness,
      color: starColor(brightness, discRng),
      size: 0.55 + brightness * 1.10,
      home: false,
    });
  }

  return { version: GALAXY_VERSION, tier, centre, stars };
}

/** A log-spiral arm's density at `r`, in 0..1, as the max over the two arms. */
function armStrength(r: number, azimuth: number, scale: number, offsets: readonly number[]): number {
  const winding = (r / scale) * ARM_WINDING;
  let best = 0;
  for (const offset of offsets) {
    // cos² gives a positive, smooth arm width and a genuine inter-arm gap.
    const delta = Math.cos(azimuth - offset - winding);
    best = Math.max(best, delta * delta);
  }
  return best;
}

/** Heavy-tailed: most stars dim, a few bright. Never zero, or the field disappears. */
function starBrightness(rng: Rng): number {
  const u = rng.next();
  return 0.10 + 0.90 * u * u * u;
}

/** Brightness → tint: dim stars orange, mid white, bright blue-white. */
function starColor(brightness: number, rng: Rng): readonly [number, number, number] {
  const jitter = rng.range(-0.04, 0.04);
  // A small hue jitter keeps the field from looking like three flat classes.
  const t = Math.min(1, Math.max(0, brightness));
  return [
    Math.min(1, 1.0 + jitter),
    0.62 + 0.34 * t + jitter,
    0.38 + 0.58 * t + jitter,
  ] as const;
}

/** Box–Muller, one sample; enough for a disc's thickness. */
function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}