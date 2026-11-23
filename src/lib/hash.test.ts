import { describe, expect, it } from 'vitest';
import { fnv1a32, seedUnit } from './hash';

describe('fnv1a32', () => {
  it('matches the reference FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('maps seeds into [0, 1)', () => {
    const value = seedUnit('ugb-0');
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(seedUnit('ugb-0')).toBe(value);
    expect(seedUnit('ugb-1')).not.toBe(value);
  });
});