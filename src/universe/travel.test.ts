import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddressOrThrow } from '../frame/address';
import { LY_M } from './disc';
import { placement } from './placement';
import {
  TRAVEL_SPEED_M_PER_S,
  methodForPair,
  planTravel,
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
    expect(TRAVEL_SPEED_M_PER_S.subspace).toBeCloseTo((10_000 * LY_M) / 86_400, 3);
  });

  it('makes 1 ly at warp cost exactly one day', () => {
    expect(1 / (TRAVEL_SPEED_M_PER_S.warp / LY_M)).toBeCloseTo(86_400, 6);
  });
});

describe('methodForPair', () => {
  it('is a warp inside the local field and a transwarp once the disc is touched', () => {
    // `v1/0` is the galaxy's home star; level 9 is local (9 % 9 === 0), level 1 is disc.
    expect(methodForPair(parseAddressOrThrow('v1/0'), parseAddressOrThrow('v1/0.9'))).toBe('warp');
    expect(methodForPair(parseAddressOrThrow('v1/0.9'), parseAddressOrThrow('v1/0.18'))).toBe('warp');
    expect(methodForPair(parseAddressOrThrow('v1/0.9'), parseAddressOrThrow('v1/0.1'))).toBe(
      'transwarp',
    );
    // Symmetric: the disc's involvement decides, not which end is `from`.
    expect(methodForPair(parseAddressOrThrow('v1/0.1'), parseAddressOrThrow('v1/0.9'))).toBe(
      'transwarp',
    );
  });
});

describe('planTravel', () => {
  it('measures two stars in one galaxy in that galaxy frame', () => {
    const plan = planTravel(SEED, parseAddressOrThrow('v1/0.1'), parseAddressOrThrow('v1/0.2'));
    const expected = distance('v1/0.1', 'v1/0.2');

    expect(plan.reason).toBeNull();
    expect(plan.distanceM).toBeCloseTo(expected, 6);
    expect(plan.elapsedS).toBeCloseTo(expected / TRAVEL_SPEED_M_PER_S[plan.method], 6);
    expect(plan.method).toBe(methodForPair(parseAddressOrThrow('v1/0.1'), parseAddressOrThrow('v1/0.2')));
    expect(plan.distanceM).toBeGreaterThan(0);
  });

  it('is symmetric in distance and method', () => {
    const a = parseAddressOrThrow('v1/0.3');
    const b = parseAddressOrThrow('v1/0.9');
    const there = planTravel(SEED, a, b);
    const back = planTravel(SEED, b, a);

    expect(there.distanceM).not.toBeNull();
    expect(back.distanceM).toBeCloseTo(there.distanceM!, 6);
    expect(back.method).toBe(there.method);
    expect(back.elapsedS).toBeCloseTo(there.elapsedS!, 6);
  });

  it('measures the home star to a child as the child’s placement', () => {
    const plan = planTravel(SEED, GALAXY, parseAddressOrThrow('v1/0.7'));
    const star = placement(SEED, parseAddressOrThrow('v1/0.7'))!;
    const expected = Math.hypot(star.x, star.y, star.z);

    expect(plan.reason).toBeNull();
    expect(plan.distanceM).toBeCloseTo(expected, 6);
  });

  it('accepts addresses deeper than a star while the galaxy frame is the shared one', () => {
    // `placement` places anything deeper than a galaxy by its level-1 index (ADR-0011), so
    // Sol and a sibling star are still two places in one galaxy. Per-level frames arrive with
    // the layout work; until then this is the honest distance.
    const plan = planTravel(
      SEED,
      parseAddressOrThrow('v1/0.0.0'),
      parseAddressOrThrow('v1/0.5.0'),
    );
    expect(plan.reason).toBeNull();
    expect(plan.distanceM).toBeCloseTo(distance('v1/0.0.0', 'v1/0.5.0'), 6);
  });

  it('refuses a galaxy-to-galaxy jump instead of inventing zero', () => {
    const plan = planTravel(SEED, parseAddressOrThrow('v1/0'), parseAddressOrThrow('v1/1'));
    expect(plan.method).toBe('subspace');
    expect(plan.distanceM).toBeNull();
    expect(plan.elapsedS).toBeNull();
    expect(plan.reason).toContain('not modelled');
    expect(plan.reason).toContain('v1/0');
    expect(plan.reason).toContain('v1/1');
  });

  it('refuses the same address, the root, and mixed versions', () => {
    const a = parseAddressOrThrow('v1/0.1');
    expect(planTravel(SEED, a, a).reason).toContain('already there');

    expect(planTravel(SEED, a, parseAddressOrThrow('v1/')).reason).toContain('root');
    expect(planTravel(SEED, parseAddressOrThrow('v1/'), a).reason).toContain('root');

    const other = { version: 2, levels: [0, 1] };
    expect(planTravel(SEED, a, other).reason).toContain('version');
  });

  it('never mutates its inputs', () => {
    const from = parseAddressOrThrow('v1/0.2');
    const to = parseAddressOrThrow('v1/0.8');
    const before = [formatAddress(from), formatAddress(to)];
    planTravel(SEED, from, to);
    expect([formatAddress(from), formatAddress(to)]).toEqual(before);
  });
});