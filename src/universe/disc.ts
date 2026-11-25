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
import { GALAXY_RADIUS_MAX_M, GALAXY_RADIUS_MIN_M } from '../render/scale';
import {
  GALAXY_DEPTH as LEVEL_GALAXY_DEPTH,
  galaxySizeFraction,
  sectorCount as sectorCountOf,
  sectorIndexForAngle,
} from './levels';

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
/** The reference disc scale length, as a fraction of the radius. The shape law varies it. */
export const DISC_SCALE_LENGTH_FRACTION = 0.36;
/** The reference winding: the log-spiral pitch in radians per scale length. Varies now. */
export const ARM_WINDING_REFERENCE = 2.4;
/**
 * How far an arm turns from the centre to the rim, radians. **This is the drawn shape axis; the
 * pitch is derived from it and the scale length.**
 *
 * It is not a free aesthetic choice. Below roughly 300° of turn the arm's curvature is small enough
 * that a lane between two arms becomes a wedge: the disc reads as radial spokes around a dark
 * pinwheel, and the measured arm ridge/trough density ratio falls from ~10 to ~1.3 (ticket 06
 * item 4, twelve galaxies). The old fixed design sat at `2.4 / 0.36` = 6.67 rad = 382°, and the
 * range brackets that with room for a visibly looser or tighter spiral.
 */
export const ARM_SWEEP_MIN_RAD = 6.6;
export const ARM_SWEEP_MAX_RAD = 9.6;
/** The reference bulge radius, as a fraction of the radius. Varies now. */
export const BULGE_RADIUS_FRACTION_REFERENCE = 0.13;
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

/**
 * The shape law: how this galaxy's disc is built, drawn from its own stream.
 *
 * A galaxy used to be one fixed design at one fixed size, so every address drew the same object
 * with a different rotation. This is the variation (ticket 06, work item 4): size, arm structure,
 * bulge and bar, and the gas/colour state, all drawn once from `(seed, galaxyAddress)`.
 *
 * **The draws are on their own stream, `seed|addr|shape|v1`, deliberately.** The frame stream
 * (`homeAngle, homeHeight, firstArm`) is what the layer-3 arm calibration was measured against,
 * and keeping the shape elsewhere means `k = 2` still reproduces `firstArm, firstArm + π` exactly.
 * A later reader can therefore still compare an arm measurement to the layer-3 captures.
 *
 * Draw order (append-only, like every stream here):
 *
 * | # | field | range | law |
 * | --- | --- | --- | --- |
 * | 0 | arm count | 2, 3, 4 (50/25/25%) | `armOffsets` spacing |
 * | 1 | arm sweep | 6.6..9.6 rad (378°..550°) | the whole turn from centre to rim |
 * | 2 | scale length | 0.28..0.45 R | exponential falloff; `winding = sweep · this` |
 * | 3 | bulge fraction | 0.03..0.14 | share of disc-kind stars in the spheroid |
 * | 4 | bulge radius | 0.09..0.20 R | spheroid extent, `bulgeProfile` normaliser |
 * | 5 | bulge flattening | 0.45..0.85 | spheroid height squash |
 * | 6 | bar strength | 0..0.35 | bulge elongation along the first arm |
 * | 7 | halo fraction | 0..0.03 | share on the heavy radial tail |
 * | 8 | dust depth | 0..0.35 | lane emission depression |
 * | 9 | colour age | 0..1 | red/quenched .. blue/star-forming |
 *
 * **Sweep is drawn, pitch is derived — and that is a correction, not a preference.** The first cut
 * of this law drew `winding` (radians per scale length) and `scaleLengthFraction` independently
 * from the ranges the old fixed design implied. Their *ratio* is what shapes the spiral: the arm
 * turns `winding / scaleLength` radians from centre to rim. Drawing both freely let that ratio fall
 * anywhere from 217° to 561° across twelve seeds, and below ~300° the arms become near-radial spokes
 * with a black wedge through the nucleus — measured ridge/trough 1.3, i.e. no arms at all
 * (`v1/4`, `v1/6`). The physical variety axis is how far the arm *winds*, so the draw is the sweep
 * and the pitch is computed to deliver it.
 */
export interface GalaxyShape {
  readonly armCount: number;
  /**
   * The log-spiral pitch in radians per scale length, `armSweepRad · scaleLengthFraction`.
   * **Derived, never drawn independently**: `armStrength` divides by the scale length, so drawing
   * this on its own decouples the arm's openness from the disc it sits in and can produce spokes.
   */
  readonly winding: number;
  /** The whole turn from galactic centre to rim, radians. The drawn shape axis. */
  readonly armSweepRad: number;
  readonly scaleLengthFraction: number;
  readonly bulgeFraction: number;
  readonly bulgeRadiusFraction: number;
  readonly bulgeFlattening: number;
  readonly barStrength: number;
  readonly haloFraction: number;
  readonly dustDepth: number;
  readonly colourAge: number;
}

