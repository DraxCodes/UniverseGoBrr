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
import { ancestorAddress, formatAddress, type Address } from '../frame/address';
import { GALAXY_RADIUS_M } from '../render/scale';

/**
 * The **population stream's** version, which is separate from `GALAXY_VERSION` on purpose.
 *
 * `GALAXY_VERSION` says "the output shape changed, a shared link must be re-pinned". The stream
 * version says "the *law* that draws the stars changed, so this address is a different galaxy".
 * They are not the same event. A rigid rotation of the whole disc — exactly what
 * `GALACTIC_PLANE_TILT_RAD` does — changes the output without changing a single drawn number: the
 * same address should still be the same galaxy, seen from a different angle. Folding both into one
 * number made the tilt *also* re-roll the population (measured: arm modulation moved 0.173 → 0.430
 * on the same seed), which silently replaced the arms the layer-3 calibration was tuned against and
 * made the tilt impossible to measure on its own.
 *
 * Bump this when a sampling law, a constant or an ordering changes. Do not bump it for a
 * reorientation, a relabelling or a renderer change.
 */
export const GALAXY_STREAM_VERSION = 3;

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

/**
 * The galactic plane's inclination to the orrery's orbital plane (world `y = 0`), as a signed
 * rotation about world `x`.
 *
 * This is not decoration: it is the difference between the thesis's boot frame and a plain
 * sprinkle. The home system sits *inside* the disc, so the disc projects to a band across the sky
 * — but only if the camera looks along the plane. The boot camera looks ~36.6° down at the orrery,
 * and with the two planes coplanar that meant it looked *away* from the disc, whose band landed
 * above the top edge (gate iteration 1, flaw 4: "no dust band on the boot frame"). Inclining the
 * disc lifts its near side across the frame: measured band axis ratio 1.25 → 4.17, ~52 000 lit
 * pixels, all of it the disc population and none of it painted.
 *
 * The real ecliptic–galactic inclination is ~60°. It is not used here because the world frame is
 * the *orrery's*, not the Sun's, and at 60° the band drops to row ~995 of 1080 — below the system
 * rather than behind it. 30° is the measured value that crosses the frame centre (band at row
 * ~455, the nucleus at ~450) while keeping the disc in view rather than edge-on.
 *
 * The sign tips the disc's `+z` side *up*, which is the side the boot camera faces. The tilt is a
 * real rotation of the star field, so the band moves against the orrery as the camera drifts; that
 * is the thesis's proof that it is an object rather than paint.
 */
export const GALACTIC_PLANE_TILT_RAD = (-30 * Math.PI) / 180;

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

/**
 * The disc's axis in world space: world `+y` carried through the same rotation as the population.
 *
 * Consumers must measure the disc against *this*, not against world `+y`. Once the plane is
 * inclined those are different axes, and the difference is not cosmetic: the arm legibility gate
 * reads "is the disc face-on enough to see two arms", and using `forward.y` after the tilt would
 * call the layer-3 gallery camera edge-on when it is looking straight at the disc.
 */
export const GALACTIC_PLANE_NORMAL: Vec3 = Object.freeze({
  x: 0,
  y: Math.cos(GALACTIC_PLANE_TILT_RAD),
  z: Math.sin(GALACTIC_PLANE_TILT_RAD),
});

/** Rotate a vector about world `x` (right-handed). The generator's single orientation transform. */
function rotateAboutX(point: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * cosine - point.z * sine,
    z: point.y * sine + point.z * cosine,
  };
}

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

/** Where the home star sits in the disc, as a fraction of the radius. */
const HOME_RADIUS_FRACTION = 0.55;
/** Disc scale length, as a fraction of the radius: an exponential disc falls off here. */
const DISC_SCALE_LENGTH_FRACTION = 0.36;
/** Two arms; the log-spiral pitch is this many radians of winding per scale length. */
const ARM_WINDING = 2.4;
/** Fraction of the disc budget in the bulge. */
const BULGE_FRACTION = 0.06;
/** Bulge radius, as a fraction of the radius: a compact nucleus, not a wash over the inner arms. */
const BULGE_RADIUS_FRACTION = 0.13;
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
/** Disc thickness, as a fraction of the radius. */
const DISC_THICKNESS_FRACTION = 0.025;
/**
 * Fraction of the disc that is always inter-arm, so the gaps do not close. Kept at 0.08: the
 * lane is emptied visually by narrowing the arm profile and by cutting the impostor halo, not by
 * starving the population — below ~8% uniform the disc reads as two drawn ribbons (the test's
 * "gaps do not close" floor exists for exactly that).
 */
const INTER_ARM_FRACTION = 0.08;
/**
 * The arm's angular profile, as `cos^ARM_PROFILE_EXPONENT`. Left at 2: the gate measured m=2 at
 * 0.334 and said plainly that the number was not the problem, so sharpening the profile was
 * tried and reverted — at 3 and above the uniform lane floor falls under the "gaps do not close"
 * guard and the disc starts reading as two ribbons. Arm legibility is bought in the shader (the
 * halo veiled the lane) and in the per-point hue split, not by starving the population.
 */
