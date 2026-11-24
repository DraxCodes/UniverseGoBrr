/**
 * Turns one galaxy plus a camera into camera-relative float32 impostors, and decides **when the
 * galaxy is legible**.
 *
 * Two rules meet here, and both are load-bearing:
 *
 * - **ADR-0008**: absolute star positions are doubles; the camera is subtracted in doubles and
 *   only the small, camera-relative result is rounded to float32. This module never uploads a
 *   home-relative or galaxy-relative position, so a local star's parallax survives at 10²¹ m.
 * - **Issue 04 D4**: the system→galaxy handoff is triggered by whether the galaxy's **arm
 *   contrast is readable**, not by the system's on-screen radius. A system-first trigger produces
 *   the astrolabe frame the council named. The `lod` below is the envelope in which the arm
 *   modulation resolves: the disc has to be seen as a compact object rather than an unbounded
 *   band, the arm band has to be wider than a few pixels, and the disc has to be inclined enough
 *   that the arms are not collapsed to a line.
 *
 * The population itself lives in `src/universe/galaxy.ts`; this file only packs it.
 */

import {
  cameraBasis,
  FOV_Y_RAD,
  multiply,
  reverseZProjection,
  viewFromBasis,
  type Vec3,
} from './camera';
import type { Camera } from '../state/url-state';
import { GALAXY_RADIUS_M } from './scale';
import {
  GALACTIC_PLANE_NORMAL,
  GALAXY_TIER_STARS,
  LOCAL_RADIUS_M,
  toDiscFrame,
  type Galaxy,
  type GalaxyStar,
  type GalaxyTier,
} from '../universe/galaxy';

/** Furthest the wheel may retreat. Far enough to frame the whole disc with the home star in it. */
export const GALAXY_MAX_DISTANCE_M = GALAXY_RADIUS_M * 12;

/**
 * The smallest a galaxy impostor may get, in device pixels **at 1080p**. A point that shrinks
 * below a pixel disappears between samples, and 45k sub-pixel dots read as stipple rather than a
 * disc; the minimum footprint is what keeps the field continuous. It is the first knob the budget
 * turns (issue 04 D6), and it is scaled by the viewport height in `writeGalaxyFrame` so 4K and
 * 1080p keep the same visual density instead of 4K becoming a sparser field.
 */
export const GALAXY_STAR_MIN_PX = 3.0;
/** The largest a dim impostor gets, before `size` spreads the brighter stars out further. */
export const GALAXY_STAR_MAX_PX = 5.0;
/**
 * Overall additive gain. The band is visible from the orrery (the thesis's "faint dust band")
 * but has to stay behind the orrery, not compete with it. Calibrated against the compact
 * Gaussian-core impostor PSF (~0.68x integrated energy of the earlier linear-halo sprite) so the
 * boot-frame dust band keeps its faint luminance while HDR galaxy arms stay rich.
 */
export const GALAXY_GAIN = 0.56;

/**
 * The local field's collapse window, in projected pixels. Five thousand stars sit inside 100 ly
 * of home, and at galaxy distances that whole sphere projects inside a single pixel — every
 * impostor at its full footprint, stacked on the same spot, saturating into a hard-edged white
 * disc larger than the home star's own glare. The local field is the system's side of the
 * handoff (issue 04 D4), so it fades out as it converges and the orrery's star is the point that
 * survives. The window is in pixels, not distance, so it tracks the frame rather than the camera.
 */
export const LOCAL_CONVERGENCE_MIN_PX = 1.5;
export const LOCAL_CONVERGENCE_FULL_PX = 8;

/**
 * A clear gap in the disc population around the home star, in pixels at 1080p, measured *out
 * from the star's glare*, not from its centre. `STAR_MIN_PX` gives the corona a 3.4 px radius, so
 * a 3 px gap sits inside the glare and clears nothing; the empty ring has to start outside it.
 * The disc's own 100 ly exclusion sphere projects to under a pixel at galaxy distance, which is
 * why the field otherwise touches the star and its 0.99 luminance ties with it.
 */