/** Bumped when the shape draw order or a range changes: this address is a different galaxy. */
export const GALAXY_SHAPE_VERSION = 1;

/**
 * The design every galaxy had before the variation law: two arms at the old winding, a compact
 * bulge, no bar, no halo, no dust, and the old warm palette.
 *
 * Two jobs: it is the `k = 2` special case the layer-3 calibration is comparable against, and it
 * is what the root (which is not a galaxy) reports so the type stays total.
 */
export const REFERENCE_SHAPE: GalaxyShape = Object.freeze({
  armCount: 2,
  winding: ARM_WINDING_REFERENCE,
  armSweepRad: ARM_WINDING_REFERENCE / DISC_SCALE_LENGTH_FRACTION,
  scaleLengthFraction: DISC_SCALE_LENGTH_FRACTION,
  bulgeFraction: 0.06,
  bulgeRadiusFraction: BULGE_RADIUS_FRACTION_REFERENCE,
  bulgeFlattening: 0.62,
  barStrength: 0,
  haloFraction: 0,
  dustDepth: 0,
  colourAge: 0.5,
});

/** The shape stream. Separate from the frame stream on purpose; see `GalaxyShape`. */
export function galaxyShapeKey(seed: string, galaxyAddress: Address): string {
  return `${seed}|${formatAddress(galaxyAddress)}|shape|v${GALAXY_SHAPE_VERSION}`;
}

export function galaxyShape(seed: string, galaxyAddress: Address): GalaxyShape {
  const rng = createRng(fnv1a32(galaxyShapeKey(seed, galaxyAddress)));

  // One draw for the arm count, weighted 2:2:1, so the common galaxy is a two-arm spiral and a
  // four-arm one is a real minority rather than an equal partner.
  const armRoll = rng.next();
  const armCount = armRoll < 0.5 ? 2 : armRoll < 0.75 ? 3 : 4;

  // Sweep first, pitch derived: see `GalaxyShape`. Drawing them independently is what produced
  // 217°..561° of turn and, at the loose end, spokes rather than arms.
  const armSweepRad = rng.range(ARM_SWEEP_MIN_RAD, ARM_SWEEP_MAX_RAD);
  const scaleLengthFraction = rng.range(0.28, 0.45);

  return {
    armCount,
    winding: armSweepRad * scaleLengthFraction,
    armSweepRad,
    scaleLengthFraction,
    bulgeFraction: rng.range(0.03, 0.14),
    bulgeRadiusFraction: rng.range(0.09, 0.2),
    bulgeFlattening: rng.range(0.45, 0.85),
    barStrength: rng.range(0, 0.35),
    haloFraction: rng.range(0, 0.03),
    dustDepth: rng.range(0, 0.35),
    colourAge: rng.range(0, 1),
  };
}

/**
 * The galaxy's radius in metres, drawn from the size it already reports.
 *
 * `galaxySizeFraction` was written for the sector count and has always been the galaxy's size;
 * until now nothing else read it, so every galaxy was `GALAXY_RADIUS_M` across. The mapping is
 * linear on the fraction and spans `GALAXY_RADIUS_MIN_M..GALAXY_RADIUS_MAX_M` (18×), which is the
 * visible spread the owner asked for. The *fraction* still decides the sector count, so a galaxy
 * cannot be sized differently from the way it is sliced.
 */
export function galaxyRadiusM(seed: string, galaxyAddress: Address): number {
  const fraction = galaxySizeFraction(seed, galaxyAddress);
  return GALAXY_RADIUS_MIN_M + fraction * (GALAXY_RADIUS_MAX_M - GALAXY_RADIUS_MIN_M);
}

export interface GalaxyFrame {
  /** This galaxy's own radius, metres. Everything that frames or measures it must use this. */
  readonly radius: number;
  /** Galactic centre, relative to the home star, metres. */
  readonly centre: Vec3;
  /** The arms' angular offsets at the scale radius. Two, three or four of them. */
  readonly armOffsets: readonly number[];
  /** The drawn variation law (arms, pitch, bulge, bar, halo, dust, colour). */
  readonly shape: GalaxyShape;
  /** The stream key every other field in this galaxy must reuse. */
  readonly key: string;
  /** How many sectors this galaxy has, 1..6 (ADR-0018, `sectorCount` in `levels.ts`). */
  readonly sectorCount: number;
  /**
   * Where slice zero begins, radians in the disc plane. Derived, not drawn — see `galaxyFrame`.
   */
  readonly sectorPhaseRad: number;
}

