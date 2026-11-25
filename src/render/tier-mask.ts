/**
 * Pure presentation state machine for Layer 4 tier masks (`warp` and `transwarp`).
 *
 * Screen time here is deliberately decoupled from universe time (`TravelPlan.elapsedS` in
 * `src/universe/travel.ts`, ADR-0010): a 5 ly warp and a 500 ly transwarp can both advance
 * the universe clock by 5 days while playing distinct, constant-duration visual crossings.
 *
 * Invariants enforced here:
 * - Only `warp` (star streaks) and `transwarp` (slipstream tunnel) have masks. `impulse` is
 *   free flight, and `hyperspace` and `wormhole` have no mask built yet (ADR-0019's effects,
 *   ticket 07) so they cross without one rather than being refused.
 * - Only two lifecycle states exist: playing (`active === true`) or settled at the destination
 *   (`active === false`). Interruption or completion snaps cleanly to arrival; half-swapped
 *   frames are not representable.
 * - Midpoint and completion callbacks fire at most once each.
 */

import type { TravelMethod } from '../universe/travel';

export type MaskMethod = 'warp' | 'transwarp';

/** Presentation duration per tier in milliseconds, independent of jump distance. */
export const MASK_DURATION_MS: Readonly<Record<MaskMethod, number>> = Object.freeze({
  warp: 1600,
  transwarp: 2200,
});

/** Normalized progress at which the address HUD swaps silently from departure to destination. */
export const MASK_MIDPOINT = 0.5;

export interface MaskEnvelope {
  readonly method: MaskMethod;
  /** Normalized progress in `[0, 1]`. */
  readonly progress: number;
  /** Clamped screen seconds elapsed since mask start (`>= 0`). */
  readonly elapsedS: number;
  /** True while `progress < 1`. False once settled at the arrival endpoint. */
  readonly active: boolean;
  /** True once `progress >= MASK_MIDPOINT`. */
  readonly midpointReached: boolean;
  /** Departure snapshot weight (`1` at start, `0` from `u >= 0.52` onward). */
  readonly departWeight: number;
  /** Destination scene weight (`0` for `u <= 0.42`, `1` from `u >= 0.86` onward). */
  readonly destWeight: number;
  /** Mask HDR luminance envelope (`0` at `u = 0` and `u = 1`, peaks `1` near midpoint). */
  readonly effectIntensity: number;
  /** Radial pull / stretch applied to the departing snapshot (`0` at `u = 0`, `1` at mid). */
  readonly departPull: number;
  /** Arrival deceleration settle (`0` for `u >= 0.96` so final frame matches static exactly). */
  readonly destSettle: number;
}

export interface MaskControllerOptions {
  readonly method: MaskMethod;
  readonly durationMs?: number;
  readonly onMidpoint?: () => void;
  readonly onComplete?: () => void;
}

export interface MaskController {
  readonly active: boolean;
  readonly method: MaskMethod;
  sample(nowMs: number): MaskEnvelope | null;
  peek(nowMs: number): MaskEnvelope | null;
  interrupt(): void;
}

/** Select the tier mask for a travel method, or `null` when no mask applies. */
export function maskMethodFor(method: TravelMethod): MaskMethod | null {
  if (method === 'warp' || method === 'transwarp') return method;
  return null;
}

/** Quintic C² smoothstep for zero visual pop at mask endpoints. */
function smootherstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (!(span > 0)) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function completedEnvelope(method: MaskMethod, durationMs: number): MaskEnvelope {
  return {
    method,
    progress: 1,
    elapsedS: durationMs / 1000,
    active: false,
    midpointReached: true,
    departWeight: 0,
    destWeight: 1,
    effectIntensity: 0,
    departPull: 0,
    destSettle: 0,
  };
}

/** Evaluate the pure mask envelope at `elapsedMs` into the crossing. */
export function evaluateMask(
  method: MaskMethod,
  elapsedMs: number,
  durationMs: number = MASK_DURATION_MS[method],
): MaskEnvelope {
  const safeDurationMs =
    Number.isFinite(durationMs) && durationMs > 0 ? durationMs : MASK_DURATION_MS[method];

  if (!Number.isFinite(elapsedMs)) {
    return completedEnvelope(method, safeDurationMs);
  }
  if (elapsedMs >= safeDurationMs) {
    return completedEnvelope(method, safeDurationMs);
  }

  const clampedMs = Math.max(0, elapsedMs);
  const progress = clampedMs / safeDurationMs;
  const departWeight = 1 - smootherstep(0.12, 0.52, progress);
  const destWeight = smootherstep(0.42, 0.86, progress);
  const effectIntensity =
    smootherstep(0.0, 0.28, progress) * (1 - smootherstep(0.62, 1.0, progress));
  const departPull = smootherstep(0.0, 0.52, progress);
  const destSettle = 1 - smootherstep(0.42, 0.96, progress);

  return {
    method,
    progress,
    elapsedS: clampedMs / 1000,
    active: true,
    midpointReached: progress >= MASK_MIDPOINT,
    departWeight,
    destWeight,
    effectIntensity,
    departPull,
    destSettle,
  };
}

/**
 * Stateful frame-loop controller for one tier crossing.
 *
 * Lazily anchors `startedAtMs` on the first `sample(nowMs)` so async pipeline/scene creation
 * does not consume the visual effect. Guarantees midpoint fires before or at completion and
 * clamps any interruption directly to the settled arrival state.
 */
export function createMaskController(options: MaskControllerOptions): MaskController {
  const { method, onMidpoint, onComplete } = options;
  const durationMs =
    options.durationMs !== undefined &&
    Number.isFinite(options.durationMs) &&
    options.durationMs > 0
      ? options.durationMs
      : MASK_DURATION_MS[method];

  let active = true;
  let startedAtMs: number | null = null;
  let maxElapsedMs = 0;
  let midpointFired = false;
  let completeFired = false;

  function fireMidpoint(): void {
    if (midpointFired) return;
    midpointFired = true;
    onMidpoint?.();
  }

  function finish(): void {
    if (!active && completeFired) return;
    active = false;
    fireMidpoint();
    if (!completeFired) {
      completeFired = true;
      onComplete?.();
    }
  }

  function resolveElapsed(nowMs: number): number | null {
    if (!Number.isFinite(nowMs)) return null;
    if (startedAtMs === null) {
      return 0;
    }
    const rawElapsed = nowMs - startedAtMs;
    if (!Number.isFinite(rawElapsed)) return null;
    return Math.max(maxElapsedMs, rawElapsed);
  }

  return {
    get active() {
      return active;
    },
    get method() {
      return method;
    },
    sample(nowMs: number): MaskEnvelope | null {
      if (!active) return null;
      if (!Number.isFinite(nowMs)) {
        finish();
        return null;
      }
      if (startedAtMs === null) {
        startedAtMs = nowMs;
      }
      const elapsedMs = resolveElapsed(nowMs);
      if (elapsedMs === null) {
        finish();
        return null;
      }
      maxElapsedMs = elapsedMs;
      const envelope = evaluateMask(method, elapsedMs, durationMs);
      if (envelope.midpointReached) {
        fireMidpoint();
      }
      if (!envelope.active) {
        finish();
        return null;
      }
      return envelope;
    },
    peek(nowMs: number): MaskEnvelope | null {
      if (!active) return null;
      if (!Number.isFinite(nowMs)) return null;
      const elapsedMs = resolveElapsed(nowMs);
      if (elapsedMs === null) return null;
      const envelope = evaluateMask(method, elapsedMs, durationMs);
      return envelope.active ? envelope : null;
    },
    interrupt(): void {
      finish();
    },
  };
}
