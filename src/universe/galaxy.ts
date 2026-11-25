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
import { formatAddress, type Address } from '../frame/address';
import {
  GALAXY_DEPTH,
  REFERENCE_SHAPE,
  discPlanePoint,
  galaxyAddressOf,
  galaxyFrame,
  sectorOfPoint,
  type GalaxyShape,
  type Vec3,
} from './disc';
import { contentKey } from './levels';
import {
  LOCAL_STAR_EVERY,
  placedStarForIndex,
  starAddressAt,
  starKindOfIndex,
} from './placement';
import { GALAXY_RADIUS_MIN_M } from '../render/scale';

// The disc law and the galaxy-identity rule live in `disc.ts` (ADR-0011): the generator and
// `placement(seed, address)` must lay stars out with the *same* function, or the picture and the
// world drift. These exports stay here because they are part of the galaxy's public shape —
// `galaxy-scene.ts` measures against the plane normal and the tests read the tilt, the local
// radius, the stream version and the identity function.
export {
  GALACTIC_PLANE_NORMAL,
  GALACTIC_PLANE_TILT_RAD,
  GALAXY_DEPTH,
  GALAXY_STREAM_VERSION,
  LOCAL_RADIUS_M,
  LY_M,
  galaxyAddressOf,
} from './disc';
export type { Vec3 } from './disc';

/**
 * Bumped whenever the generator's output would change; old links break loudly (ADR-0005).
 *
 * 4 → 5: a galaxy is now keyed by its own level instead of the full address (ADR-0011). A link
 * whose address is one level deep (`v1/0`, the capture default) is unchanged, because it *was*
 * already naming its galaxy. Every deeper link — including Sol at `v1/0.0.0` — now shows the
 * galaxy it lives in rather than a private one, which is a different sky.
 *
 * 5 → 6: the picture now draws **by address** (ADR-0011). Every star is a child of its galaxy and
 * carries that `address`; its position comes from `placement`, not from a sequential stream. The
 * local field is addressable too, so the neighbours the camera parallaxes against are places you
 * can travel to. Every galaxy is a different sky, top to bottom.
 *
 * 6 → 7: re-authored the brightness curve and colour palette (Layer 3 iteration 2). The inner disc
 * uses a `r / (r + r₀)` core taper to cancel the `1/r` exponential-radius surface-density cusp,
 * the bulge uses a smooth spherical radial falloff, disc luminosity weights toward arm tracers, and
 * stars span a warm amber-gold core/lane palette through warm cream arms to pale blue-white OB
 * tracers (driven by intrinsic `base` brightness rather than post-taper luminosity).
 *
 * 7 → 8: raised rich-tier disc population from 40,000 to 55,000 (within the 60,000 ceiling) and
 * rebalanced disc emission (`0.73 * base^0.42` in the disc, `0.72 * base` in the bulge, keeping
 * `base` for colour and size) so faint arm stars connect into continuous bands without blowing
 * out the core, losing hue separation, or filling inter-arm lanes (Layer 3 iteration 3).
 *
 * 8 → 9: **the sector rung is inserted** (ADR-0018, ADR-0023). A star's address is now
 * `galaxy.sector.star` instead of `galaxy.star`, so every deeper link is a different address and
 * must break loudly. The *picture* is deliberately unchanged: position and appearance key on the
 * rung-stripped address, and the disc law is untouched, so the drawn galaxy is byte-identical to
 * version 8. That is the whole point of the ADR, and `sector-rung.test.ts` pins it.
 *
 * 9 → 10: **galaxies vary** (ticket 06, work item 4). Radius is now per galaxy rather than the
 * constant `GALAXY_RADIUS_M`; arm count is 2–4 with a drawn pitch; the bulge has drawn fraction,
 * radius and flattening plus a bar; there is a halo tail and a dust-lane depression; and one
 * colour-age axis shifts a galaxy from red/quenched to blue/star-forming. Every galaxy is a
 * different sky — home included, which is now one sample of the law rather than a preset.
 *
 * Appearance is re-rolled by the shape change *on purpose*: brightness, colour and size now
 * depend on the same galaxy's drawn law (bulge radius, flattening, dust, colour age), so a galaxy
 * that is now visibly different must not keep a light profile fitted to the old fixed design.
 * `APPEARANCE_VERSION` moves with it for that reason, not because an address changed.
 */
export const GALAXY_VERSION = 10;

export type GalaxyTier = 'rich' | 'medium' | 'low';