/**
 * Lay out one galaxy's frame: how big it is, where its centre is and where its arms start.
 *
 * `galaxyAddress` must already be the galaxy's **own** level (`galaxyAddressOf`), not a deeper
 * address. Normalising here instead would make this module depend on the identity rule; the
 * callers own that, and both of them do it.
 */
export function galaxyFrame(seed: string, galaxyAddress: Address): GalaxyFrame {
  const radius = galaxyRadiusM(seed, galaxyAddress);
  const shape = galaxyShape(seed, galaxyAddress);
  const key = galaxyKey(seed, galaxyAddress);
  const frameRng = createRng(fnv1a32(`${key}|frame`));
  const homeAngle = frameRng.range(0, Math.PI * 2);
  const homeRadius = HOME_RADIUS_FRACTION * radius;
  const homeHeight = frameRng.range(-0.02, 0.02) * radius;
  const firstArm = frameRng.range(0, Math.PI * 2);
  // `i = 0` and `i = k/2` reproduce the old two-arm pair exactly when `k = 2`, so the frame's
  // arm phase still lines up with the layer-3 measurement for those galaxies.
  const armOffsets: readonly number[] = Object.freeze(
    Array.from({ length: shape.armCount }, (_, index) => firstArm + (index * Math.PI * 2) / shape.armCount),
  );

  const centre: Vec3 = rotateAboutX(
    {
      x: -Math.cos(homeAngle) * homeRadius,
      y: -homeHeight,
      z: -Math.sin(homeAngle) * homeRadius,
    },
    GALACTIC_PLANE_TILT_RAD,
  );

  // **The sector phase is derived, not drawn**, and that is deliberate (ADR-0023).
  //
  // A new draw here would have been harmless only if appended: the frame stream is
  // `homeAngle, homeHeight, firstArm`, so one more `rng.range` would leave every existing number
  // untouched. But a *free* phase would put the home star at an arbitrary angle, and the home
  // neighbourhood is exactly what `v1/0.0.0` reserves for Sol (ADR-0009). Sol's reserved address
  // has to keep meaning "sector 0, star 0" in *every* galaxy, so slice zero is
  // **centred on the home star**.
  //
  // The home star sits at the frame origin and the **centre is opposite it** (`-cos(homeAngle)`,
  // `-sin(homeAngle)`), so the home star's azimuth about the centre is `homeAngle` itself — not
  // `homeAngle + π`. Getting that sign wrong puts the place you start in on the far side of the
  // galaxy from sector 0, which was true of the first cut of this function.
  //
  // The consequence is that the phase still varies per galaxy — it follows `homeAngle` — but the
  // place you start in is always sector 0. That also gives the open question "where does slice
  // zero begin" its least surprising answer: at home.
  const sectorCount = sectorCountOf(seed, galaxyAddress);
  const sectorPhaseRad = homeAngle - Math.PI / sectorCount;

  return { radius, centre, armOffsets, shape, key, sectorCount, sectorPhaseRad };
}

/**
 * A point given relative to the **galactic centre**, expressed in the disc's own flat frame:
 * `x`/`z` span the plane and `y` is height above it.
 *
 * Every disc measurement (radius, azimuth, arm strength) is defined here, because the plane is
 * inclined to the orrery's and world `x`/`z` would read the disc as an ellipse.
 */
export function discPlanePoint(centre: Vec3, point: Vec3): Vec3 {
  return rotateAboutX(
    { x: point.x - centre.x, y: point.y - centre.y, z: point.z - centre.z },
    -GALACTIC_PLANE_TILT_RAD,
  );
}

/**
 * The azimuth of `point` about the galactic centre, in the disc plane, radians.
 *
 * This is the angle a sector is derived from (ADR-0023): the star's *drawn* position, not a
 * separate roll. It is computed from the same numbers the picture packs, so the sector a star is
 * filed under and the wedge it is visibly inside cannot disagree.
 */
export function discAzimuthOf(frame: GalaxyFrame, point: Vec3): number {
  const flat = discPlanePoint(frame.centre, point);
  return Math.atan2(flat.z, flat.x);
}

/**
 * Which sector a **drawn** point in the galaxy frame falls in (ADR-0023).
 *
 * The whole of the sector derivation in one place: the azimuth of the point about the galactic
 * centre, then the wedge law. The generator, `placement` and the tests all read this, so a star's
 * label and the wedge it is visibly inside cannot be computed by two slightly different rules.
 */
