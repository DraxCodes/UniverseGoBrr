import { describe, expect, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import {
  NEAR_UNITS,
  STAR_CORE_RADIUS,
  STAR_DISPLAY_RADIUS,
  STAR_MIN_PX,
  buildSceneFrame,
  defaultSystemCamera,
  displayScaleM,
  hueToRgb,
  planetColor,
} from './system-scene';
import { FOV_Y_RAD, cameraBasis, projectPoint } from './camera';
import {
  AU_M,
  displayOrbitRadius,
  generateSystem,
  type StarSystem,
} from '../universe/system';

const SYSTEM: StarSystem = generateSystem('ugb-0000', parseAddressOrThrow('v1/4.-2.7'));
const ASPECT = 16 / 9;

describe('scene assembly', () => {
  it('puts the star where the camera says it is, in display units', () => {
    const camera = defaultSystemCamera(SYSTEM);
    const scene = buildSceneFrame(SYSTEM, camera, 0, ASPECT);
    const scale = displayScaleM(SYSTEM);

    expect(scene.starCenter.x).toBeCloseTo(-camera.x / scale, 12);
    expect(scene.starCenter.y).toBeCloseTo(-camera.y / scale, 12);
    expect(scene.starCenter.z).toBeCloseTo(-camera.z / scale, 12);
  });

  it('places every planet on its displayed orbit radius', () => {
    const camera = defaultSystemCamera(SYSTEM);
    const scene = buildSceneFrame(SYSTEM, camera, 12_345, ASPECT);
    const scale = displayScaleM(SYSTEM);

    scene.planets.forEach((planet, index) => {
      // Undo the camera-relative transform: centre + camera gives the world position again.
      const worldX = planet.center.x * scale + camera.x;
      const worldZ = planet.center.z * scale + camera.z;
      const radiusUnits = Math.hypot(worldX, worldZ) / scale;
      const expected = displayOrbitRadius(SYSTEM.planets[index]!, SYSTEM);
      expect(radiusUnits).toBeCloseTo(expected, 9);
      expect(scene.orbitRadii[index]).toBeCloseTo(expected, 12);
    });
  });

  it('keeps every uploaded coordinate small, even for a camera at 10¹¹ m', () => {
    // The whole point of ADR-0008: nothing absolute reaches the GPU. Every float32 here must be
    // a fraction of a unit, not a fraction of an astronomical unit.
    const scale = displayScaleM(SYSTEM);
    const camera = {
      x: 1.49e11,
      y: 2.5 * scale,
      z: 3e11,
      yaw: 0.4,
      pitch: -0.6,
      target: { x: 0, y: 0, z: 0 },
    };
    const scene = buildSceneFrame(SYSTEM, camera, 1e6, ASPECT);

    const magnitudes = [
      ...scene.planets.flatMap((planet) => [
        Math.abs(planet.center.x),
        Math.abs(planet.center.y),
        Math.abs(planet.center.z),
        planet.radius,
      ]),
      Math.abs(scene.starCenter.x),
      Math.abs(scene.starCenter.y),
      Math.abs(scene.starCenter.z),
    ];

    for (const magnitude of magnitudes) {
      expect(Number.isFinite(magnitude)).toBe(true);
      // At 13 AU = 1 unit, a camera 2 AU away is ~0.15 units. Nothing should approach float32's
      // useful range at this scale.
      expect(magnitude).toBeLessThan(1e4);
    }
  });

  it('moves planets between two times, and returns to the same place after a full period', () => {
    const camera = defaultSystemCamera(SYSTEM);
    const planet = SYSTEM.planets[0]!;
    const a = buildSceneFrame(SYSTEM, camera, 0, ASPECT).planets[0]!;
    const b = buildSceneFrame(SYSTEM, camera, planet.orbitalPeriodS / 4, ASPECT).planets[0]!;
    expect(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z)).toBeGreaterThan(1e-6);

    const wrapped = buildSceneFrame(SYSTEM, camera, planet.orbitalPeriodS, ASPECT).planets[0]!;
    expect(wrapped.center.x).toBeCloseTo(a.center.x, 9);
    expect(wrapped.center.z).toBeCloseTo(a.center.z, 9);
  });

  it('spins each planet at its own rate', () => {
    const camera = defaultSystemCamera(SYSTEM);
    const oneHour = 3600;
    const scene = buildSceneFrame(SYSTEM, camera, oneHour, ASPECT);
    scene.planets.forEach((planet, index) => {
      const source = SYSTEM.planets[index]!;
      expect(planet.spinRad).toBeCloseTo((2 * Math.PI * oneHour) / source.spinPeriodS, 12);
    });
  });

  it('frames the whole system inside the viewport', () => {
    // A default framing that crops the outermost orbit is a bug you only see in a screenshot.
    const camera = defaultSystemCamera(SYSTEM);
    const scene = buildSceneFrame(SYSTEM, camera, 0, ASPECT);
    const basis = cameraBasis(camera.yaw, camera.pitch);

    for (const planet of scene.planets) {
      // Depth along the view direction: `dot(p, forward)` is positive in front of the camera.
      const depth =
        planet.center.x * basis.forward.x +
        planet.center.y * basis.forward.y +
        planet.center.z * basis.forward.z;
      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeGreaterThan(10 * NEAR_UNITS);

      // The real check: the projection keeps it on screen, not merely in front.
      const projected = projectPoint(scene.viewProjection, planet.center);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
    }
  });

  it('draws the outermost orbit across a useful share of the frame', () => {
    // An orrery that renders at a third of the viewport is a thumbprint, not a system; one whose
    // ring leaves the frame is a crop. Both ends are asserted, because both were bugs.
    const camera = defaultSystemCamera(SYSTEM);
    const scene = buildSceneFrame(SYSTEM, camera, 0, ASPECT);
    const outermost = scene.planets[scene.planets.length - 1]!;
    const scale = displayScaleM(SYSTEM);

    let minX = Infinity;
    let maxX = -Infinity;
    let maxAbsY = 0;
    for (let step = 0; step < 128; step += 1) {
      const angle = (step / 128) * Math.PI * 2;
      const projected = projectPoint(scene.viewProjection, {
        x: Math.cos(angle) - camera.x / scale,
        y: -camera.y / scale,
        z: Math.sin(angle) - camera.z / scale,
      });
      minX = Math.min(minX, projected.x);
      maxX = Math.max(maxX, projected.x);
      maxAbsY = Math.max(maxAbsY, Math.abs(projected.y));
    }

    expect(maxX - minX).toBeGreaterThan(0.6);
    expect(maxAbsY).toBeLessThan(0.95);
    expect(outermost.center.y).toBeCloseTo(-camera.y / scale, 9);
  });

  it('holds the framing at 16:9, 21:9 and 4:3', () => {
    // The near edge of the orbit is what clips, and it is driven by the vertical field of view,
    // so a wider or narrower window must not push the ring out of frame.
    for (const aspect of [16 / 9, 21 / 9, 4 / 3]) {
      const camera = defaultSystemCamera(SYSTEM);
      const scene = buildSceneFrame(SYSTEM, camera, 0, aspect);
      const scale = displayScaleM(SYSTEM);
      let maxAbs = 0;
      for (let step = 0; step < 128; step += 1) {
        const angle = (step / 128) * Math.PI * 2;
        const projected = projectPoint(scene.viewProjection, {
          x: Math.cos(angle) - camera.x / scale,
          y: -camera.y / scale,
          z: Math.sin(angle) - camera.z / scale,
        });
        maxAbs = Math.max(maxAbs, Math.abs(projected.x), Math.abs(projected.y));
      }
      expect(maxAbs, `aspect ${aspect.toFixed(2)}`).toBeLessThan(1);
    }
  });

  it('reports the orrery exaggeration for the HUD, per planet', () => {
    const scene = buildSceneFrame(SYSTEM, defaultSystemCamera(SYSTEM), 0, ASPECT);
    for (const planet of scene.planets) {
      expect(planet.exaggeration).toBeGreaterThan(100);
      expect(planet.realRadiusM).toBeGreaterThan(0);
      expect(planet.semiMajorAxisM / AU_M).toBeGreaterThan(0.1);
    }
  });
});