export const HOME_GAP_PX = 8.0;
/**
 * The gap is fully clear inside this fraction of the gap's **current** outer edge, closing to
 * nothing at that edge.
 *
 * Both edges must scale together, from `homeGapPx`. An earlier version derived the inner edge from
 * the constant `HOME_GAP_PX` while the outer edge was `HOME_GAP_PX * lod`, so once `lod` fell below
 * this fraction the inner edge was *larger* than the outer one. `smoothstep(edge0 > edge1, …)`
 * inverts rather than saturating: it keeps what is inside the ring and culls everything outside,
 * so the entire galaxy was erased at every intermediate legibility — the pitch sweep and the zoom
 * toward the system both lost the field from ~lod 0.68 down, and it returned only when the block
 * was skipped at lod 0 or the disc left the frustum. Keep them proportional and it cannot invert.
 */
const HOME_GAP_INNER = 0.7;

/** Per instance: camera-relative position (3), world-space quad radius (1), rgb+alpha (4). */
export const GALAXY_INSTANCE_FLOATS = 8;
/** The rich tier's local + disc stars; the home star is drawn by the orrery, not this pass. */
export const GALAXY_MAX_INSTANCES =
  GALAXY_TIER_STARS.rich.local + GALAXY_TIER_STARS.rich.disc;

/** The near plane must match `system-scene`'s, or the two passes disagree about depth. */
const NEAR_UNITS = 0.002;

/**
 * The measured arm modulation that counts as a *strong* two-arm field. The generator's rejection
 * sampling leaves a real but seed-dependent m=2 amplitude; this constant normalises it for the
 * reported contrast, so a weak field reads weaker without ever failing to resolve.
 *
 * Measured on the v4 population after the arm narrowing and per-star hue split: 0.427 for the
 * shipped seed, 0.422-0.441 across 12 seeds. The previous 0.16 was calibrated to the pre-narrowing
 * field (m=2 ~0.17) and, left in place, saturated every seed to 1.0 — the score stopped
 * discriminating. This is a HUD diagnostic only; it never reaches the shader.
 */
const ARM_CONTRAST_FULL = 0.42;

/** An arm band narrower than this many pixels cannot be read; wider than the second is full. */
const ARM_RESOLVED_MIN_PX = 5;
const ARM_RESOLVED_FULL_PX = 18;

/**
 * Legibility is measured from the **galactic centre**, not the home star: home sits at 0.55 R, so
 * using its distance would declare the camera "inside the disc" while it is already well outside
 * it (and vice versa on the far side).
 *
 * - Below `DISC_OUTSIDE_START` the camera is at or inside the edge: the "galaxy" is an all-sky
 *   band, i.e. a texture, and must not count.
 * - Above `DISC_OUTSIDE_FULL` the disc is clearly a compact object.
 * - `DISC_OVERFILL_START/END` cap the other end: at 1.02 R the disc's angular radius is ~78° and
 *   a wall of stars is not a spiral either, so the score only reaches 1 once the edge is inside
 *   roughly a frame.
 */
const DISC_OUTSIDE_START = 1.02;
const DISC_OUTSIDE_FULL = 1.5;
const DISC_OVERFILL_START = 0.55;
const DISC_OVERFILL_END = 0.95;

export interface GalaxyLegibility {
  /** 0 at the orrery, 1 once the galaxy is framed and its arms resolve. Drives every pipeline. */
  readonly lod: number;
  /** The observable arm contrast: legibility with the measured population modulation applied. */
  readonly contrast: number;
  /** 1 when the eye is outside the disc and it is not overfilling the frame. */
  readonly fit: number;
  /** 1 when an arm is at least a few pixels wide. */
  readonly resolved: number;
  /** 1 when the disc is inclined enough that two arms are two arms. */
  readonly inclination: number;
  /** The population's measured m=2 modulation, normalised to 0..1. */
  readonly modulation: number;
}