export function sectorOfPoint(frame: GalaxyFrame, point: Vec3): number {
  return sectorIndexForAngle(
    discAzimuthOf(frame, point),
    frame.sectorCount,
    frame.sectorPhaseRad,
  );
}

/**
 * Where a sector's own place sits: the **centre of its wedge**, at a fraction of the disc's radius.
 *
 * A sector owns the whole radial extent of its slice (ADR-0018), so it has no centroid in the
 * literal sense; its position for travel is the middle of the slice at mid-radius. That makes a
 * sector a real destination with a real distance and a real bearing, which is what `planTravel`
 * and the compass need.
 *
 * The radius fraction is a **feel** constant: it is the one number that decides what a
 * sector-to-sector hop costs. Half the radius is the plain reading of "mid-radius".
 */
export const SECTOR_POSITION_RADIUS_FRACTION = 0.5;

/**
 * The world-space position of sector `index`, relative to the home star.
 *
 * Total for any integer: a crafted link may name an ordinal the galaxy does not have, and refusing
 * to place it would make `planTravel` invent a distance. Index `count` and index `0` are the same
 * wedge, which is the ring's own arithmetic rather than a special case.
 */
export function sectorPosition(frame: GalaxyFrame, index: number): Vec3 {
  const count = Math.max(1, Math.floor(frame.sectorCount));
  const ordinal = Number.isFinite(index) ? Math.trunc(index) : 0;
  const angle = frame.sectorPhaseRad + ((ordinal + 0.5) * Math.PI * 2) / count;
  const radius = SECTOR_POSITION_RADIUS_FRACTION * frame.radius;
  const offset = rotateAboutX(
    { x: radius * Math.cos(angle), y: 0, z: radius * Math.sin(angle) },
    GALACTIC_PLANE_TILT_RAD,
  );
  return {
    x: offset.x + frame.centre.x,
    y: offset.y + frame.centre.y,
    z: offset.z + frame.centre.z,
  };
}

/** One sampled star, in the galaxy frame: metres relative to the home star, already inclined. */
export interface DiscSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** True if the sample came from the bulge rather than the disc. */
  readonly inBulge: boolean;
  /** True if the sample is on the halo tail: thick, smooth, and tinted old. */
  readonly inHalo: boolean;
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
  const { radius, armOffsets, centre, shape } = frame;
  // Drawn per star, not from the index: the tier counts must keep a prefix of one stream.
  const inBulge = rng.chance(shape.bulgeFraction);
  // Halo membership is drawn for every disc-kind star, before its radius, so the mixture is a
  // stable property of the population rather than a per-seed surprise.
  const inHalo = !inBulge && rng.chance(shape.haloFraction);
  let x: number;
  let y: number;
  let z: number;
  // Distance from the disc centre, for the nucleus gradient.
  let fromCentre = 0;
  // 0 in the lane, 1 on an arm; drives the arm/lane hue split.
  let armMix = 0;

  if (inBulge) {
    // A flattened spheroid: radius ∝ u^(1/3) keeps it solid, not a shell.
    const r = shape.bulgeRadiusFraction * radius * Math.cbrt(rng.next());
    const cosPolar = rng.range(-1, 1);
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    const azimuth = rng.range(0, Math.PI * 2);
    let bulgeX = r * sinPolar * Math.cos(azimuth);
    let bulgeZ = r * sinPolar * Math.sin(azimuth);
    // The bar: the bulge is the inner galaxy, so elongating it along the first arm's angle *is*
    // a bar — there is no second population to add. `barStrength = 0` leaves the old spheroid
    // exactly, which is what keeps this a variation of the law rather than a new one.
    if (shape.barStrength > 0) {
      const barAngle = armOffsets[0]!;
      const cosBar = Math.cos(barAngle);
      const sinBar = Math.sin(barAngle);
      const along = bulgeX * cosBar + bulgeZ * sinBar;
      const across = -bulgeX * sinBar + bulgeZ * cosBar;
      const long = along * (1 + 2.2 * shape.barStrength);
      const short = across * (1 - 0.55 * shape.barStrength);
      bulgeX = long * cosBar - short * sinBar;
      bulgeZ = long * sinBar + short * cosBar;
    }
    x = bulgeX;
    z = bulgeZ;
    y = r * cosPolar * shape.bulgeFlattening;
    fromCentre = Math.hypot(bulgeX, bulgeZ);
  } else {
    // Truncated exponential disc: r = -scale·ln(1-u), rejected beyond the radius. Halo stars use
    // the same law at 2.2× the scale length: a heavier radial tail, not a second population.
    const scale = shape.scaleLengthFraction * radius;
    const radialScale = inHalo ? scale * 2.2 : scale;
    let r = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      r = -radialScale * Math.log(1 - rng.next() * 0.999_999);
      if (r <= radius) break;
    }
    // **Truncation is a bound, not a hope.** The loop above keeps its last draw when all eight
    // attempts overshoot, which the old fixed 0.36 R scale made vanishingly rare and the drawn
    // 0.45 R scale, with the halo's 2.2× tail, does not: a halo star can land at 1.7 R and would
    // then be drawn outside the galaxy the frame says it is in. Clamping is the law's stated
    // intent ("truncated"), and at a handful of stars per galaxy it is invisible.
    r = Math.min(r, radius);
    const azimuth = rng.range(0, Math.PI * 2);
    // Density modulation, not a drawn curve: most stars are rejection-sampled onto the arm,
    // and a fixed fraction is placed uniformly so the inter-arm gaps stay populated.
    let finalAngle: number;
    if (inHalo) {
      // No arm association: the halo is smooth and old, which is what makes it read as a halo
      // rather than as more disc. It draws no arm-acceptance numbers at all.
      finalAngle = azimuth;
    } else if (rng.chance(INTER_ARM_FRACTION)) {
      finalAngle = rng.range(0, Math.PI * 2);
    } else {
      finalAngle = azimuth;
      for (let attempt = 0; attempt < ARM_ATTEMPTS; attempt += 1) {
        const arm = armStrength(r, finalAngle, scale, armOffsets, shape.winding);
        if (rng.next() <= ARM_FLOOR + (1 - ARM_FLOOR) * arm) break;
        finalAngle = rng.range(0, Math.PI * 2);
      }
    }
    x = r * Math.cos(finalAngle);
    z = r * Math.sin(finalAngle);
    // Three times the disc's height for a halo star: the thick, puffy part of the galaxy.
    y = gaussian(rng) * DISC_THICKNESS_FRACTION * radius * (inHalo ? 3 : 1);
    fromCentre = r;
    // How much of an arm this star actually sits on, for the hue split. Measured at the final
    // angle, so a star that exhausted the rejection loop and landed in the lane is not tinted
    // as an arm star.
    armMix = inHalo ? 0 : armStrength(r, finalAngle, scale, armOffsets, shape.winding);
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

  return { x: homeX, y: homeY, z: homeZ, inBulge, inHalo, fromCentre, armMix };
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

