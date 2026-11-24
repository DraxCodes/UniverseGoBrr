/**
 * The URL is the coordinate: `seed + epoch + address + t + camera`, plus a debug `precision`
 * switch. Everything here is pure so the capture harness can rely on the same parser and
 * serializer the app uses.
 */

import {
  DEFAULT_ADDRESS,
  formatAddress,
  parseAddress,
  sameAddress,
  type Address,
} from '../frame/address';
import type { PrecisionMode } from '../frame/precision-probe';

export interface Camera {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface UrlState {
  seed: string;
  /** The coordinate's epoch, as Unix milliseconds (see GLOSSARY: Epoch). */
  epochMs: number;
  /** The frame this coordinate is in. Unbounded depth; see ADR-0008. */
  address: Address;
  /**
   * Where the last committed travel started, or `null` when this coordinate was not reached by
   * travelling (a fresh link, or a boot). This is the compass's "came from" pin.
   *
   * It is a **coordinate, not journey state**: the previous place is a place, and the compass can
   * compute a bearing to it like any other anchor. The council's "the journey is derived, never
   * stored" is about in-between motion, which this is not — nothing here says how far through a
   * jump the traveller is. A link carrying it reproduces the trail exactly, which a session-only
   * variable could not (ADR-0012: a shared link and an arrival are the same state).
   */
  from: Address | null;
  /** Pinned `t` in seconds since the epoch. `null` means the clock is live. */
  t: number | null;
  /** Camera offset inside the address's frame, in metres and radians. */
  camera: Camera;
  /**
   * True when the URL carried a `cam` parameter. The scene chooses its own default framing when
   * it did not — a camera at the origin is inside the star, which is not a useful opening view.
   */
  cameraExplicit: boolean;
  /**
   * Debug switch, not a feature: `null` draws the normal scene. `fixed` and `naive` draw the
   * precision probe with the two coordinate paths, so the negative control is reproducible.
   */
  precision: PrecisionMode | null;
}

export interface ParsedUrlState {
  state: UrlState;
  /** Human-readable notes about values that were rejected and replaced. */
  issues: string[];
}

export const DEFAULT_SEED = 'ugb-0';
export const DEFAULT_EPOCH_ISO = '2000-01-01T00:00:00.000Z';
export const DEFAULT_EPOCH_MS = Date.parse(DEFAULT_EPOCH_ISO);

export const DEFAULT_CAMERA: Readonly<Camera> = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
});

const SEED_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Values are capped as well as checked for finiteness. A finite double still becomes
 * `Infinity` when stored in a float32 uniform above ~3.4×10³⁸, and Infinity in a uniform
 * renders as NaN pixels — a hostile link that draws garbage rather than reporting a bad
 * coordinate. The caps are chosen to be far above anything the app means and far below that
 * threshold: 10³⁰ m is a thousand times the largest frame in ADR-0008, and 10²⁰ s is three
 * trillion years.
 */
const MAX_POSITION_M = 1e30;
const MAX_ANGLE_RAD = 1e6;
const MAX_TIME_S = 1e20;

/**
 * The epoch range the *reader* accepts. `ISO_PATTERN` starts with `\d{4}`, so a negative or
 * five-digit year is rejected and the epoch silently resets to the default — which is a jump of
 * millennia. These are the same bounds as clock advance must respect, expressed as the timestamps
 * themselves rather than re-derived from the pattern, so the writer cannot drift from the reader.
 */
export const MIN_EPOCH_MS = Date.parse('0000-01-01T00:00:00.000Z');
export const MAX_EPOCH_MS = Date.parse('9999-12-31T23:59:59.999Z');

export function defaultState(): UrlState {
  return {
    seed: DEFAULT_SEED,
    epochMs: DEFAULT_EPOCH_MS,
    address: DEFAULT_ADDRESS,
    from: null,
    t: null,
    camera: { ...DEFAULT_CAMERA },
    cameraExplicit: false,
    precision: null,
  };
}