/** The renderer's star budget. Each tier is a prefix of the richer tier's address list. */
export const GALAXY_TIER_STARS: Readonly<Record<GalaxyTier, { local: number; disc: number }>> =
  Object.freeze({
    rich: Object.freeze({ local: 5000, disc: 55000 }),
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
  return discPlanePoint(galaxy.centre, point);
}

export interface GalaxyStar {
  /**
   * The address of this light (ADR-0011). Every drawn star carries the address that produced it,
   * so the picture can never show a light that cannot be travelled to or linked. The home star's
   * address is the galaxy itself: its position is the frame origin, not a child's.
   */
  readonly address: Address;
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
  /** This galaxy's radius, metres. Framing, legibility and travel all read this, not a constant. */
  readonly radius: number;
  /** The drawn variation law this population was built from (arms, pitch, bulge, bar, colour). */
  readonly shape: GalaxyShape;
  readonly stars: readonly GalaxyStar[];
}

/**
 * Core taper scale for the exponential disc. Because `disc.ts` samples 1D radius exponentially,
 * 2D surface density rises as `1/r` near the centre and pinches into a bright diagonal cusp.
 * Scaling emission by `r / (r + DISC_CORE_RADIUS)` cancels the `1/r` singularity smoothly while
 * preserving a luminous inner disc with no dark moat.
 */
const DISC_CORE_RADIUS = 0.14;

/**
 * Walk the galaxy's children and draw one light per address (ADR-0011).
 *
 * The population used to be two sequential streams (`|local`, `|disc`) with a star's position
 * taken from the stream index. That made the number of stars a property of the *iterator*: the
 * 300th drawn star was a disc star only because it came 300th. Addresses cannot be attached to
 * that, so the direction is reversed — the address comes first, and its kind decides which law
 * places it (`starKind` in `placement.ts`).
 *
 * The tier cut is still a prefix, just of the address order rather than of a stream: a lower tier
 * keeps the first N children of each kind, and appearance is keyed on the child's own address, so
 * dropping the quality does not redraw a single star that survives (issue 04 D4).
 *
 * **The walk is over star identities, not addresses** (ADR-0023). The generator has to place a
 * star before it can know which sector that star's angle falls in, so it walks `level` and asks
 * `placedStarForIndex` for the position — which keys on `(galaxy, level)`, exactly the stream the
 * star had before the sector existed. Only then is the sector derived from the drawn azimuth and
 * the finished address built as `galaxy.sector.level`. Position, appearance and the disc law are
 * all untouched, so the picture is the same galaxy with new labels; the sector is a filing
 * cabinet, not a generator.
 *
 * The tier prefix therefore still holds: the walk is ordered by identity, and a sector is a pure
 * function of a star's own position.
 *
 * The home star is the exception: its address is the galaxy itself and its position is the frame
 * origin. It is not a child, so no child level is "the home star".
 */
export function generateGalaxy(seed: string, address: Address, tier: GalaxyTier): Galaxy {
  const counts = GALAXY_TIER_STARS[tier];
  // The address is normalised to its galaxy's own level here, not at the call sites: two stars in
  // one galaxy must return the same array from this function, and a caller that passes a deeply
  // nested address must not be able to get a private galaxy out of it (ADR-0011).
  const galaxyAddress = galaxyAddressOf(address);

  // The home star is a real member of the population and is marked so it can keep identity
  // through the crossfade (issue 04 D5). It is what the camera orbits at system scale, and its
  // position is the galaxy node's own placement — the frame origin.
  const home: GalaxyStar = {
    address: galaxyAddress,
    x: 0,
    y: 0,
    z: 0,
    brightness: 1,
    color: [1, 0.96, 0.9],
    size: 1.6,
    home: true,
  };

  // **The root is not a galaxy.** It sits above the level a galaxy is identified at, so it has no
  // children whose kind could be read: `starKind` would see a missing level. Before this guard
  // every root child fell back to "local", the disc list never filled, and a crafted `?addr=v1/`
  // (or an ordinary zoom-out to the top) hung the tab. At the root there is no galaxy population to
  // draw — return the home star alone, which the renderer already handles as an empty field.
  if (galaxyAddress.levels.length < GALAXY_DEPTH) {
    return {
      version: GALAXY_VERSION,
      tier,
      centre: { x: 0, y: 0, z: 0 },
      radius: GALAXY_RADIUS_MIN_M,
      shape: REFERENCE_SHAPE,
      stars: [home],
    };
  }

  // The frame and the disc law come from `disc.ts`, shared with `placement(seed, address)`. This
  // function owns the *population*: which children are drawn, how bright they are, what colour.
  const frame = galaxyFrame(seed, galaxyAddress);
  const { centre, radius, shape } = frame;

  const locals: GalaxyStar[] = [];
  const discs: GalaxyStar[] = [];

  // One child in `LOCAL_STAR_EVERY` is local, so any block of that many levels contains at least
  // one local and `LOCAL_STAR_EVERY - 1` disc children. Filling both lists therefore cannot need
  // more than `LOCAL_STAR_EVERY * (local + disc)` levels, and that constant is a provable bound on
  // the loop — not a magic number, and not a function of the address. The assertion after the walk
  // turns a broken kind rule into a clear error instead of an infinite loop.
  const maxLevels = LOCAL_STAR_EVERY * (counts.local + counts.disc);

  for (
    let level = 0;
    level < maxLevels && (locals.length < counts.local || discs.length < counts.disc);
    level += 1
  ) {
    const kind = starKindOfIndex(level);

    // Skip an identity whose field is already full: the walk can only stop once *both* fields are
    // full, and the scan is ordered, so a skipped level leaves every kept address untouched.
    if (kind === 'local') {
      if (locals.length >= counts.local) continue;
    } else if (discs.length >= counts.disc) {
      continue;
    }

    // Place the star first, then file it: the sector is derived from the angle the star is already
    // drawn at (ADR-0023), never chosen before it. `placedStarForIndex` keys on `(galaxy, level)`,
    // which is the stream the star had before the sector existed, so this cannot move a light.
    const placed = placedStarForIndex(frame, seed, galaxyAddress, level);
    const sector = sectorOfPoint(frame, placed.position);
    const child = starAddressAt(galaxyAddress, sector, level);
    const appearance = createRng(fnv1a32(appearanceKey(seed, child)));

    if (placed.kind === 'local') {
      const brightness = starBrightness(appearance);
      locals.push({
        address: child,
        x: placed.position.x,
        y: placed.position.y,
        z: placed.position.z,
        brightness,
        color: starColorLocal(brightness, appearance),
        size: 0.55 + brightness * 1.10,
        home: false,
      });
    } else {
      const base = starBrightness(appearance);
      const radialFrac = placed.fromCentre / radius;
      const armLum = placed.inBulge
        ? 1
        : placed.inHalo
          ? 0.42
          : 0.16 + 0.84 * placed.armMix ** 1.45;
      const radialScale = placed.inBulge
        ? bulgeProfile(radialFrac, shape)
        : discCoreTaper(radialFrac);
      // Dust is a lane *depression*, not extinction: the pass is additive with no depth buffer, so
      // it cannot occlude anything behind it. It is deepest where the star is furthest off an arm
      // (`armMix` 0), which is where a real dust lane sits, so the lanes read as dust rather than
      // as a global dimming.
      const dust =
        placed.inBulge || placed.inHalo
          ? 1
          : 1 - shape.dustDepth * (1 - placed.armMix) ** 2;
      const emitBase = placed.inBulge ? base * 0.72 : Math.pow(base, 0.42) * 0.73;
      const brightness = clampUnit(Math.max(0.008, emitBase * radialScale * armLum * dust));
      const size = placed.inBulge
        ? 0.85 + Math.min(1, base) * 0.65
        : placed.inHalo
          ? 0.5 + base * 0.5
          : 0.55 + base * (0.75 + 0.35 * placed.armMix);
      discs.push({
        address: child,
        x: placed.position.x,
        y: placed.position.y,
        z: placed.position.z,
        brightness,
        color: starColor(
          base,
          appearance,
          placed.armMix,
          placed.inBulge,
          placed.inHalo,
          radialFrac,
          shape,
        ),
        size,
        home: false,
      });
    }
  }

  if (locals.length !== counts.local || discs.length !== counts.disc) {
    throw new Error(
      `galaxy walk at ${formatAddress(galaxyAddress)} produced ` +
        `${locals.length}/${counts.local} local and ${discs.length}/${counts.disc} disc children`,
    );
  }

  return { version: GALAXY_VERSION, tier, centre, radius, shape, stars: [home, ...locals, ...discs] };
}

/**
 * The appearance stream version.
 *
 * `GALAXY_VERSION` used to be this number, because appearance is part of what a shared link pins.
 * The sector insertion bumped that constant to 9 while keeping this at 8: an *address* changed and
 * appearance did not, and the whole claim of ADR-0023 was that the gated galaxy stayed the same
 * picture with new labels.
 *
 * 8 → 9: the galaxy variation law (ticket 06, item 4) changes the appearance law itself. Bulge
 * radius and flattening now come from the galaxy, dust depresses the lanes, the halo tail is
 * tinted old, and one colour-age axis moves the whole palette. A galaxy that is a different object
 * must not keep a light profile fitted to the old fixed design, so this moves with it.
 */
const APPEARANCE_VERSION = 9;

/**
 * The appearance stream key for one child: brightness, colour and size, drawn from the address
 * alone. Separate from `placementKey` so a change to how a star looks does not move where it is,
 * and vice versa.
 *
 * **Keyed on the address with the sector rung removed**, like `placementKey`: `v1/4.<sector>.-7`
 * keys on `v1/4.-7`, the string this star had before the insertion. That is what keeps a star's
 * light byte-identical across the re-key.
 */
export function appearanceKey(seed: string, address: Address): string {
  return contentKey(seed, address, 'appearance', APPEARANCE_VERSION);
}

/** Smooth Gaussian bulge profile: luminous warm core tapering smoothly to the outer edge. */
function bulgeProfile(fraction: number, shape: GalaxyShape): number {
  const u = clampUnit(fraction / shape.bulgeRadiusFraction);
  return 0.15 + 0.85 * Math.exp(-3.8 * u * u);
}

/** Smoothly cancels the exponential disc's `1/r` surface-density cusp near the galactic centre. */
function discCoreTaper(fraction: number): number {
  const r = Math.max(0, fraction);
  const smooth = r / (r + DISC_CORE_RADIUS);
  return Math.min(1, Math.max(0.02, smooth * 1.4));
}

/** Heavy-tailed: most stars dim, a few bright. Never zero, or the field disappears. */
function starBrightness(rng: Rng): number {
  const u = rng.next();
  return 0.10 + 0.90 * u * u * u;
}

/** Local-field stellar colour: warm K/M dwarfs through white to pale blue-white stars. */
function starColorLocal(brightness: number, rng: Rng): readonly [number, number, number] {
  const jitter = rng.range(-0.035, 0.035);
  const t = clampUnit(brightness);
  const ob = smoothstepUnit(0.50, 0.95, t);
  return [
    clampUnit(1.0 - 0.12 * ob + jitter),
    clampUnit(0.68 + 0.26 * t + jitter),
    clampUnit(0.40 + 0.58 * t + jitter),
  ] as const;
}

/**
 * Intrinsic brightness + population + the galaxy's colour age → tint.
 *
 * `colourAge` is one axis for the whole galaxy: 0 is red and quenched, 1 is blue and
 * star-forming. It moves the lane warmth, how blue the arm's OB tracers can get, and how warm the
 * bulge reads, so two galaxies differ in *colour* as well as in shape and size — one palette per
 * galaxy rather than one palette per app.
 */
function starColor(
  baseBrightness: number,
  rng: Rng,
  armMix: number,
  inBulge: boolean,
  inHalo: boolean,
  radialFrac: number,
  shape: GalaxyShape,
): readonly [number, number, number] {
  const jitter = rng.range(-0.03, 0.03);
  const t = clampUnit(baseBrightness);
  const age = clampUnit(shape.colourAge);

  if (inBulge) {
    const u = clampUnit(radialFrac / shape.bulgeRadiusFraction);
    // Old galaxies get a deeper, redder nucleus; young ones stay closer to warm ivory.
    return [
      clampUnit(1.0 + jitter),
      clampUnit(0.68 + 0.20 * (1 - u) + 0.06 * t - 0.08 * age + jitter),
      clampUnit(0.32 + 0.26 * (1 - u) + 0.08 * t - 0.12 * age + jitter),
    ] as const;
  }

  if (inHalo) {
    // The halo tail is old stars: warm and dim, and it must not read as another arm.
    return [
      clampUnit(0.98 + jitter),
      clampUnit(0.66 + 0.10 * t - 0.06 * age + jitter),
      clampUnit(0.34 + 0.12 * t - 0.10 * age + jitter),
    ] as const;
  }

  const innerWarm = 1 - smoothstepUnit(0.08, 0.36, radialFrac);
  // The lane is where dust and old stars sit, so the age axis moves it first and most.
  const laneR = 1.0;
  const laneG = 0.58 + 0.12 * t + 0.10 * age;
  const laneB = 0.20 + 0.14 * t + 0.16 * age;

  // Young galaxies allow a much bluer OB tracer; old ones stop near pale cream.
  const obEnvelope = 0.45 + 0.55 * age;
  const ob = smoothstepUnit(0.18, 0.72, t) * (1 - 0.75 * innerWarm) * obEnvelope;
  const armR = 0.96 - 0.34 * ob;
  const armG = 0.88 - 0.02 * ob;
  const armB = 0.72 + 0.30 * ob;

  const armWeight = clampUnit(armMix ** 1.15) * (1 - 0.65 * innerWarm);
  return [
    clampUnit(laneR + (armR - laneR) * armWeight + jitter),
    clampUnit(laneG + (armG - laneG) * armWeight + jitter),
    clampUnit(laneB + (armB - laneB) * armWeight + jitter),
  ] as const;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstepUnit(edge0: number, edge1: number, value: number): number {
  const u = clampUnit((value - edge0) / (edge1 - edge0));
  return u * u * (3 - 2 * u);
}