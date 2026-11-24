/**
 * One galaxy, generated from `(seed, galaxy address)` and rendered nowhere in particular.
 *
 * Structure only, no GPU and no camera: the same address produces the same stars in any order,
 * on any machine (ADR-0005). Positions are **real metres relative to the home star**, so the
 * renderer can subtract the camera in doubles exactly as Layer 2 already does (ADR-0008).
 *
 * **A galaxy is identified by its own level, not by the address you are standing at**
 * (ADR-0011). Every address inside one galaxy resolves to the same galaxy, so walking to a
 * neighbouring star and looking back shows the sky you left. Keying the generator on the full
 * address instead — which this did until the placement decision — meant every address was the
 * centre of a private galaxy: warp one star over and the arms were redrawn. `GALAXY_DEPTH` and
 * `galaxyAddressOf` are that rule, enforced here rather than at the call sites so a new caller
 * cannot reintroduce the bug.
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
import { ancestorAddress, type Address } from '../frame/address';
import {
  GALACTIC_PLANE_TILT_RAD,
  LOCAL_RADIUS_M,
  galaxyFrame,
  rotateAboutX,
  sampleDiscStar,
  type Vec3,
} from './disc';

// The disc law moved to `disc.ts` when placement arrived (ADR-0011): the generator and
// `placement(seed, address)` must lay stars out with the *same* function, or the picture and the
// world drift. These exports stay here because they are part of the galaxy's public shape —
// `galaxy-scene.ts` measures against the plane normal and the tests read the tilt, the local
// radius and the stream version.
export {
  GALACTIC_PLANE_NORMAL,
  GALACTIC_PLANE_TILT_RAD,
  GALAXY_STREAM_VERSION,
  LOCAL_RADIUS_M,
  LY_M,
} from './disc';
export type { Vec3 } from './disc';

/**
 * Bumped whenever the generator's output would change; old links break loudly (ADR-0005).
 *
 * 4 → 5: a galaxy is now keyed by its own level instead of the full address (ADR-0011). A link
 * whose address is one level deep (`v1/0`, the capture default) is unchanged, because it *was*
 * already naming its galaxy. Every deeper link — including Sol at `v1/0.0.0` — now shows the
 * galaxy it lives in rather than a private one, which is a different sky.
 */
export const GALAXY_VERSION = 5;

/**
 * The level at which a galaxy is identified: the address's outermost level.
 *
 * **A shortcut, and it says so.** ADR-0008 keeps a level's *kind* out of the address — it comes
 * from the generator at that depth, not from the string — so in principle "which galaxy am I in"
 * is a walk up the levels until one answers "galaxy". That walk needs the per-depth kinds the
 * address HUD is going to introduce. Until it exists, one fixed depth is the honest stand-in:
 * it is the only depth the app currently names (`v1/0` in the capture manifest), and it is the
 * depth Sol sits one level below (`v1/0.0.0`).
 *
 * The day levels carry kinds, this constant becomes the walk and nothing else changes: callers
 * ask `galaxyAddressOf`, not the depth.
 */
export const GALAXY_DEPTH = 1;

/**
 * The address a galaxy is keyed by: the ancestor of `address` at `GALAXY_DEPTH`.
 *
 * Two addresses inside one galaxy return the same value, which is the whole point — see the
 * module comment. An address that is already that shallow is returned unchanged.
 */
export function galaxyAddressOf(address: Address): Address {
  return ancestorAddress(address, GALAXY_DEPTH);
}

export type GalaxyTier = 'rich' | 'medium' | 'low';

/** The renderer's star budget. Each tier is a prefix of the richer stream. */
export const GALAXY_TIER_STARS: Readonly<Record<GalaxyTier, { local: number; disc: number }>> =
  Object.freeze({
    rich: Object.freeze({ local: 5000, disc: 40000 }),
    medium: Object.freeze({ local: 2500, disc: 20000 }),
    low: Object.freeze({ local: 1600, disc: 12000 }),
  });

/**
 * A world position expressed in the disc's own frame, measured from the galactic centre: `x`/`z`
 * span the plane and `y` is height above it.
 *
 * The disc is inclined relative to the orrery's orbital plane, so its *shape* — radius, azimuth,
 * arm winding — only exists in this frame. Measuring it in world `x`/`z` would read the tilted
 * disc as an ellipse and smear the m=2 arm signal the renderer's crossfade depends on.
 */