export interface GalaxyFrame {
  readonly instances: Float32Array;
  readonly count: number;
  readonly lod: number;
  readonly contrast: number;
  /**
   * How much of the frame the galaxy owns, ignoring which way the disc is turned: `fit × resolved`.
   *
   * `lod` folds in `inclination`, which is right for the arms - an edge-on disc has no arms to
   * read - but wrong for *identity*. The tilted disc makes a straight zoom-out from the default
   * view edge-on, and `lod` then sits at ~0.02 while the whole galaxy fills the frame. The HUD's
   * scene row has to say "one galaxy" there without claiming the arms resolved, so it reads this
   * instead of `lod`.
   */
  readonly identity: number;
  /** Per-seed apparent-area exposure factor (`1.0` at `lod === 0` so Layer 2 is untouched). */
  readonly exposure: number;
  /** The same reverse-Z projection the orrery uses, so the two passes share one camera. */
  readonly viewProjection: Float32Array;
  readonly cameraRight: Vec3;
  readonly cameraUp: Vec3;
}

/**
 * The static, measured arm modulation: the m=2 Fourier amplitude of the disc's azimuthal density
 * around the galactic centre. This is read off the actual population, not a constant, so a seed
 * whose arms are weak says so; it is computed once per galaxy.
 */
const modulationCache = new WeakMap<Galaxy, number>();