export function parseUrlState(search: string): ParsedUrlState {
  const params = new URLSearchParams(search);
  const issues: string[] = [];

  const state = defaultState();

  if (params.has('seed')) {
    const raw = (params.get('seed') ?? '').trim();
    if (SEED_PATTERN.test(raw)) {
      state.seed = raw;
    } else {
      issues.push(`seed "${raw}" must match ${SEED_PATTERN.source}; using "${DEFAULT_SEED}".`);
    }
  }

  if (params.has('epoch')) {
    const raw = (params.get('epoch') ?? '').trim();
    const ms = Date.parse(raw);
    if (ISO_PATTERN.test(raw) && Number.isFinite(ms)) {
      state.epochMs = ms;
    } else {
      issues.push(`epoch "${raw}" must be ISO 8601; using ${DEFAULT_EPOCH_ISO}.`);
    }
  }

  if (params.has('addr')) {
    const raw = (params.get('addr') ?? '').trim();
    const parsed = parseAddress(raw);
    if (parsed.address) {
      state.address = parsed.address;
    } else {
      issues.push(
        `addr "${raw}" is not a valid address (${parsed.issue ?? 'unknown reason'}); ` +
          `using ${formatAddress(DEFAULT_ADDRESS)}.`,
      );
    }
  }

  if (params.has('from')) {
    const raw = (params.get('from') ?? '').trim();
    const parsed = parseAddress(raw);
    if (parsed.address) {
      // A pin pointing at the place you are is not a trail; keep it out rather than show "came
      // from here". Silently dropping it is safe because nothing else depends on `from`.
      if (!sameAddress(parsed.address, state.address)) state.from = parsed.address;
    } else {
      issues.push(
        `from "${raw}" is not a valid address (${parsed.issue ?? 'unknown reason'}); ` +
          'showing no trail.',
      );
    }
  }

  if (params.has('t')) {
    const raw = (params.get('t') ?? '').trim();
    const value = Number(raw);
    if (raw !== '' && Number.isFinite(value) && Math.abs(value) <= MAX_TIME_S) {
      state.t = value;
    } else {
      issues.push(
        `t "${raw}" must be a finite number of seconds within ±${MAX_TIME_S.toExponential()}; ` +
          'leaving the clock live.',
      );
    }
  }

  if (params.has('cam')) {
    const raw = params.get('cam') ?? '';
    const camera = parseCamera(raw);
    if (camera) {
      state.camera = camera;
      state.cameraExplicit = true;
    } else {
      issues.push(
        `cam "${raw}" must be x,y,z,yaw,pitch (metres and radians) within ±${MAX_POSITION_M.toExponential()}; ` +
          'using the default camera.',
      );
    }
  }

  if (params.has('precision')) {
    const raw = (params.get('precision') ?? '').trim();
    if (raw === 'fixed' || raw === 'naive') {
      state.precision = raw;
    } else {
      issues.push(`precision "${raw}" must be "fixed" or "naive"; drawing the normal scene.`);
    }
  }

  return { state, issues };
}

function parseCamera(raw: string): Camera | null {
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 5 || parts.some((part) => part === '')) return null;

  const [x, y, z, yaw, pitch] = parts.map(Number);
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch)) return null;

  // Finite is not enough: 1e300 is finite in a double and Infinity in the float32 uniform,
  // which renders as NaN pixels instead of reporting a bad coordinate.
  if (!within(x, MAX_POSITION_M) || !within(y, MAX_POSITION_M) || !within(z, MAX_POSITION_M)) {
    return null;
  }
  if (!within(yaw, MAX_ANGLE_RAD) || !within(pitch, MAX_ANGLE_RAD)) return null;

  return { x, y, z, yaw, pitch };
}

