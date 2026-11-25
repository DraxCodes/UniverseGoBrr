import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import { GALACTIC_PLANE_NORMAL, galaxyAddressOf, galaxyFrame } from '../universe/disc';
import { orbitTo } from '../input/orbit-controls';
import { cameraBasis } from '../render/camera';
import { GALAXY_RADIUS_M, galaxyFramingDistanceM } from '../render/scale';
import type { Camera } from '../state/url-state';
import {
  bearingOf,
  galaxyFraming,
  nearestAnchors,
  planZoomOut,
  type AnchorCandidate,
} from './navigation';

const GALAXY = parseAddressOrThrow('v1/0');
const STAR = parseAddressOrThrow('v1/0.3');

function candidate(text: string, x: number, y: number, z: number): AnchorCandidate {
  return { address: parseAddressOrThrow(text), x, y, z };
}

/** `yaw = 0, pitch = 0` looks down `-z`, so `-z` is straight ahead and `+x` is to the right. */
const LEVEL_EYE: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, target: { x: 0, y: 0, z: 0 } };

describe('nearestAnchors', () => {
  const stars = [
    candidate('v1/0.1', 100, 0, 0),
    candidate('v1/0.2', 30, 0, 0),
    candidate('v1/0.3', 0, 0, 0), // the place itself
    candidate('v1/0.4', 0, 0, 40),
    candidate('v1/0.5', 900, 0, 0),
  ];

  it('returns the nearest places, sorted, never the place itself', () => {
    const anchors = nearestAnchors(stars, STAR, { x: 0, y: 0, z: 0 }, 3);
    expect(anchors.map((a) => a.address.levels.join('.'))).toEqual(['0.2', '0.4', '0.1']);
    expect(Math.round(anchors[0]!.distanceM)).toBe(30);
    expect(anchors.some((a) => a.address.levels.join('.') === '0.3')).toBe(false);
  });

  it('carries the offset the bearing is measured from, matching the distance', () => {
    const anchors = nearestAnchors(stars, STAR, { x: 0, y: 0, z: 0 }, 1);
    const [nearest] = anchors;
    expect(nearest).toBeDefined();
    const { x, y, z } = nearest!.offset;
    expect(Math.hypot(x, y, z)).toBeCloseTo(nearest!.distanceM, 9);
  });

  it('measures from the place, not from the galaxy origin', () => {
    const anchors = nearestAnchors(stars, STAR, { x: 100, y: 0, z: 0 }, 2);
    // From x = 100 the nearest are 0.1 (0 m away, excluded as zero) and 0.2 (70 m), then 0.4 at
    // hypot(100, 0, 40) = 108 m.
    expect(anchors.map((a) => Math.round(a.distanceM))).toEqual([70, 108]);
  });

  it('marks the home star, whose address is the galaxy itself', () => {
    const anchors = nearestAnchors(
      [candidate('v1/0', 5, 0, 0), candidate('v1/0.7', 9, 0, 0)],
      STAR,
      { x: 0, y: 0, z: 0 },
      2,
    );
    expect(anchors.find((a) => a.home)?.address.levels).toEqual([0]);
  });

  it('is deterministic for equal distances', () => {
    const twins = [candidate('v1/0.8', 10, 0, 0), candidate('v1/0.1', -10, 0, 0)];
    const first = nearestAnchors(twins, STAR, { x: 0, y: 0, z: 0 }, 2);
    const shuffled = nearestAnchors([...twins].reverse(), STAR, { x: 0, y: 0, z: 0 }, 2);
    expect(first.map((a) => a.address.levels.join('.'))).toEqual(
      shuffled.map((a) => a.address.levels.join('.')),
    );
    expect(first.map((a) => a.address.levels.join('.'))).toEqual(['0.1', '0.8']);
  });

  it('returns nothing for a non-positive limit and ignores unusable distances', () => {
    expect(nearestAnchors(stars, STAR, { x: 0, y: 0, z: 0 }, 0)).toEqual([]);
    expect(nearestAnchors(stars, STAR, { x: 0, y: 0, z: 0 }, Number.NaN)).toEqual([]);
    const broken = [candidate('v1/0.6', Number.NaN, 0, 0)];
    expect(nearestAnchors(broken, STAR, { x: 0, y: 0, z: 0 }, 3)).toEqual([]);
  });

  it('never mutates its input', () => {
    const before = stars.map((s) => `${s.address.levels.join('.')}:${s.x}`);
    nearestAnchors(stars, STAR, { x: 0, y: 0, z: 0 }, 2);
    expect(stars.map((s) => `${s.address.levels.join('.')}:${s.x}`)).toEqual(before);
  });
});