const ARM_PROFILE_EXPONENT = 2;
/**
 * The arm's minimum acceptance. A rejected draw is re-aimed (not kept), so this is the
 * acceptance floor at the arm's edge; it keeps the arm soft rather than a drawn filament. It is
 * deliberately low: the *density* ratio is what makes the arm read at 45k impostors, and a high
 * floor fills the gap with haze until the wave measures flat (the oval failure).
 */
const ARM_FLOOR = 0.03;
/**
 * How far the arm/lane hue split goes. Arm stars are pushed cool and lane stars warm at no pixel
 * cost — the hue is uploaded per impostor already. This is the reference's third claim
 * (hue separates arm from inter-arm) taken as a principle, not as its magenta/blue palette.
 */
const ARM_HUE_SHIFT = 0.16;
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
  //
  // The address is normalised to its galaxy's own level here, not at the call sites: two stars in
  // one galaxy must return the same array from this function, and a caller that passes a deeply
  // nested address must not be able to get a private galaxy out of it (ADR-0011).
  const key = `${seed}|${formatAddress(galaxyAddressOf(address))}|galaxy|v${GALAXY_STREAM_VERSION}`;
  const frameRng = createRng(fnv1a32(`${key}|frame`));
  const localRng = createRng(fnv1a32(`${key}|local`));
  const discRng = createRng(fnv1a32(`${key}|disc`));

  const radius = GALAXY_RADIUS_M;
  const homeAngle = frameRng.range(0, Math.PI * 2);
  const homeRadius = HOME_RADIUS_FRACTION * radius;
  const homeHeight = frameRng.range(-0.02, 0.02) * radius;
  const firstArm = frameRng.range(0, Math.PI * 2);
  const armOffsets: readonly number[] = [firstArm, firstArm + Math.PI];

  const centre: Vec3 = rotateAboutX(
    {
      x: -Math.cos(homeAngle) * homeRadius,
      y: -homeHeight,
      z: -Math.sin(homeAngle) * homeRadius,
    },
    GALACTIC_PLANE_TILT_RAD,
  );

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
    // Distance from the disc centre, for the nucleus gradient.
    let fromCentre = 0;
    // 0 in the lane, 1 on an arm; drives the arm/lane hue split.
    let armMix = 0;

    if (inBulge) {
      // A flattened spheroid: radius ∝ u^(1/3) keeps it solid, not a shell.
      const r = BULGE_RADIUS_FRACTION * radius * Math.cbrt(discRng.next());
      const cosPolar = discRng.range(-1, 1);
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      const azimuth = discRng.range(0, Math.PI * 2);
      x = r * sinPolar * Math.cos(azimuth);
      y = r * cosPolar * 0.62;
      z = r * sinPolar * Math.sin(azimuth);
      fromCentre = r;
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
      fromCentre = r;
      // How much of an arm this star actually sits on, for the hue split. Measured at the final
      // angle, so a star that exhausted the rejection loop and landed in the lane is not tinted
      // as an arm star.
      armMix = armStrength(r, finalAngle, scale, armOffsets);
    }

    // Keep the disc field out of the local field's sphere, or the same neighbourhood is drawn
    // twice with different statistics. Relative to the **home star**, not the galactic centre:
    // pushing the centre-relative vector would move the star toward the bulge instead.
    //
    // The disc is generated flat (`y = 0`) and then inclined by one rotation about the home star,
    // so every offset — the axial height included — is carried into world space here. The local
    // field is left alone: it is a ball, and a rotation cannot change a ball.
    const worldOffset = rotateAboutX({ x, y, z }, GALACTIC_PLANE_TILT_RAD);
    let homeX = worldOffset.x + centre.x;
    let homeY = worldOffset.y + centre.y;
    let homeZ = worldOffset.z + centre.z;
    const homeDistance = Math.hypot(homeX, homeY, homeZ);
    const exclusion = LOCAL_RADIUS_M * 1.2;
    if (homeDistance < exclusion) {
      const factor = exclusion / Math.max(homeDistance, 1e-9);
      homeX *= factor;
      homeY *= factor;
      homeZ *= factor;
    }

    const brightness =
      (inBulge ? starBrightness(discRng) * BULGE_BRIGHTNESS : starBrightness(discRng)) *
      nucleusFalloff(fromCentre / radius);
    stars.push({
      x: homeX,
      y: homeY,
      z: homeZ,
      brightness,
      color: starColor(brightness, discRng, armMix),
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
    // cos² gives a positive, smooth arm width and a genuine inter-arm gap; the exponent narrows
    // that band without moving the arm's ridge, so the lane widens as the arm sharpens.
    const squared = Math.cos(azimuth - offset - winding) ** 2;
    best = Math.max(best, squared ** (ARM_PROFILE_EXPONENT / 2));
  }
  return best;
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

/** Box–Muller, one sample; enough for a disc's thickness. */
function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}