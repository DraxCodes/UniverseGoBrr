import { describe, expect, it } from 'vitest';
import { DEFAULT_ADDRESS, formatAddress } from '../frame/address';
import {
  DEFAULT_EPOCH_ISO,
  DEFAULT_SEED,
  advanceClock,
  clockSeconds,
  defaultState,
  formatNumber,
  historyWrite,
  parseUrlState,
  urlForState,
  type UrlState,
} from './url-state';

describe('parseUrlState', () => {
  it('defaults to a deterministic, live-clock coordinate', () => {
    const { state, issues } = parseUrlState('');
    expect(issues).toEqual([]);
    expect(state.seed).toBe(DEFAULT_SEED);
    expect(new Date(state.epochMs).toISOString()).toBe(DEFAULT_EPOCH_ISO);
    expect(state.address).toEqual(DEFAULT_ADDRESS);
    expect(state.t).toBeNull();
    expect(state.camera).toEqual({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    expect(state.precision).toBeNull();
  });

  it('parses seed, epoch, address, pinned t and camera', () => {
    const { state, issues } = parseUrlState(
      '?seed=andromeda-7&epoch=2024-02-29T12:34:56.000Z&addr=v1/0.3.-7.12' +
        '&t=-120.5&cam=12,-4,40,0.6,0.15&precision=naive',
    );

    expect(issues).toEqual([]);
    expect(state.seed).toBe('andromeda-7');
    expect(new Date(state.epochMs).toISOString()).toBe('2024-02-29T12:34:56.000Z');
    expect(formatAddress(state.address)).toBe('v1/0.3.-7.12');
    expect(state.t).toBe(-120.5);
    expect(state.camera).toEqual({ x: 12, y: -4, z: 40, yaw: 0.6, pitch: 0.15 });
    expect(state.precision).toBe('naive');
  });

  it('treats an absent t as a live clock and t=0 as pinned', () => {
    expect(parseUrlState('').state.t).toBeNull();
    expect(parseUrlState('?t=').state.t).toBeNull();
    expect(parseUrlState('?t=0').state.t).toBe(0);
  });

  it('rejects invalid values, reports them and keeps defaults', () => {
    const { state, issues } = parseUrlState(
      '?seed=bad%20seed&epoch=yesterday&t=soon&cam=1,2,3&addr=v1/1,2&precision=maybe',
    );

    expect(state.seed).toBe(DEFAULT_SEED);
    expect(new Date(state.epochMs).toISOString()).toBe(DEFAULT_EPOCH_ISO);
    expect(state.t).toBeNull();
    expect(state.camera).toEqual({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    expect(state.address).toEqual(DEFAULT_ADDRESS);
    expect(state.precision).toBeNull();
    expect(issues).toHaveLength(6);
  });

  it('rejects a non-ISO epoch even when Date can parse it', () => {
    expect(parseUrlState('?epoch=01/02/2024').issues).toHaveLength(1);
  });

  it('records whether the URL chose the camera or the scene did', () => {
    expect(parseUrlState('?seed=ugb-0').state.cameraExplicit).toBe(false);
    expect(parseUrlState('?cam=1,2,3,0.4,0.5').state.cameraExplicit).toBe(true);
    // A rejected camera leaves the scene free to pick its own framing.
    expect(parseUrlState('?cam=nonsense').state.cameraExplicit).toBe(false);
  });

  it('rejects a camera with a missing component instead of reading it as zero', () => {
    const { state, issues } = parseUrlState('?cam=1,2,3,4,');
    expect(issues).toHaveLength(1);
    expect(state.camera).toEqual({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  });

  /**
   * The audit finding: a finite double becomes Infinity in a float32 uniform above ~3.4e38,
   * and Infinity in a uniform renders as NaN pixels. That is a link that draws garbage rather
   * than reporting a bad coordinate, so these are rejected rather than clamped.
   */
  it('rejects magnitudes that would become Infinity once stored as float32', () => {
    const huge = parseUrlState('?cam=1e300,0,0,0,0');
    expect(huge.issues).toHaveLength(1);
    expect(huge.state.camera).toEqual({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

    const tiny = parseUrlState('?cam=0,0,0,0,-1e300');
    expect(tiny.issues).toHaveLength(1);
    expect(tiny.state.camera).toEqual({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

    const time = parseUrlState('?t=1e300');
    expect(time.issues).toHaveLength(1);
    expect(time.state.t).toBeNull();

    // The limits are far above anything the app means, so ordinary values still pass.
    expect(parseUrlState('?t=1e12').issues).toEqual([]);
    expect(parseUrlState('?cam=1e13,0,0,0,0').issues).toEqual([]);
  });

  it('rejects a seed with characters that are not address-safe', () => {
    expect(parseUrlState('?seed=%3Cscript%3E').state.seed).toBe(DEFAULT_SEED);
  });
});

describe('urlForState', () => {
  it('round-trips a pinned coordinate', () => {
    const state: UrlState = {
      seed: 'ugb-0042',
      epochMs: Date.parse('2000-01-01T00:00:00.000Z'),
      address: { version: 1, levels: [0, 3, -7, 12] },
      t: 1200,
      camera: { x: 12, y: -4, z: 40, yaw: 0.6, pitch: 0.15 },
      cameraExplicit: true,
      precision: null,
    };

    const url = urlForState(state, '/');
    expect(url.startsWith('/?')).toBe(true);
    expect(url).toContain('epoch=2000-01-01T00:00:00.000Z');
    expect(url).toContain('addr=v1/0.3.-7.12');
    expect(url).toContain('cam=12,-4,40,0.6,0.15');
    expect(url).not.toContain('precision=');

    const { state: reparsed, issues } = parseUrlState(new URL(url, 'http://local').search);
    expect(issues).toEqual([]);
    expect(reparsed.seed).toBe(state.seed);
    expect(reparsed.epochMs).toBe(state.epochMs);
    expect(formatAddress(reparsed.address)).toBe(formatAddress(state.address));
    expect(reparsed.t).toBe(state.t);
    expect(reparsed.camera).toEqual(state.camera);
  });

  it('round-trips the precision debug switch', () => {
    const state = defaultState();
    state.precision = 'naive';
    const url = urlForState(state, '/');
    expect(url).toContain('precision=naive');
    expect(parseUrlState(new URL(url, 'http://local').search).state.precision).toBe('naive');
  });

  it('omits t when the clock is live', () => {
    const url = urlForState(defaultState(), '/');
    expect(url).not.toContain('t=');
    expect(url).toContain('seed=');
    expect(url).toContain('epoch=');
    expect(url).toContain('addr=v1/0');
    expect(url).toContain('cam=');
  });
});

describe('clockSeconds', () => {
  it('returns the pinned value regardless of the wall clock', () => {
    const state = defaultState();
    state.t = 42;
    expect(clockSeconds(state, Date.parse('2030-01-01T00:00:00.000Z'))).toBe(42);
  });

  it('advances from the epoch when live', () => {
    const state = defaultState();
    state.epochMs = 1000;
    expect(clockSeconds(state, 3500)).toBe(2.5);
  });
});

describe('advanceClock', () => {
  it('moves a pinned t forward and keeps it pinned', () => {
    const state = defaultState();
    state.t = 1200;
    expect(advanceClock(state, 86_400)).toEqual({ ok: true, t: 87_600, epochMs: state.epochMs });
  });

  it('moves a live epoch back and keeps the clock live', () => {
    const state = defaultState();
    const next = advanceClock(state, 86_400);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.t).toBeNull();
    expect(next.epochMs).toBe(state.epochMs - 86_400_000);
    // The universe time at a fixed wall instant is one day later than before the travel.
    expect(clockSeconds({ ...state, ...next }, state.epochMs)).toBeCloseTo(86_400, 6);
  });

  it('refuses to rewind or accept a non-number', () => {
    expect(() => advanceClock(defaultState(), -1)).toThrow(/non-negative/);
    expect(() => advanceClock(defaultState(), Number.NaN)).toThrow(/finite/);
    expect(() => advanceClock(defaultState(), Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });

  // The audit found that a crafted departure clock at the edge of the reader's range could be
  // pushed past it by one jump, so the arrival link silently lost its pin (or reset its epoch) on
  // reload. These pin the refusal at both edges, and the round trip that must survive mid-range.
  it('refuses a pinned arrival past the reader cap instead of writing a link that drops it', () => {
    const state = defaultState();
    state.t = 1e20;
    const next = advanceClock(state, 9.2e9);
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(next.reason).toMatch(/range a shared link can carry/);
  });

  it('refuses a live arrival below the epoch the ISO pattern can write', () => {
    const state = defaultState();
    state.epochMs = Date.parse('0001-01-01T00:00:00.000Z');
    const next = advanceClock(state, 9.2e9);
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(next.reason).toMatch(/dates a shared link can carry/);
  });

  it('round-trips an accepted pinned and live arrival through the URL', () => {
    const pinned = defaultState();
    pinned.t = 1e19;
    const pinnedNext = advanceClock(pinned, 9.2e9);
    expect(pinnedNext.ok).toBe(true);
    if (!pinnedNext.ok) return;
    const pinnedUrl = urlForState({ ...pinned, ...pinnedNext }, '/');
    const pinnedBack = parseUrlState(pinnedUrl.slice(1));
    expect(pinnedBack.issues).toEqual([]);
    expect(pinnedBack.state.t).toBe(pinnedNext.t);

    const live = defaultState(); // default epoch, comfortably inside 0000-9999
    const liveNext = advanceClock(live, 9.2e9);
    expect(liveNext.ok).toBe(true);
    if (!liveNext.ok) return;
    const liveUrl = urlForState({ ...live, ...liveNext }, '/');
    const liveBack = parseUrlState(liveUrl.slice(1));
    expect(liveBack.issues).toEqual([]);
    expect(liveBack.state.epochMs).toBe(liveNext.epochMs);
    expect(liveBack.state.t).toBeNull();
  });
});

describe('historyWrite', () => {
  it('replaces on framing and pushes only on a new arrival', () => {
    expect(historyWrite('v1/0.1', 'v1/0.2', 'framing')).toBe('replace');
    expect(historyWrite('v1/0.1', 'v1/0.2', 'arrival')).toBe('push');
  });

  it('collapses a repeated address to a replace', () => {
    expect(historyWrite('v1/0.2', 'v1/0.2', 'arrival')).toBe('replace');
  });

  it('never pushes without a user arrival, so an oscillation cannot grow history', () => {
    // A scripted boundary bounce is a sequence of framing writes at alternating addresses.
    const addresses = ['v1/0.1', 'v1/0.2', 'v1/0.1', 'v1/0.2'];
    const writes = addresses.map((next, i) => {
      const current = addresses[i - 1] ?? next;
      return historyWrite(current, next, 'framing');
    });
    expect(writes.every((write) => write === 'replace')).toBe(true);
  });
});

describe('formatNumber', () => {
  it('keeps six decimal places and strips noise', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(0.30000000000000004)).toBe('0.3');
    expect(formatNumber(-120.5)).toBe('-120.5');
  });

  it('never emits a character that a query string would escape', () => {
    // `toFixed(6)` returns "1e+22" above 1e21, and `URLSearchParams` turns that `+` into %2B
    // (a literal `+` would even decode as a space). A large camera must still share cleanly.
    for (const value of [1e22, 1e17, -1e17, 2e15, 1e300, 1e-5, 1.2345e-9]) {
      const text = formatNumber(value);
      expect(text, String(value)).not.toContain('+');
      expect(Number(text), String(value)).toBe(value);
    }
    expect(formatNumber(1e17)).toBe('1e17');
    expect(formatNumber(-1e17)).toBe('-1e17');
    // Below 1e15 the readable decimal form is kept.
    expect(formatNumber(1.496e11)).toBe('149600000000');
  });
});