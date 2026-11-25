/**
 * The galaxy's disc law: how one star is placed, and how a galaxy's frame is laid out.
 *
 * This module exists because of ADR-0011. If `generateGalaxy` drew stars one way and
 * `placement(seed, address)` put them somewhere else, the picture and the world would drift — a
 * compass pointing at empty space, or a light with nothing behind it. So the law lives here once:
 * the generator calls it with its population stream, placement calls it with a stream keyed on the
 * address, and both land in the same bulge, the same exponential disc and the same two arms.
 *
 * Everything here is a pure function of its inputs. No GPU, no camera, no `Math.random`.
 */

import { fnv1a32 } from '../lib/hash';
import { createRng, type Rng } from '../lib/random';
import { formatAddress, ancestorAddress, type Address } from '../frame/address';
import { GALAXY_RADIUS_M } from '../render/scale';
import { GALAXY_DEPTH as LEVEL_GALAXY_DEPTH } from './levels';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One light-year, metres (IAU). */
export const LY_M = 9.460_730_472_580_8e15;

/** The local field's radius: far enough to parallax, small enough to stay inside the galaxy. */
export const LOCAL_RADIUS_M = 100 * LY_M;

/**
 * The **galaxy frame's** stream version, separate from `GALAXY_VERSION` on purpose.
 *
 * `GALAXY_VERSION` says "the output shape changed, a shared link must be re-pinned". This constant
 * says "the *layout law* changed, so this address is a different galaxy". They are not the same
 * event. A rigid rotation of the whole disc — exactly what `GALACTIC_PLANE_TILT_RAD` does —
 * changes the output without changing a single drawn number: the same address should still be the
 * same galaxy, seen from a different angle. Folding both into one number made the tilt *also*
 * re-roll the population (measured: arm modulation moved 0.173 → 0.430 on the same seed), which
 * silently replaced the arms the layer-3 calibration was tuned against and made the tilt
 * impossible to measure on its own.
 *
 * It now governs **only** the frame draws: the home angle (where the centre sits) and the arm
 * phase. The population stopped being a stream and became one address per star (ADR-0011), but
 * that is a `GALAXY_VERSION` event, not this one — the frame law did not change, so this stays 3.
 * Bumping it here would re-roll the arm phase for every galaxy and make the arm-acceptance
 * measurement incomparable to the layer-3 captures for no reason. Bump it only when the frame
 * draw itself changes.
 */
export const GALAXY_STREAM_VERSION = 3;

/**
 * The level at which a galaxy is identified: the address's outermost real rung.
 *
 * **No longer a shortcut.** This used to be a fixed constant documented as a stand-in until levels
 * carried kinds; `levels.ts` now carries them, and this re-exports that answer so there is one
 * authority rather than a constant and a ladder that could disagree. Callers still ask
 * `galaxyAddressOf`, never the depth.
 */
export const GALAXY_DEPTH = LEVEL_GALAXY_DEPTH;

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
 * Bound on the rejection loop. Re-aiming a rejected star uniformly (the first implementation)
 * deposited ~60% of the disc as haze, which flattened the m=2 wave into an oval and made the
 * arms unreadable at the render budget. Rejection-sampling *into* the arm keeps the population
 * on the arms; the loop is bounded so a pathological seed cannot spin.
 */
const ARM_ATTEMPTS = 40;

/** Rotate a vector about world `x` (right-handed). The generator's single orientation transform. */
export function rotateAboutX(point: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * cosine - point.z * sine,
    z: point.y * sine + point.z * cosine,
  };
}

/** The stream key for one galaxy. Both fields and placement derive their streams from this. */
export function galaxyKey(seed: string, galaxyAddress: Address): string {
  return `${seed}|${formatAddress(galaxyAddress)}|galaxy|v${GALAXY_STREAM_VERSION}`;
}

export interface GalaxyFrame {
  readonly radius: number;
  /** Galactic centre, relative to the home star, metres. */
  readonly centre: Vec3;
  /** The two arms' angular offsets at the scale radius. */
  readonly armOffsets: readonly number[];
  /** The stream key every other field in this galaxy must reuse. */
  readonly key: string;
}

/**
 * Lay out one galaxy's frame: where its centre is and where its arms start.
 *
 * `galaxyAddress` must already be the galaxy's **own** level (`galaxyAddressOf`), not a deeper
 * address. Normalising here instead would make this module depend on the identity rule; the
 * callers own that, and both of them do it.
 */
export function galaxyFrame(seed: string, galaxyAddress: Address): GalaxyFrame {
  const radius = GALAXY_RADIUS_M;
  const key = galaxyKey(seed, galaxyAddress);
  const frameRng = createRng(fnv1a32(`${key}|frame`));
  const homeAngle = frameRng.range(0, Math.PI * 2);
  const homeRadius = HOME_RADIUS_FRACTION * radius;
  const homeHeight = frameRng.range(-0.02, 0.02) * radius;
  const firstArm = frameRng.range(0, Math.PI * 2);
  const armOffsets: readonly number[] = Object.freeze([firstArm, firstArm + Math.PI]);

  const centre: Vec3 = rotateAboutX(
    {
      x: -Math.cos(homeAngle) * homeRadius,
      y: -homeHeight,
      z: -Math.sin(homeAngle) * homeRadius,
    },
    GALACTIC_PLANE_TILT_RAD,
  );

  return { radius, centre, armOffsets, key };
}