export function toDiscFrame(galaxy: Galaxy, point: Vec3): Vec3 {
  return rotateAboutX(
    {
      x: point.x - galaxy.centre.x,
      y: point.y - galaxy.centre.y,
      z: point.z - galaxy.centre.z,
    },
    -GALACTIC_PLANE_TILT_RAD,
  );
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

/**
 * Bulge stars are drawn dimmer than disc stars. They are a dense 3D cluster, so the same
 * brightness stacks into an additive white blob that swallows the inner arms; the nucleus still
 * reads as the brightest part of the galaxy, but as a core rather than a clipped hole.
 */
const BULGE_BRIGHTNESS = 0.20;
/**
 * How much a star's brightness is scaled by its distance from the galactic centre, so the
 * nucleus has a gradient instead of a plateau. 1 at and beyond `NUCLEUS_FALLOFF_RADIUS`, and
 * `NUCLEUS_FLOOR` at the centre; the inner disc and bulge overlap hardest, so that is where the
 * compression has to live. The floor is not zero: an empty core would read as a hole.
 *
 * Calibrated against the capture, not by taste: at 0.58/0.30 the frame still carried 11 859 px at
 * exactly 1.00 with a 514x216 flat bounding box. Additive accumulation has no shoulder, so the
 * only lever is per-star intensity, and it has to be steep where the overlap is.
 *
 * These two only *work* because `galaxy-scene.ts` now folds each star's brightness into its
 * packed colour, so brightness is real emission amplitude. Before that, the renderer ignored
 * brightness at full legibility and these constants changed nothing (the nucleus stayed a
 * 109 px white plateau at 289 impostors/px).
 */
const NUCLEUS_FLOOR = 0.22;
const NUCLEUS_FALLOFF_RADIUS = 0.26;
/**
 * How far the arm/lane hue split goes. Arm stars are pushed cool and lane stars warm at no pixel
 * cost — the hue is uploaded per impostor already. This is the reference's third claim
 * (hue separates arm from inter-arm) taken as a principle, not as its magenta/blue palette.
 */
const ARM_HUE_SHIFT = 0.16;

export function generateGalaxy(seed: string, address: Address, tier: GalaxyTier): Galaxy {
  const counts = GALAXY_TIER_STARS[tier];
  // The tier is deliberately not in the keys: each field draws its own stream and keeps a
  // prefix when the count falls, so a quality drop does not re-roll the galaxy.
  //
  // The address is normalised to its galaxy's own level here, not at the call sites: two stars in
  // one galaxy must return the same array from this function, and a caller that passes a deeply
  // nested address must not be able to get a private galaxy out of it (ADR-0011).
  //
  // The frame and the disc law now come from `disc.ts`, shared with `placement(seed, address)`.
  // This function owns the *population*: which stars are drawn, how bright they are, what colour.
  const frame = galaxyFrame(seed, galaxyAddressOf(address));
  const { key, centre, radius } = frame;
  const localRng = createRng(fnv1a32(`${key}|local`));
  const discRng = createRng(fnv1a32(`${key}|disc`));

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
  // `sampleDiscStar` is the law, not a convenience: placement calls the same function with a
  // stream keyed on the address, which is what makes a placed star land on the drawn arms.
  for (let index = 0; index < counts.disc; index += 1) {
    const sample = sampleDiscStar(discRng, frame);
    const brightness =
      (sample.inBulge ? starBrightness(discRng) * BULGE_BRIGHTNESS : starBrightness(discRng)) *
      nucleusFalloff(sample.fromCentre / radius);
    stars.push({
      x: sample.x,
      y: sample.y,
      z: sample.z,
      brightness,
      color: starColor(brightness, discRng, sample.armMix),
      size: 0.55 + brightness * 1.10,
      home: false,
    });
  }

  return { version: GALAXY_VERSION, tier, centre, stars };
}

/** Brightness scale for the nucleus gradient: 1 outside the falloff radius, `NUCLEUS_FLOOR` at the centre. */
function nucleusFalloff(fraction: number): number {
  const t = Math.min(1, Math.max(0, fraction / NUCLEUS_FALLOFF_RADIUS));
  return NUCLEUS_FLOOR + (1 - NUCLEUS_FLOOR) * t * t * (3 - 2 * t);
}

/** Heavy-tailed: most stars dim, a few bright. Never zero, or the field disappears. */
function starBrightness(rng: Rng): number {
  const u = rng.next();
  return 0.10 + 0.90 * u * u * u;
}

/**
 * Brightness → tint: dim stars orange, mid white, bright blue-white. `armMix` pushes arm stars
 * cool and lane stars warm at no pixel cost — the reference's third claim, taken as a principle.
 */
function starColor(
  brightness: number,
  rng: Rng,
  armMix = 0,
): readonly [number, number, number] {
  const jitter = rng.range(-0.04, 0.04);
  // A small hue jitter keeps the field from looking like three flat classes.
  const t = Math.min(1, Math.max(0, brightness));
  const cool = ARM_HUE_SHIFT * armMix;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return [
    clamp(1.0 + jitter),
    clamp(0.62 + 0.34 * t + jitter + cool * 0.5),
    clamp(0.38 + 0.58 * t + jitter + cool),
  ] as const;
}