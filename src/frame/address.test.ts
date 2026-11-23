import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADDRESS,
  MAX_LEVELS,
  childAddress,
  describeAddress,
  formatAddress,
  parentAddress,
  parseAddress,
  parseAddressOrThrow,
  sameAddress,
} from './address';

describe('address', () => {
  it('round-trips a versioned, signed, multi-level address', () => {
    const parsed = parseAddress('v1/0.3.-7.12');
    expect(parsed.issue).toBeNull();
    expect(parsed.address).toEqual({ version: 1, levels: [0, 3, -7, 12] });
    expect(formatAddress(parsed.address!)).toBe('v1/0.3.-7.12');
  });

  it('defaults to a single level at the origin', () => {
    expect(formatAddress(DEFAULT_ADDRESS)).toBe('v1/0');
    expect(parseAddress('v1/0').address).toEqual(DEFAULT_ADDRESS);
  });

  it('accepts depth up to the hostile-URL guard and rejects just past it', () => {
    const levels = Array.from({ length: MAX_LEVELS }, (_, index) => String(index % 10)).join('.');
    const deep = `v1/${levels}`;
    expect(parseAddress(deep).address?.levels).toHaveLength(MAX_LEVELS);
    // The deep form still round-trips: the cap is on a single string, not on the universe.
    expect(formatAddress(parseAddressOrThrow(deep))).toBe(deep);

    const deeper = `${deep}.0`;
    expect(parseAddress(deeper).address).toBeNull();
    expect(parseAddress(deeper).issue).toContain(String(MAX_LEVELS));
  });

  it('names one level further out or in, with no edge', () => {
    const origin = parseAddressOrThrow('v1/0');
    const outward = childAddress(origin, -3);
    const inward = childAddress(outward, 9);
    expect(formatAddress(inward)).toBe('v1/0.-3.9');
    // A child is always a valid address, so there is no largest or smallest region.
    expect(parseAddress(formatAddress(inward)).issue).toBeNull();
  });

  it('parses the root, which has no levels and must survive a round trip', () => {
    // Found by the sharing test: `formatAddress` emitted `v1/`, the parser rejected it, so a
    // link the app can produce could not be reopened. The root is also where zoom-out stops.
    const root = parseAddress('v1/');
    expect(root.issue).toBeNull();
    expect(root.address).toEqual({ version: 1, levels: [] });
    expect(formatAddress(root.address!)).toBe('v1/');
    expect(describeAddress(root.address!)).toBe('v1/ · root');
    expect(describeAddress(DEFAULT_ADDRESS)).toBe('v1/0 · 1 level');
  });

  it('drops one level at a time, and stops at the root instead of throwing', () => {
    const system = parseAddressOrThrow('v1/4.-2.7');
    const sector = parentAddress(system);
    expect(sector).not.toBeNull();
    expect(formatAddress(sector!)).toBe('v1/4.-2');
    expect(formatAddress(parentAddress(sector!)!)).toBe('v1/4');
    expect(formatAddress(parentAddress(parentAddress(sector!)!)!)).toBe('v1/');
    expect(parentAddress({ version: 1, levels: [] })).toBeNull();
  });

  it('rejects malformed addresses and says why', () => {
    const cases: Array<[string, string]> = [
      ['', 'empty'],
      ['0.3.-7', 'must look like v1/0.3.-7'],
      ['v0/1', 'version of 1 or more'],
      ['v1//', 'must be an integer'],
      ['v1/1.', 'must be an integer'],
      ['v1/1,5', 'must be an integer'],
      ['v1/a', 'must be an integer'],
      ['v1/01', 'must be an integer'],
      ['v1/2147483648', 'out of range'],
      [`v1/${'1.'.repeat(600)}1`, 'too long'],
    ];

    for (const [input, reason] of cases) {
      const parsed = parseAddress(input);
      expect(parsed.address, input).toBeNull();
      expect(parsed.issue, input).toContain(reason);
    }
  });

  it('compares by value, not by identity', () => {
    const a = parseAddressOrThrow('v1/2.-1');
    const b = parseAddressOrThrow('v1/2.-1');
    expect(a).not.toBe(b);
    expect(sameAddress(a, b)).toBe(true);
    expect(sameAddress(a, parseAddressOrThrow('v1/2'))).toBe(false);
    expect(sameAddress(a, parseAddressOrThrow('v2/2.-1'))).toBe(false);
  });
});