/**
 * A log-spiral arm's density at `r`, in 0..1, as the max over the galaxy's arms.
 *
 * `winding` is the galaxy's own pitch (radians of turn per scale length); it used to be the
 * constant `ARM_WINDING`, which is why every galaxy's arms were twisted identically. `offsets`
 * carries the arm count, so a three- or four-armed galaxy works the same way.
 */
export function armStrength(
  r: number,
  azimuth: number,
  scale: number,
  offsets: readonly number[],
  winding: number = ARM_WINDING_REFERENCE,
): number {
  const turn = (r / scale) * winding;
  // **The lobe has to narrow with the arm count, or the arms merge into a disc.**
  //
  // The profile is a one-sided `cos^p` on an angle that is compressed by `k/2`: its half-width is
  // `π/k`, i.e. half of one arm spacing. Two things follow, both measured (12 seeds, ticket 06
  // item 4):
  //
  // - At `k = 2` the compression is 1 and the profile is *exactly* the old `max(0, cos)²`, so the
  //   layer-3 arm calibration is untouched.
  // - `cos²` alone was π-periodic, so an odd count drew twice the lobes it claimed — a "three-arm"
  //   galaxy at 0°, 120°, 240° repeated at 180°, 300°, 60° and measured 0.02 at m=3. And because the
  //   half-width was a fixed ±90° while the spacing at `k = 4` is 90°, a four-arm galaxy's lobes
  //   covered the whole disc and measured 0.11. Both were the same defect: width not tied to
  //   spacing.
  //
  // The ridge is where this argument is zero, `azimuth = offset + turn`, so the pitch and the
  // arm's *locus* are unchanged by the compression — only its width.
  const compression = offsets.length / 2;
  let best = 0;
  for (const offset of offsets) {
    const cosine = Math.cos(compression * (azimuth - offset - turn));
    if (cosine <= 0) continue;
    const lobe = cosine ** ARM_PROFILE_EXPONENT;
    if (lobe > best) best = lobe;
  }
  return best;
}

/** Box–Muller, one sample; enough for a disc's thickness. */
function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}