/** One sampled star, in the galaxy frame: metres relative to the home star, already inclined. */
export interface DiscSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** True if the sample came from the bulge rather than the disc. */
  readonly inBulge: boolean;
  /** Distance from the galactic centre in the disc plane; drives the nucleus gradient. */
  readonly fromCentre: number;
  /** 0 in the lane, 1 on an arm; drives the arm/lane hue split. */
  readonly armMix: number;
}

/**
 * Draw one star from the disc law, consuming exactly the stream draws the population always has.
 *
 * The order is load-bearing: `generateGalaxy` feeds this function its `|disc` stream and then
 * draws brightness and colour from the same stream, so a different order here would silently
 * re-roll every star in every galaxy. There is a test that replays the stream and compares.
 */
export function sampleDiscStar(rng: Rng, frame: GalaxyFrame): DiscSample {
  const { radius, armOffsets, centre } = frame;
  // Drawn per star, not from the index: the tier counts must keep a prefix of one stream.
  const inBulge = rng.chance(BULGE_FRACTION);
  let x: number;
  let y: number;
  let z: number;
  // Distance from the disc centre, for the nucleus gradient.
  let fromCentre = 0;
  // 0 in the lane, 1 on an arm; drives the arm/lane hue split.
  let armMix = 0;

  if (inBulge) {
    // A flattened spheroid: radius ∝ u^(1/3) keeps it solid, not a shell.
    const r = BULGE_RADIUS_FRACTION * radius * Math.cbrt(rng.next());
    const cosPolar = rng.range(-1, 1);
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    const azimuth = rng.range(0, Math.PI * 2);
    x = r * sinPolar * Math.cos(azimuth);
    y = r * cosPolar * 0.62;
    z = r * sinPolar * Math.sin(azimuth);
    fromCentre = r;
  } else {
    // Truncated exponential disc: r = -scale·ln(1-u), rejected beyond the radius.
    const scale = DISC_SCALE_LENGTH_FRACTION * radius;
    let r = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      r = -scale * Math.log(1 - rng.next() * 0.999_999);
      if (r <= radius) break;
    }
    const azimuth = rng.range(0, Math.PI * 2);
    // Density modulation, not a drawn curve: most stars are rejection-sampled onto the arm,
    // and a fixed fraction is placed uniformly so the inter-arm gaps stay populated.
    let finalAngle: number;
    if (rng.chance(INTER_ARM_FRACTION)) {
      finalAngle = rng.range(0, Math.PI * 2);
    } else {
      finalAngle = azimuth;
      for (let attempt = 0; attempt < ARM_ATTEMPTS; attempt += 1) {
        const arm = armStrength(r, finalAngle, scale, armOffsets);
        if (rng.next() <= ARM_FLOOR + (1 - ARM_FLOOR) * arm) break;
        finalAngle = rng.range(0, Math.PI * 2);
      }
    }
    x = r * Math.cos(finalAngle);
    z = r * Math.sin(finalAngle);
    y = gaussian(rng) * DISC_THICKNESS_FRACTION * radius;
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

  return { x: homeX, y: homeY, z: homeZ, inBulge, fromCentre, armMix };
}

/**
 * Draw one star from the local-field law: a uniform 3D density inside `LOCAL_RADIUS_M` of the
 * home star.
 *
 * This is the *near* kind of address (see `starKind` in `placement.ts`). It used to be a separate
 * population drawn from its own stream; it is now the same law reached by address, so the stars
 * the camera parallaxes against at system scale are places you can travel to rather than a
 * backdrop. The draw order is the population's original order — radius, polar angle, azimuth —
 * because the law, not the stream, is what has to stay stable.
 */
export function sampleLocalStar(rng: Rng): Vec3 {
  // r ∝ u^(1/3) is the radial law of a uniform 3D density; it keeps the nearest-neighbour
  // scale honest for the budget instead of painting a shell.
  const r = LOCAL_RADIUS_M * Math.cbrt(rng.next());
  const cosPolar = rng.range(-1, 1);
  const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
  const azimuth = rng.range(0, Math.PI * 2);
  return {
    x: r * sinPolar * Math.cos(azimuth),
    y: r * cosPolar,
    z: r * sinPolar * Math.sin(azimuth),
  };
}

/** A log-spiral arm's density at `r`, in 0..1, as the max over the two arms. */
export function armStrength(
  r: number,
  azimuth: number,
  scale: number,
  offsets: readonly number[],
): number {
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

/** Box–Muller, one sample; enough for a disc's thickness. */
function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}