describe('bearingOf', () => {
  it('calls straight ahead 0 and the right-hand side positive', () => {
    expect(bearingOf(LEVEL_EYE, { x: 0, y: 0, z: -10 }).bearingRad).toBeCloseTo(0, 12);
    expect(bearingOf(LEVEL_EYE, { x: 10, y: 0, z: 0 }).bearingRad).toBeCloseTo(Math.PI / 2, 12);
    expect(bearingOf(LEVEL_EYE, { x: -10, y: 0, z: 0 }).bearingRad).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('measures from the eye, not from the frame origin', () => {
    const eye = { ...LEVEL_EYE, x: 100, z: 0 };
    // From x = 100 the origin is off to the left: `−x` is negative bearing.
    expect(bearingOf(eye, { x: 0, y: 0, z: 0 }).bearingRad).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('reports elevation outside the view plane', () => {
    expect(bearingOf(LEVEL_EYE, { x: 0, y: 10, z: 0 }).elevationRad).toBeCloseTo(Math.PI / 2, 12);
    expect(bearingOf(LEVEL_EYE, { x: 0, y: -10, z: 0 }).elevationRad).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('turns with the camera, so a drag changes the reading', () => {
    const target = { x: 0, y: 0, z: -10 };
    // At yaw π/2 the camera looks along −x, so the target that was dead ahead is now to the
    // right. A bearing that did not turn here would be a bearing nobody could act on.
    expect(bearingOf({ ...LEVEL_EYE, yaw: Math.PI / 2 }, target).bearingRad).toBeCloseTo(
      Math.PI / 2,
      12,
    );
  });

  it('answers a degenerate target without NaN', () => {
    const bearing = bearingOf(LEVEL_EYE, { x: 0, y: 0, z: 0 });
    expect(bearing).toEqual({ bearingRad: 0, elevationRad: 0 });
  });
});

describe('planZoomOut', () => {
  it('takes a star to its galaxy', () => {
    const plan = planZoomOut(STAR, 1);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.address.levels).toEqual([0]);
  });

  it('refuses the root, because nothing outside a galaxy has a position', () => {
    const plan = planZoomOut(STAR, 0);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('no layout');
  });

  it('refuses a target that is where you already are', () => {
    const plan = planZoomOut(GALAXY, 1);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('already are');
  });

  it('refuses a finer level, naming the sector as a place without a scene', () => {
    const deep = parseAddressOrThrow('v1/0.3.1');
    const plan = planZoomOut(deep, 2);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('sector');
    expect(plan.reason).toContain('item 9');
  });

  it('does not blame the sector when the missing rung is a system or a body', () => {
    // The refusal is per-target, not one shared sentence. A system line (`v1/0.3.1`, keeping three
    // levels) has nothing to do with the sector work, and telling the reader about item 9 there
    // would point at the wrong missing feature.
    const deep = parseAddressOrThrow('v1/0.3.1.2.5');
    for (const depth of [3, 4]) {
      const plan = planZoomOut(deep, depth);
      expect(plan.ok, String(depth)).toBe(false);
      if (plan.ok) continue;
      expect(plan.reason, String(depth)).not.toContain('sector');
      expect(plan.reason, String(depth)).not.toContain('item 9');
      expect(plan.reason).toContain('galaxy');
    }
  });

  it('refuses a level an address does not have', () => {
    expect(planZoomOut(STAR, 5).ok).toBe(false);
    expect(planZoomOut(STAR, -1).ok).toBe(false);
    expect(planZoomOut(STAR, 1.5).ok).toBe(false);
  });
});

describe('galaxyFraming', () => {
  const RADIUS = GALAXY_RADIUS_M;
  const CENTRE = { x: 0.55 * RADIUS, y: 0, z: 0 };

  it('looks face-on, down the disc axis rather than world up', () => {
    const framing = galaxyFraming(CENTRE, RADIUS);
    const basis = cameraBasis(framing.yaw, framing.pitch);
    // The view axis is the disc normal, so the disc projects as a disc. The first version kept
    // the star's yaw and the eye landed almost in the plane, which drew a band.
    expect(Math.abs(
      basis.forward.x * GALACTIC_PLANE_NORMAL.x +
        basis.forward.y * GALACTIC_PLANE_NORMAL.y +
        basis.forward.z * GALACTIC_PLANE_NORMAL.z,
    )).toBeCloseTo(1, 12);
  });

  it('orbits from the side the boot camera is already above', () => {
    // Eye = -forward · d, so a positive y means the eye is above the plane, matching the boot
    // camera's ~36.6° downward look. Flipping the face would mirror the arms for no reason.
    const framing = galaxyFraming(CENTRE, RADIUS);
    expect(Math.sin(framing.yaw) * Math.cos(framing.pitch)).toBeCloseTo(
      GALACTIC_PLANE_NORMAL.x,
      12,
    );
    expect(-Math.sin(framing.pitch)).toBeCloseTo(GALACTIC_PLANE_NORMAL.y, 12);
    expect(framing.distanceM).toBeGreaterThan(0);
  });

  it('is far enough that every part of the disc is in front of the camera', () => {
    const framing = galaxyFraming(CENTRE, RADIUS);
    expect(framing.distanceM).toBeCloseTo(galaxyFramingDistanceM(0.55 * RADIUS, RADIUS), 6);
    // The nearest disc point to the eye is d - (|centre| + R) away: positive means nothing is
    // behind the camera or at a negative depth.
    expect(framing.distanceM).toBeGreaterThan(0.55 * RADIUS + RADIUS);
  });

  it('survives a centre at the origin (a galaxy with a centred disc)', () => {
    const framing = galaxyFraming({ x: 0, y: 0, z: 0 }, RADIUS);
    expect(Number.isFinite(framing.yaw)).toBe(true);
    expect(framing.distanceM).toBeCloseTo(galaxyFramingDistanceM(0, RADIUS), 6);
  });

  it('frames a small galaxy from a small distance, so both read as a whole disc', () => {
    // The point of the per-galaxy radius: the same view of a different-sized object. A small
    // galaxy framed from a large one's distance is a dot, and a large one framed from a small
    // one's distance is a crop.
    const small = galaxyFraming({ x: 0.55 * 0.5e20, y: 0, z: 0 }, 0.5e20);
    const large = galaxyFraming({ x: 0.55 * 9e20, y: 0, z: 0 }, 9e20);
    expect(small.distanceM).toBeLessThan(large.distanceM);
    expect(large.distanceM / small.distanceM).toBeCloseTo(18, 6);
    // Both subtend the same angular radius, which is what "framed the same" means.
    expect(Math.atan((1.55 * 0.5e20) / small.distanceM)).toBeCloseTo(
      Math.atan((1.55 * 9e20) / large.distanceM),
      6,
    );
  });

  it('keeps the eye exactly on the orbit ray, so the next drag does not snap', () => {
    const framing = galaxyFraming(CENTRE, RADIUS);
    const camera = orbitTo(framing.yaw, framing.pitch, framing.distanceM);
    const rebuild = orbitTo(camera.yaw, camera.pitch, Math.hypot(camera.x, camera.y, camera.z));
    expect(rebuild.x).toBeCloseTo(camera.x, 3);
    expect(rebuild.y).toBeCloseTo(camera.y, 3);
    expect(rebuild.z).toBeCloseTo(camera.z, 3);
  });
});

describe('a sector opens on the same frame it zooms out to', () => {
  it('frames the galaxy from the sector’s own address, exactly as zoom-out does', () => {
    // `main.ts`'s `openingCamera` for a non-star is `galaxyFraming(galaxyFrame(seed,
    // galaxyAddressOf(address)).centre)`; `commitZoomOut` builds the same camera from
    // `galaxyFrame(seed, plan.address)`. Those two must be one frame, or arriving at a sector by
    // link and by zoom-out would show two different pictures. Both derive the galaxy address the
    // same way, so evaluating the shared inputs here pins the agreement without importing `main`.
    const seed = 'ugb-0000';
    for (const sectorText of ['v1/4.0', 'v1/4.1', 'v1/4.2']) {
      const sector = parseAddressOrThrow(sectorText);
      // Link-arrival path: from the sector address.
      const sectorFrame = galaxyFrame(seed, galaxyAddressOf(sector));
      const fromSector = galaxyFraming(sectorFrame.centre, sectorFrame.radius);
      // Zoom-out path: from the galaxy ancestor the plan would return.
      const plan = planZoomOut(parseAddressOrThrow(`${sectorText}.-2.7`), 1);
      expect(plan.ok, sectorText).toBe(true);
      if (!plan.ok) continue;
      const galaxyFrameOf = galaxyFrame(seed, plan.address);
      const fromGalaxy = galaxyFraming(galaxyFrameOf.centre, galaxyFrameOf.radius);
      expect(fromSector.yaw, sectorText).toBeCloseTo(fromGalaxy.yaw, 12);
      expect(fromSector.pitch, sectorText).toBeCloseTo(fromGalaxy.pitch, 12);
      expect(fromSector.distanceM, sectorText).toBeCloseTo(fromGalaxy.distanceM, 6);
    }
  });
});