describe('presentation constants', () => {
  it('puts the near plane well in front of every body it frames', () => {
    // Near-vs-radius is the wrong comparison: what matters is the distance from the camera to
    // the nearest surface, because that is what must not fall inside the near plane.
    const camera = defaultSystemCamera(SYSTEM);
    const scale = displayScaleM(SYSTEM);
    const scene = buildSceneFrame(SYSTEM, camera, 0, ASPECT);
    const eye = { x: camera.x / scale, y: camera.y / scale, z: camera.z / scale };

    let nearestSurface = Infinity;
    for (const planet of scene.planets) {
      const centre = { x: eye.x + planet.center.x, y: eye.y + planet.center.y, z: eye.z + planet.center.z };
      const surface = Math.hypot(centre.x - eye.x, centre.y - eye.y, centre.z - eye.z) - planet.radius;
      nearestSurface = Math.min(nearestSurface, surface);
    }

    expect(nearestSurface).toBeGreaterThan(100 * NEAR_UNITS);
    expect(STAR_DISPLAY_RADIUS).toBeGreaterThan(NEAR_UNITS);
  });

  it('gives the star an occluding core strictly inside its glare', () => {
    // The core is the only part of the star that writes depth. If it ever grew to the glare's
    // radius the billboard's flat depth would start clipping bodies in front of the star; if it
    // vanished, planets behind the sun would paint over it again. The glare quad is wider than
    // the core (it was widened to 0.135 for the corona's tail) and the occluder did not move.
    expect(STAR_CORE_RADIUS).toBeGreaterThan(0);
    expect(STAR_CORE_RADIUS).toBeLessThan(STAR_DISPLAY_RADIUS);
    expect(STAR_CORE_RADIUS).toBeLessThan(0.5 * STAR_DISPLAY_RADIUS);

    const scene = buildSceneFrame(SYSTEM, defaultSystemCamera(SYSTEM), 0, ASPECT);
    expect(scene.starCoreRadius).toBe(STAR_CORE_RADIUS);
    expect(scene.starRadius).toBe(STAR_DISPLAY_RADIUS);
  });

  it('keeps the home star a findable point through the crossfade', () => {
    // At galaxy distance the glare quad is far below a pixel; the identity floor is what stops
    // "the one point the eye can find" from becoming no point at all (issue 04 D5).
    const distance = 6e21;
    const pitch = -0.639;
    const camera = {
      x: 0,
      y: -Math.sin(pitch) * distance,
      z: Math.cos(pitch) * distance,
      yaw: 0,
      pitch,
      target: { x: 0, y: 0, z: 0 },
    };
    const scene = buildSceneFrame(SYSTEM, camera, 0, ASPECT, 1080, 0.9);
    expect(scene.lod).toBe(0.9);
    expect(scene.starRadius).toBeGreaterThan(STAR_DISPLAY_RADIUS);

    const scale = displayScaleM(SYSTEM);
    const distanceUnits = Math.hypot(camera.x, camera.y, camera.z) / scale;
    const focalPx = 1080 / (2 * Math.tan(FOV_Y_RAD / 2));
    expect((scene.starRadius / distanceUnits) * focalPx).toBeCloseTo(STAR_MIN_PX, 6);
  });

  it('maps hues to bounded, unsaturated colours', () => {
    for (const hue of [0, 0.15, 0.5, 0.83, 1, 1.4, -0.3]) {
      const [r, g, b] = hueToRgb(hue);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        // Damped on purpose: nothing is fully saturated, so the star stays the brightest thing.
        expect(channel).toBeLessThanOrEqual(0.56);
      }
    }
  });

  it('gives each class its own colour band, so a gas giant is never lime green', () => {
    // Colour follows class, not the hue wheel. The eye rejects a green gas giant before it can
    // say why, and a generator free to pick any hue will produce one.
    const wide: StarSystem = generateSystem('ugb-0000', parseAddressOrThrow('v1/4.-2.7'));
    for (const planet of wide.planets) {
      const [r, g, b] = planetColor(planet);
      switch (planet.class) {
        case 'gas':
          // Amber to cream, or the occasional pale blue: red at least as strong as blue.
          expect(r, `gas ${planet.name}`).toBeGreaterThanOrEqual(b - 0.02);
          break;
        case 'ice':
          // Pale blue: blue at least as strong as red.
          expect(b, `ice ${planet.name}`).toBeGreaterThanOrEqual(r - 0.02);
          break;
        case 'ocean':
          // Blue-green: blue dominates.
          expect(b, `ocean ${planet.name}`).toBeGreaterThan(r);
          break;
        default:
          // Rock and super-earth run rust to grey.
          expect(b, `${planet.class} ${planet.name}`).toBeLessThanOrEqual(g + 0.06);
      }
    }
  });
});