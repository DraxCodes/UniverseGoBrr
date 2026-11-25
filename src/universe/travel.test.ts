import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddressOrThrow } from '../frame/address';
import { LY_M } from './disc';
import { placement } from './placement';
import {
  TRAVEL_SPEED_M_PER_S,
  WORMHOLE_ELAPSED_S,
  methodForPair,
  planTravel,
  rootPosition,
} from './travel';

const SEED = 'ugb-0000';
const GALAXY = parseAddressOrThrow('v1/0');

function distance(a: string, b: string): number {
  const from = placement(SEED, parseAddressOrThrow(a));
  const to = placement(SEED, parseAddressOrThrow(b));
  if (!from || !to) throw new Error(`${a} or ${b} has no position`);
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

describe('speed table', () => {
  it('is ADR-0010 as confirmed, in metres per second', () => {
    expect(TRAVEL_SPEED_M_PER_S.impulse).toBeCloseTo(0.01 * 299_792_458, 6);
    expect(TRAVEL_SPEED_M_PER_S.warp).toBeCloseTo(LY_M / 86_400, 3);
    expect(TRAVEL_SPEED_M_PER_S.transwarp).toBeCloseTo((100 * LY_M) / 86_400, 3);
    expect(TRAVEL_SPEED_M_PER_S.hyperspace).toBeCloseTo((10_000 * LY_M) / 86_400, 3);
  });

  it('makes 1 ly at warp cost exactly one day', () => {
    expect(1 / (TRAVEL_SPEED_M_PER_S.warp / LY_M)).toBeCloseTo(86_400, 6);
  });
});

describe('methodForPair', () => {
  it('is a warp inside the local field and a transwarp once the disc is touched', () => {
    // `v1/0` is the galaxy's home star; a star whose identity is 9 is local (9 % 9 === 0), and
    // identity 1 is a disc star — inside whatever sector its angle falls in.
    // v1/0.0.9 and v1/0.0.18 are two local-field stars in the same sector.
    expect(methodForPair(parseAddressOrThrow('v1/0'), parseAddressOrThrow('v1/0.0.9'))).toBe('warp');
    expect(methodForPair(parseAddressOrThrow('v1/0.0.9'), parseAddressOrThrow('v1/0.0.18'))).toBe(
      'warp',
    );
    expect(methodForPair(parseAddressOrThrow('v1/0.0.9'), parseAddressOrThrow('v1/0.0.1'))).toBe(
      'transwarp',
    );
    // Symmetric: the disc's involvement decides, not which end is `from`.
    expect(methodForPair(parseAddressOrThrow('v1/0.0.1'), parseAddressOrThrow('v1/0.0.9'))).toBe(
      'transwarp',
    );
  });

  it('treats a sector as disc, because a sector is a slice of the disc', () => {
    // Until this landed, a sector address made `starKind` throw; a sector has no star kind but it
    // is unambiguously disc, so a hop that touches one is a transwarp.
    expect(methodForPair(parseAddressOrThrow('v1/0'), parseAddressOrThrow('v1/0.2'))).toBe(
      'transwarp',
    );
    expect(methodForPair(parseAddressOrThrow('v1/0.2'), parseAddressOrThrow('v1/1.0'))).toBe(
      'transwarp',
    );
  });

  it('recommends sublight inside one system, because it is the one hard rule', () => {
    // Bodies of system v1/0.0.0: two different planets (or a planet and a moon).
    expect(methodForPair(parseAddressOrThrow('v1/0.0.0.1'), parseAddressOrThrow('v1/0.0.0.2'))).toBe(
      'impulse',
    );
    // Still sublight between a body and its own system's star.
    expect(methodForPair(parseAddressOrThrow('v1/0.0.0'), parseAddressOrThrow('v1/0.0.0.3'))).toBe(
      'impulse',
    );
    // But a *different* system is not inside one system, so the galaxy advice applies.
    expect(
      methodForPair(parseAddressOrThrow('v1/0.0.0.1'), parseAddressOrThrow('v1/0.0.5.1')),
    ).not.toBe('impulse');
  });
});

describe('planTravel', () => {
  it('measures two stars in one galaxy in that galaxy frame', () => {
    const plan = planTravel(SEED, parseAddressOrThrow('v1/0.0.1'), parseAddressOrThrow('v1/0.0.2'));
    const expected = distance('v1/0.0.1', 'v1/0.0.2');

    expect(plan.reason).toBeNull();
    expect(plan.distanceM).toBeCloseTo(expected, 6);
    // Same-galaxy pairs are warp or transwarp, both distance-priced, so the speed table applies.
    expect(plan.method === 'warp' || plan.method === 'transwarp').toBe(true);
    if (plan.method === 'warp' || plan.method === 'transwarp') {
      expect(plan.elapsedS).toBeCloseTo(expected / TRAVEL_SPEED_M_PER_S[plan.method], 6);
    }
    expect(plan.method).toBe(
      methodForPair(parseAddressOrThrow('v1/0.0.1'), parseAddressOrThrow('v1/0.0.2')),
    );
    expect(plan.distanceM).toBeGreaterThan(0);
  });

  it('makes a sector a travel destination with a real distance', () => {
    // ADR-0023 consequence: a sector owns a wedge, so it has a position (mid-radius) and a hop to
    // it costs universe time like any other place.
    const plan = planTravel(SEED, parseAddressOrThrow('v1/0'), parseAddressOrThrow('v1/0.2'));
    expect(plan.reason).toBeNull();
    expect(plan.distanceM).toBeCloseTo(distance('v1/0', 'v1/0.2'), 6);
    expect(plan.distanceM).toBeGreaterThan(0);
    expect(plan.elapsedS).not.toBeNull();
  });

  it('is symmetric in distance and method', () => {
    const a = parseAddressOrThrow('v1/0.0.3');
    const b = parseAddressOrThrow('v1/0.0.9');
    const there = planTravel(SEED, a, b);
    const back = planTravel(SEED, b, a);

    expect(there.distanceM).not.toBeNull();
    expect(back.distanceM).toBeCloseTo(there.distanceM!, 6);
    expect(back.method).toBe(there.method);
    expect(back.elapsedS).toBeCloseTo(there.elapsedS!, 6);
  });

  it('measures the home star to a child as the child’s placement', () => {
    const plan = planTravel(SEED, GALAXY, parseAddressOrThrow('v1/0.0.7'));
    const star = placement(SEED, parseAddressOrThrow('v1/0.0.7'))!;
    const expected = Math.hypot(star.x, star.y, star.z);

    expect(plan.reason).toBeNull();
    expect(plan.distanceM).toBeCloseTo(expected, 6);
  });

  it('accepts addresses deeper than a star while the galaxy frame is the shared one', () => {
    // `placement` places anything deeper than a galaxy by its star level (ADR-0011), so Sol and a
    // sibling star are still two places in one galaxy. Per-level frames arrive with the layout
    // work; until then this is the honest distance.
    const plan = planTravel(
      SEED,
      parseAddressOrThrow('v1/0.0.0'),
      parseAddressOrThrow('v1/0.5.0'),
    );
    expect(plan.reason).toBeNull();
    expect(plan.distanceM).toBeCloseTo(distance('v1/0.0.0', 'v1/0.5.0'), 6);
  });

  it('travels galaxy-to-galaxy now that the root layout gives a distance', () => {
    const from = parseAddressOrThrow('v1/0');
    const to = parseAddressOrThrow('v1/1');
    const plan = planTravel(SEED, from, to);

    expect(plan.reason).toBeNull();
    // Recommended method across galaxies is hyperspace (ADR-0019's advice column).
    expect(plan.method).toBe('hyperspace');
    expect(plan.distanceM).not.toBeNull();
    expect(plan.distanceM).toBeGreaterThan(0);

    // The distance is the root-frame separation, which is galaxy-scale, not zero.
    const a = rootPosition(SEED, from)!;
    const b = rootPosition(SEED, to)!;
    const expected = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    expect(plan.distanceM).toBeCloseTo(expected, 3);
    expect(plan.elapsedS).toBeCloseTo(expected / TRAVEL_SPEED_M_PER_S.hyperspace, 3);
  });

  it('carries each star own offset into a galaxy-to-galaxy distance', () => {
    // Two stars, one in each galaxy: the distance is the galaxies' separation *plus* each star's
    // offset, minus the other's. Dropping the offsets would show two stars at the galaxies' centres.
    const here = parseAddressOrThrow('v1/0.0.1');
    const there = parseAddressOrThrow('v1/1.0.2');
    const plan = planTravel(SEED, here, there);
    expect(plan.reason).toBeNull();
    const a = rootPosition(SEED, here)!;
    const b = rootPosition(SEED, there)!;
    expect(plan.distanceM).toBeCloseTo(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), 3);
  });

  it('prices every method, and a wormhole costs a fixed time whatever the distance', () => {
    const near = planTravel(SEED, parseAddressOrThrow('v1/0.0.1'), parseAddressOrThrow('v1/0.0.2'));
    const far = planTravel(SEED, parseAddressOrThrow('v1/0'), parseAddressOrThrow('v1/1'));

    for (const plan of [near, far]) {
      expect(plan.costs).toHaveLength(5);
      expect(plan.costs.map((c) => c.method)).toEqual([
        'impulse',
        'warp',
        'transwarp',
        'hyperspace',
        'wormhole',
      ]);
      const wormhole = plan.costs.find((c) => c.method === 'wormhole')!;
      expect(wormhole.elapsedS).toBe(WORMHOLE_ELAPSED_S);
    }

    // The point of the carve-out: same wormhole cost across a few hundred AU and across megaparsecs.
    const nearWormhole = near.costs.find((c) => c.method === 'wormhole')!.elapsedS;
    const farWormhole = far.costs.find((c) => c.method === 'wormhole')!.elapsedS;
    expect(nearWormhole).toBe(farWormhole);
  });

  it('applies a requested method even when it is not the recommended one', () => {
    const from = parseAddressOrThrow('v1/0.0.1');
    const to = parseAddressOrThrow('v1/0.0.2');
    const plan = planTravel(SEED, from, to, 'wormhole');
    expect(plan.reason).toBeNull();
    expect(plan.method).toBe('wormhole');
    expect(plan.elapsedS).toBe(WORMHOLE_ELAPSED_S);
  });

  it('rejects an unknown method rather than guessing', () => {
    const plan = planTravel(
      SEED,
      parseAddressOrThrow('v1/0.0.1'),
      parseAddressOrThrow('v1/0.0.2'),
      'teleport',
    );
    expect(plan.reason).toContain('not a travel method');
    expect(plan.distanceM).toBeNull();
  });

  it('refuses the same address, the root, and mixed versions', () => {
    const a = parseAddressOrThrow('v1/0.0.1');
    expect(planTravel(SEED, a, a).reason).toContain('already there');

    expect(planTravel(SEED, a, parseAddressOrThrow('v1/')).reason).toContain('root');
    expect(planTravel(SEED, parseAddressOrThrow('v1/'), a).reason).toContain('root');

    const other = { version: 2, levels: [0, 1] };
    expect(planTravel(SEED, a, other).reason).toContain('version');
  });

  it('never mutates its inputs', () => {
    const from = parseAddressOrThrow('v1/0.0.2');
    const to = parseAddressOrThrow('v1/0.0.8');
    const before = [formatAddress(from), formatAddress(to)];
    planTravel(SEED, from, to);
    expect([formatAddress(from), formatAddress(to)]).toEqual(before);
  });
});