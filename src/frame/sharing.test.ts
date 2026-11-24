/**
 * The "paste a link to a friend" test (ADR-0008).
 *
 * A coordinate is only worth having if a shared URL reproduces the same frame. This walks the
 * hierarchy from the whole universe down to a surface site and asserts that every link the app
 * can produce parses back to the coordinate it came from — and that a link stays inside the
 * length a chat client or address bar will actually carry.
 *
 * The human question ("does this read as a place?") is not assertable. What is asserted here is
 * the machine half: the link must be lossless, and it must be able to name every scale the
 * product promises, including the largest one.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADDRESS,
  describeAddress,
  formatAddress,
  parentAddress,
  parseAddress,
  type Address,
} from './address';
import { parseUrlState, urlForState, type UrlState } from '../state/url-state';

interface Scale {
  readonly label: string;
  /** Camera position in metres within this frame, and orientation in radians. */
  readonly camera: [number, number, number, number, number];
  readonly levels: readonly number[];
}

/**
 * Depths follow the spec's vocabulary (spec §3.2): universe → quadrant → sector → system →
 * body. The root has **no** levels; `v1/4.-2.7` is a system.
 */
const SCALES: readonly Scale[] = [
  { label: 'universe (root)', levels: [], camera: [0, 0, 0, 0, 0] },
  { label: 'quadrant', levels: [4], camera: [1e22, 0, 0, 0.4, -0.2] },
  { label: 'sector', levels: [4, -2], camera: [1e17, 2e15, 0, 0.4, -0.2] },
  { label: 'system', levels: [4, -2, 7], camera: [1e9, 0, 3e8, 0.6, 0.15] },
  { label: 'body', levels: [4, -2, 7, 1], camera: [12, -4, 40, 0.6, 0.15] },
  { label: 'surface site', levels: [4, -2, 7, 1, 9, 3, 12], camera: [0, 120, 800, 1.2, -0.1] },
];

function stateFor(levels: readonly number[], camera: Scale['camera']): UrlState {
  return {
    seed: 'ugb-0000',
    epochMs: Date.parse('2000-01-01T00:00:00.000Z'),
    address: { version: 1, levels },
    from: null,
    t: 1200,
    camera: {
      x: camera[0],
      y: camera[1],
      z: camera[2],
      yaw: camera[3],
      pitch: camera[4],
      target: { x: 0, y: 0, z: 0 },
    },
    cameraExplicit: true,
    precision: null,
  };
}

describe('a shared link is the coordinate', () => {
  it('round-trips every scale, including the root', () => {
    for (const scale of SCALES) {
      const state = stateFor(scale.levels, scale.camera);
      const url = urlForState(state, '/');
      const { state: reparsed, issues } = parseUrlState(new URL(url, 'http://local').search);

      expect(issues, `${scale.label}: ${url}`).toEqual([]);
      expect(formatAddress(reparsed.address), scale.label).toBe(formatAddress(state.address));
      expect(reparsed.seed, scale.label).toBe(state.seed);
      expect(reparsed.epochMs, scale.label).toBe(state.epochMs);
      expect(reparsed.t, scale.label).toBe(state.t);
      expect(reparsed.camera, scale.label).toEqual(state.camera);
    }
  });

  it('names the largest frame that exists, so zooming out terminates', () => {
    // Without this, there is no way to share "the whole universe" and no bottom to zoom-out.
    expect(parseAddress('v1/').address).toEqual({ version: 1, levels: [] });
    expect(formatAddress({ version: 1, levels: [] })).toBe('v1/');
    expect(formatAddress(DEFAULT_ADDRESS)).toBe('v1/0');
  });

  it('walks out of the deepest address to the root in a finite number of steps', () => {
    // The spec's "click each line of the address to zoom out" depends on this: every level
    // dropped is one step, and the last step lands on `v1/`, not on an error.
    const deep = Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 1 : -1));
    let address: Address = { version: 1, levels: deep };

    let steps = 0;
    for (;;) {
      const parent = parentAddress(address);
      if (!parent) break;
      // Every intermediate frame must survive a link of its own, not just the endpoints.
      const { state, issues } = parseUrlState(
        new URL(urlForState(stateFor(parent.levels, [0, 0, 0, 0, 0]), '/'), 'http://local').search,
      );
      expect(issues, `depth ${parent.levels.length}`).toEqual([]);
      expect(state.address).toEqual(parent);
      address = parent;
      steps += 1;
    }

    expect(steps).toBe(64);
    expect(formatAddress(address)).toBe('v1/');
    // One more step is the documented stop, not an error.
    expect(parentAddress(address)).toBeNull();
    expect(describeAddress(address)).toBe('v1/ · root');
  });

  it('keeps a maximum-depth link inside a pasteable length', () => {
    const deep = Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 1 : -1));
    const url = urlForState(stateFor(deep, [12, -4, 40, 0.6, 0.15]), '/');
    // Discord's message limit is 2000 characters; browsers accept far more.
    expect(url.length).toBeLessThan(1000);
    expect(parseUrlState(new URL(url, 'http://local').search).issues).toEqual([]);
  });

  it('survives extreme but legal levels', () => {
    const levels = [2_147_483_647, -2_147_483_647, 0];
    const url = urlForState(stateFor(levels, [0, 0, 0, 0, 0]), '/');
    expect(url).toContain('addr=v1/2147483647.-2147483647.0');
    const parsed = parseUrlState(new URL(url, 'http://local').search);
    expect(parsed.issues).toEqual([]);
    expect(parsed.state.address.levels).toEqual(levels);
  });
});