function within(value: number, limit: number): boolean {
  return Math.abs(value) <= limit;
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function urlForState(state: UrlState, pathname: string): string {
  const params = new URLSearchParams();
  params.set('seed', state.seed);
  params.set('epoch', new Date(state.epochMs).toISOString());
  params.set('addr', formatAddress(state.address));
  if (state.from) params.set('from', formatAddress(state.from));

  if (state.t !== null) {
    params.set('t', formatNumber(state.t));
  }

  const { x, y, z, yaw, pitch } = state.camera;
  params.set('cam', [x, y, z, yaw, pitch].map(formatNumber).join(','));

  if (state.precision !== null) {
    params.set('precision', state.precision);
  }

  // `:`, `,` and `/` are legal in a query string and make a shared coordinate readable.
  // Every value here is either an ISO timestamp, a restricted seed, an address, or a number.
  const query = params
    .toString()
    .replaceAll('%3A', ':')
    .replaceAll('%2C', ',')
    .replaceAll('%2F', '/');
  return `${pathname}?${query}`;
}

export function formatNumber(value: number): string {
  if (Object.is(value, -0)) return '0';

  const magnitude = Math.abs(value);
  // Two reasons to switch to exponential form for big and small values:
  //   1. `toFixed(6)` returns exponential notation above 1e21 *and includes a `+` sign*, which
  //      `URLSearchParams` escapes to %2B — a coordinate that looks corrupted in a shared link.
  //   2. Even below that, a 1e17 camera prints as eighteen digits and is unreadable.
  // `toExponential()` with no argument is exact: it emits the shortest digit string that parses
  // back to the same double, so this is a presentation change, not a lossy one.
  if (magnitude !== 0 && (magnitude >= 1e15 || magnitude < 1e-4)) {
    return value.toExponential().replace('e+', 'e');
  }

  return Number(value.toFixed(6)).toString();
}

/** Seconds since the state's epoch: pinned when `t` is set, otherwise the wall clock. */
export function clockSeconds(state: UrlState, nowMs: number): number {
  return state.t ?? (nowMs - state.epochMs) / 1000;
}

/**
 * The result of advancing the clock: either the new clock, or the reason the arrival instant
 * cannot be written to a URL.
 *
 * A refusal is not pedantry. ADR-0012's whole claim is that *reloading the arrival link and
 * arriving by travel are the same state*. If the arrival clock is outside what `parseUrlState`
 * accepts, the reload would silently drop the pin or reset the epoch — so the honest answer is to
 * refuse the travel rather than write a link that does not mean what the jump did.
 */
export type ClockAdvance =
  | { ok: true; t: number | null; epochMs: number }
  | { ok: false; reason: string };

/**
 * Move the universe clock forward by `elapsedS` **without changing whether it is live**.
 *
 * The clock has two modes and travel must not silently switch them:
 *
 * - **Pinned** (`t` set): move `t` by `elapsedS`. The arrival link reproduces the arrival instant
 *   exactly, which is what a shared coordinate owes the person who opens it.
 * - **Live** (`t` null): move the **epoch** back by `elapsedS`, so the elapsed wall time since the
 *   epoch grows by the same amount and the orrery keeps running. The alternative — pinning `t` on
 *   every arrival — would freeze the planets after every jump, which is a worse lie than an epoch
 *   that is a few days earlier than the wall clock.
 *
 * The council's "a mid-travel link pins the arrival `t`" is satisfied in the case it was written
 * for (a pinned, reproducible coordinate) without forcing a live world to stop.
 *
 * A negative or non-finite input is a caller bug, not a user input: throw rather than rewind. An
 * arrival that a URL cannot carry is a *refusal* (`ok: false`), because a crafted `?t=` or
 * `?epoch=` can put the departure clock at the edge of the range through no fault of the caller.
 */
export function advanceClock(state: UrlState, elapsedS: number): ClockAdvance {
  if (!Number.isFinite(elapsedS) || elapsedS < 0) {
    throw new Error(
      `advanceClock needs a finite, non-negative number of seconds; got ${String(elapsedS)}`,
    );
  }

  if (state.t !== null) {
    const t = state.t + elapsedS;
    // The reader accepts |t| <= MAX_TIME_S; a value past that would be dropped on reload.
    if (!Number.isFinite(t) || Math.abs(t) > MAX_TIME_S) {
      return {
        ok: false,
        reason:
          'the arrival clock would be outside the range a shared link can carry, ' +
          'so the link would not reproduce this jump',
      };
    }
    return { ok: true, t, epochMs: state.epochMs };
  }

  const epochMs = state.epochMs - elapsedS * 1000;
  // The reader's ISO pattern has a four-digit year, so the epoch must stay inside 0000-9999.
  if (!Number.isFinite(epochMs) || epochMs < MIN_EPOCH_MS || epochMs > MAX_EPOCH_MS) {
    return {
      ok: false,
      reason:
        'the arrival epoch would be outside the dates a shared link can carry, ' +
        'so the link would not reproduce this jump',
    };
  }
  return { ok: true, t: null, epochMs };
}

/** Whether a URL write should add a history entry or replace the current one. */
export type HistoryWrite = 'push' | 'replace';

/**
 * The history contract for the URL that is the single source of truth (council §9, lane 2).
 *
 * **The rule is the address, and only the address.** A write that changes it is a place you went
 * to and gets its own entry; a write that keeps it — a drag, a zoom, a reset, the boot
 * normalisation — replaces in place. So Back retraces places rather than every nudge of the mouse,
 * and a zoom-out (an address change that costs no universe time) is still undoable with Back.
 *
 * An earlier version took a caller-supplied `arrival`/`framing` label and trusted it. That put the
 * property in the caller's hands: a zoom-out labelled `framing` would have silently overwritten the
 * entry for the star it left, and Back would have skipped it. The label is gone because the
 * address already answers the question, and only a committed navigation can change it (ADR-0004:
 * the address is driven by choice, never by where the camera drifted to).
 */
export function historyWrite(currentEntryAddress: string, nextAddress: string): HistoryWrite {
  return nextAddress === currentEntryAddress ? 'replace' : 'push';
}

export function formatEpoch(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function cameraSnapshot(camera: Camera): [number, number, number, number, number] {
  return [camera.x, camera.y, camera.z, camera.yaw, camera.pitch];
}