export function armModulation(galaxy: Galaxy): number {
  const cached = modulationCache.get(galaxy);
  if (cached !== undefined) return cached;

  // The spiral winds with radius (the generator's `winding = r/scale · 2.4`), so one DFT over
  // the whole annulus would cancel its own arms. Measure per radial slice and average, weighted
  // by how many stars each slice holds.
  const bins = 20;
  const inner = 0.2 * GALAXY_RADIUS_M;
  const outer = 1.0 * GALAXY_RADIUS_M;
  const cosine = new Float64Array(bins);
  const sine = new Float64Array(bins);
  const counts = new Float64Array(bins);

  for (const star of galaxy.stars) {
    // The local field is a small sphere around home, not the disc; including it would put one
    // hot cell in the middle of the annulus and measure nothing useful.
    if (Math.hypot(star.x, star.y, star.z) < LOCAL_RADIUS_M * 1.5) continue;

    // The disc's own frame: radius and azimuth are defined in the plane, which the layer-3
    // orientation has inclined away from world `x`/`z`.
    const relative = toDiscFrame(galaxy, star);
    const radius = Math.hypot(relative.x, relative.y, relative.z);
    if (radius < inner || radius > outer) continue;

    const bin = Math.min(bins - 1, Math.floor(((radius - inner) / (outer - inner)) * bins));
    const azimuth = Math.atan2(relative.z, relative.x);
    cosine[bin]! += Math.cos(2 * azimuth);
    sine[bin]! += Math.sin(2 * azimuth);
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

  const value = total > 0 ? weighted / total : 0;
  modulationCache.set(galaxy, value);
  return value;
}

/**
 * Where the crossfade is, and why. Pure and GPU-free, so the trigger can be tested without a
 * frame: the two failure modes (a system-first ramp and a pop) are both test failures here.
 */
export function galaxyLegibility(
  galaxy: Galaxy,
  camera: Camera,
  viewportHeightPx: number,
): GalaxyLegibility {
  const basis = cameraBasis(camera.yaw, camera.pitch);
  const focalPx = viewportHeightPx / (2 * Math.tan(FOV_Y_RAD / 2));

  // Face-on is legible; edge-on collapses the arms into a line and must not count. Measured
  // against the disc's own axis: after the galactic plane is inclined, world `+y` is no longer
  // the disc's normal and `forward.y` would score an identical view differently.
  const facing = Math.abs(
    basis.forward.x * GALACTIC_PLANE_NORMAL.x +
      basis.forward.y * GALACTIC_PLANE_NORMAL.y +
      basis.forward.z * GALACTIC_PLANE_NORMAL.z,
  );
  const inclination = smoothstep(0.1, 0.3, facing);

  // Distance from the eye to the **disc centre**, in doubles: the home star is not the centre.
  const toCentre = {
    x: galaxy.centre.x - camera.x,
    y: galaxy.centre.y - camera.y,
    z: galaxy.centre.z - camera.z,
  };
  const centreDistance = Math.hypot(toCentre.x, toCentre.y, toCentre.z);

  // The disc has to be outside the eye (a compact object in front) and not so close that it
  // overfills the frame into a wall of stars.
  const outside = smoothstep(
    DISC_OUTSIDE_START * GALAXY_RADIUS_M,
    DISC_OUTSIDE_FULL * GALAXY_RADIUS_M,
    centreDistance,
  );
  const angularRadius =
    centreDistance > 0 ? GALAXY_RADIUS_M / centreDistance : Number.POSITIVE_INFINITY;
  const notOverfilled = 1 - smoothstep(DISC_OVERFILL_START, DISC_OVERFILL_END, angularRadius);
  const fit = outside * notOverfilled;

  // An arm's linear width is roughly half the radius it sits at; below a few pixels the
  // modulation survives in the population but not in the image.
  const armBandPx =
    centreDistance > 0
      ? 0.5 * (GALAXY_RADIUS_M / centreDistance) * focalPx
      : Number.POSITIVE_INFINITY;
  const resolved = smoothstep(ARM_RESOLVED_MIN_PX, ARM_RESOLVED_FULL_PX, armBandPx);

  const modulation = clamp01(armModulation(galaxy) / ARM_CONTRAST_FULL);
  const lod = clamp01(fit * resolved * inclination);
  const contrast = clamp01(lod * modulation);

  return { lod, contrast, fit, resolved, inclination, modulation };
}

export function galaxyLod(galaxy: Galaxy, camera: Camera, viewportHeightPx: number): number {
  return galaxyLegibility(galaxy, camera, viewportHeightPx).lod;
}

/**
 * Pack the tier's stars into `out` as camera-relative impostors.
 *
 * The whole population is recomputed from its double positions each time the camera moves, for
 * two reasons: the local field needs real parallax (an f32 bake cannot hold AU-scale motion at
 * 10²¹ m), and one camera-relative path is simpler and more precise than a second, baked buffer.
 * The tier is a prefix of the generation stream, so a quality drop only cuts the tail.
 */
export function writeGalaxyFrame(
  out: Float32Array,
  galaxy: Galaxy,
  tier: GalaxyTier,
  camera: Camera,
  scaleM: number,
  viewportHeightPx: number,
  aspect: number,
  legibility: GalaxyLegibility = galaxyLegibility(galaxy, camera, viewportHeightPx),
): GalaxyFrame {
  const counts = GALAXY_TIER_STARS[tier];
  const focalPx = viewportHeightPx / (2 * Math.tan(FOV_Y_RAD / 2));
  const basis = cameraBasis(camera.yaw, camera.pitch);
  const viewProjection = multiply(reverseZProjection(aspect, NEAR_UNITS), viewFromBasis(basis));

  // The faint population fills in behind the bright arm tracers as the crossfade proceeds. The
  // threshold moves smoothly with `lod`, so there is no brightness class that appears at once —
  // and its window closes to zero at full legibility, or the dimmest third of the disc would stay
  // suppressed in the finished galaxy and the field would read as stipple.
  //
  // `0.06` is calibrated against the population, not picked: disc brightness is
  // `0.10 + 0.90·u³`, so the *median* disc star is ≈0.21. At 0.34 (gate iteration 1's value) more
  // than half the in-frame boot stars were withheld — and since only ≈750 of 40 000 disc
  // impostors fall in the orrery's 50°×80° FOV, that withheld majority was the whole band. With
  // the threshold down at 0.06 the plane's faint stripe is drawn instead of culled.
  const threshold = 0.06 * (1 - legibility.lod);
  // No floor: the window has to close to exactly zero at lod 1, or the dimmest stars stay partly
  // suppressed in the finished galaxy. With a `max(0.02, …)` floor a nucleus star at 0.004
  // brightness (dim bulge times the nucleus gradient) sat inside a 0.02-wide window and never
  // reached full reveal — 1650 of 40 000 disc stars were held back at lod 1.
  const revealWidth = 0.24 * (1 - legibility.lod);

  // How many pixels the whole local field spans around home. Its stars all project inside this
  // radius, so once it is a couple of pixels they are one saturated dot on top of the star.
  const localFieldPx =
    (LOCAL_RADIUS_M * focalPx) / Math.max(Math.hypot(camera.x, camera.y, camera.z), 1e-9);
  const localConvergence = smoothstep(
    LOCAL_CONVERGENCE_MIN_PX,
    LOCAL_CONVERGENCE_FULL_PX,
    localFieldPx,
  );

  let write = 0;
  // Home is the frame origin, so its camera-relative position is the negated camera. Hoisted:
  // every star measures its angular separation from this one point.
  const homeRel = { x: -camera.x / scaleM, y: -camera.y / scaleM, z: -camera.z / scaleM };
  const homeDistance = Math.hypot(homeRel.x, homeRel.y, homeRel.z);
  // The gap only exists once the fields share a frame; at lod 0 the galaxy is a band behind the
  // orrery and carving a hole in it would be a change to Layer 2's frame for no reason.
  const homeGapPx = HOME_GAP_PX * legibility.lod;

  // Balance apparent surface brightness across seeds whose galactic centres sit at slightly
  // different distances from the fixed camera (`centreDistance / 2.6 R` varies ~2.3..3.0 R).
  // Blended in by `legibility.lod` so Layer 2 / boot-frame `exposure` stays exactly 1.0.
  const centreDistance = Math.hypot(
    galaxy.centre.x - camera.x,
    galaxy.centre.y - camera.y,
    galaxy.centre.z - camera.z,
  );
  const distRatio = centreDistance / (2.6 * GALAXY_RADIUS_M);
  const rawExposure = Math.min(1.55, Math.max(0.68, Math.pow(Math.max(distRatio, 0.35), -1.25)));
  const exposure = 1 + (rawExposure - 1) * legibility.lod;
  const sizeBias =
    (distRatio < 1 ? (1 - distRatio) * 0.6 : -(distRatio - 1) * 0.45) * legibility.lod;

  // At lod 0 (boot/orrery view), the disc forms the faint sky dust band behind the isotropic
  // local field. Compensate for the arm-luminosity weighting at lod 0 so the band's anisotropy
  // does not dip, blending cleanly to 1.0 by lod 1 so galaxy-scale frames are untouched.
  const discBootLift = 1 + 0.25 * (1 - legibility.lod);

  const pack = (star: GalaxyStar, fieldReveal = 1, emissionScale = 1): void => {
    // The system's own star is the identity impostor: the orrery's glare quad keeps a minimum
    // pixel footprint and stays on screen through the handoff. Drawing it here as well would
    // double-expose the one point the viewer is supposed to find.
    if (star.home) return;

    const x = (star.x - camera.x) / scaleM;
    const y = (star.y - camera.y) / scaleM;
    const z = (star.z - camera.z) / scaleM;
    const distance = Math.hypot(x, y, z);

    // `size` runs 0.55..1.65 in the generator; map it to a 1080p footprint, then scale with the
    // viewport so the same fraction of the frame is covered at any height.
    const sizeFraction = clamp01((star.size - 0.55) / 1.1);
    const adjustedSize = clamp01(sizeFraction + sizeBias);
    const footprintPx =
      (GALAXY_STAR_MIN_PX + (GALAXY_STAR_MAX_PX - GALAXY_STAR_MIN_PX) * adjustedSize) *
      (viewportHeightPx / 1080);
    // A world-space radius that projects to the footprint. Never zero: the quad would vanish.
    const radius = Math.max((footprintPx * distance) / focalPx, 1e-12);

    let reveal = smoothstep(threshold, threshold + revealWidth, star.brightness) * fieldReveal;

    // Clear a ring around the home star. At galaxy distance the disc's own 100 ly exclusion
    // sphere projects to under a pixel, so without this the nearest impostors sit directly on
    // the star and the field's 0.99 luminance ties with its 0.56. The cue the gate asked for is
    // empty space: one point with a gap the eye can find.
    if (homeGapPx > 0 && homeDistance > 0) {
      const separation = {
        x: homeRel.x - x,
        y: homeRel.y - y,
        z: homeRel.z - z,
      };
      const along =
        separation.x * basis.forward.x +
        separation.y * basis.forward.y +
        separation.z * basis.forward.z;
      const perpendicular = Math.hypot(
        separation.x - along * basis.forward.x,
        separation.y - along * basis.forward.y,
        separation.z - along * basis.forward.z,
      );
      const gapPx = (perpendicular * focalPx) / Math.max(homeDistance, 1e-12);
      reveal *= smoothstep(homeGapPx * HOME_GAP_INNER, homeGapPx, gapPx);
    }

    // The star's *emission amplitude* is its brightness, folded into the RGB and uploaded here.
    // This is the fix for the clipped nucleus: `fs_star` multiplies the colour by
    // `color.a * gain`, and `color.a` is the reveal, which is 1.0 for every star once the
    // crossfade completes. So before this, a brightness-0.02 nucleus star and a brightness-1 arm
    // star emitted the *same* light: 289 impostors stacking at the disc centre summed to 12.8 on
    // an 8-bit target and clipped into a flat 109 px white plateau, and the disc read as a field
    // of identical dots. Scaling the colour by brightness (a uniform scale, so the hue is exactly
    // preserved) makes `brightness` the luminosity it was always meant to be.
    const amplitude = clamp01(star.brightness) * emissionScale;
    const base = write * GALAXY_INSTANCE_FLOATS;
    out[base + 0] = x;
    out[base + 1] = y;
    out[base + 2] = z;
    out[base + 3] = radius;
    out[base + 4] = star.color[0] * amplitude;
    out[base + 5] = star.color[1] * amplitude;
    out[base + 6] = star.color[2] * amplitude;
    // The global gain stays in the uniform; this is the per-star reveal times the field's own
    // convergence (the local field fades as it collapses into the home star).
    out[base + 7] = reveal;
    write += 1;
  };

  // Home is index 0; each field is a prefix of its own stream. The **layout** is the tier the
  // galaxy object was generated at, not the tier being drawn: the watchdog may ask for fewer
  // stars than were generated, so the disc block always starts after the generated local block.
  const layout = GALAXY_TIER_STARS[galaxy.tier];
  const localEnd = 1 + Math.min(counts.local, layout.local);
  const discStart = 1 + layout.local;
  const discEnd = discStart + Math.min(counts.disc, layout.disc);
  for (let index = 1; index < localEnd && index < galaxy.stars.length; index += 1) {
    pack(galaxy.stars[index]!, localConvergence);
  }
  for (let index = discStart; index < discEnd && index < galaxy.stars.length; index += 1) {
    pack(galaxy.stars[index]!, 1, discBootLift);
  }

  return {
    instances: out,
    count: write,
    lod: legibility.lod,
    contrast: legibility.contrast,
    identity: legibility.fit * legibility.resolved,
    exposure,
    viewProjection,
    cameraRight: basis.right,
    cameraUp: basis.up,
  };
}

/**
 * The frame-time watchdog's decision, as a pure function so the drop is testable without a GPU.
 * A sustained frame over 40 ms (25 fps) costs the rich tier; the count cut is cheap because the
 * tiers are prefixes. This is issue 04 D6's "drop a tier, do not stall into a TDR".
 */
export const WATCHDOG_FRAME_MS = 40;
export const WATCHDOG_SUSTAINED_FRAMES = 60;

export function nextQualityTier(
  tier: GalaxyTier,
  frameMsEma: number,
  sustainedFrames: number,
): GalaxyTier | null {
  if (!(frameMsEma > WATCHDOG_FRAME_MS) || sustainedFrames < WATCHDOG_SUSTAINED_FRAMES) return null;
  if (tier === 'rich') return 'medium';
  if (tier === 'medium') return 'low';
  return null;
}

/**
 * One double's quantum at a given magnitude. Used by the precision test: the crossfade has to
 * complete while a nearby star's separation is still thousands of these, or the galaxy pass
 * reintroduces the lock-to-centre the camera-relative path exists to prevent.
 */
export function f64Ulp(value: number): number {
  const magnitude = Math.abs(value);
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) return 0;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 52);
}

/** One float32's quantum at a given magnitude, for the upload side of the same bound. */
export function f32Ulp(value: number): number {
  const magnitude = Math.abs(value);
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) return 0;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 23);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}