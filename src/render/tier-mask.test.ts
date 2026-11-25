import { describe, expect, it, vi } from 'vitest';
import {
  MASK_DURATION_MS,
  MASK_MIDPOINT,
  createMaskController,
  evaluateMask,
  maskMethodFor,
} from './tier-mask';

describe('maskMethodFor', () => {
  it('selects warp and transwarp and rejects the methods with no mask built', () => {
    expect(maskMethodFor('warp')).toBe('warp');
    expect(maskMethodFor('transwarp')).toBe('transwarp');
    expect(maskMethodFor('impulse')).toBeNull();
    expect(maskMethodFor('hyperspace')).toBeNull();
    expect(maskMethodFor('wormhole')).toBeNull();
  });
});

describe('MASK_DURATION_MS', () => {
  it('defines positive finite screen durations with transwarp longer than warp', () => {
    expect(Number.isFinite(MASK_DURATION_MS.warp)).toBe(true);
    expect(Number.isFinite(MASK_DURATION_MS.transwarp)).toBe(true);
    expect(MASK_DURATION_MS.warp).toBeGreaterThan(0);
    expect(MASK_DURATION_MS.transwarp).toBeGreaterThan(MASK_DURATION_MS.warp);
  });
});

describe('evaluateMask', () => {
  it('starts cleanly on the departure frame at elapsedMs = 0', () => {
    const start = evaluateMask('warp', 0);
    expect(start.method).toBe('warp');
    expect(start.progress).toBe(0);
    expect(start.elapsedS).toBe(0);
    expect(start.active).toBe(true);
    expect(start.midpointReached).toBe(false);
    expect(start.departWeight).toBe(1);
    expect(start.destWeight).toBe(0);
    expect(start.effectIntensity).toBe(0);
    expect(start.departPull).toBe(0);
  });

  it('peaks near midpoint and signals midpointReached at progress >= 0.5', () => {
    const halfMs = MASK_DURATION_MS.transwarp * MASK_MIDPOINT;
    const before = evaluateMask('transwarp', halfMs - 1);
    const at = evaluateMask('transwarp', halfMs);

    expect(before.midpointReached).toBe(false);
    expect(at.active).toBe(true);
    expect(at.midpointReached).toBe(true);
    expect(at.effectIntensity).toBeGreaterThan(0.9);
  });

  it('settles cleanly to the static destination endpoint at and past durationMs', () => {
    const end = evaluateMask('warp', MASK_DURATION_MS.warp);
    const past = evaluateMask('warp', MASK_DURATION_MS.warp + 500);

    for (const env of [end, past]) {
      expect(env.progress).toBe(1);
      expect(env.active).toBe(false);
      expect(env.midpointReached).toBe(true);
      expect(env.departWeight).toBe(0);
      expect(env.destWeight).toBe(1);
      expect(env.effectIntensity).toBe(0);
      expect(env.departPull).toBe(0);
      expect(env.destSettle).toBe(0);
    }
  });

  it('clamps negative elapsedMs to 0 and non-finite elapsedMs to completed', () => {
    const neg = evaluateMask('warp', -100);
    expect(neg.progress).toBe(0);
    expect(neg.active).toBe(true);
    expect(neg.departWeight).toBe(1);

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const env = evaluateMask('transwarp', bad);
      expect(env.active).toBe(false);
      expect(env.progress).toBe(1);
      expect(env.destWeight).toBe(1);
      expect(env.effectIntensity).toBe(0);
      expect(env.destSettle).toBe(0);
    }
  });

  it('maintains smooth continuity into the final static frame', () => {
    const duration = MASK_DURATION_MS.warp;
    const at96 = evaluateMask('warp', duration * 0.96);
    const at99 = evaluateMask('warp', duration * 0.99);

    expect(at96.destSettle).toBe(0);
    expect(at99.destSettle).toBe(0);
    expect(at99.destWeight).toBe(1);
    expect(at99.departWeight).toBe(0);
    expect(at99.effectIntensity).toBeLessThan(0.01);
  });
});

describe('createMaskController', () => {
  it('lazily anchors t0 on first sample and fires onMidpoint and onComplete exactly once', () => {
    const onMidpoint = vi.fn();
    const onComplete = vi.fn();
    const controller = createMaskController({
      method: 'warp',
      durationMs: 1000,
      onMidpoint,
      onComplete,
    });

    expect(controller.active).toBe(true);

    const f0 = controller.sample(5000);
    expect(f0).not.toBeNull();
    expect(f0!.progress).toBe(0);
    expect(onMidpoint).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    const f1 = controller.sample(5400);
    expect(f1!.progress).toBeCloseTo(0.4, 6);
    expect(onMidpoint).not.toHaveBeenCalled();

    const f2 = controller.sample(5500);
    expect(f2!.progress).toBeCloseTo(0.5, 6);
    expect(onMidpoint).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();

    const f3 = controller.sample(5800);
    expect(f3!.progress).toBeCloseTo(0.8, 6);
    expect(onMidpoint).toHaveBeenCalledTimes(1);

    const done = controller.sample(6000);
    expect(done).toBeNull();
    expect(controller.active).toBe(false);
    expect(onMidpoint).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    expect(controller.sample(6200)).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('clamps interrupt before midpoint cleanly to arrival without half-swapped state', () => {
    const onMidpoint = vi.fn();
    const onComplete = vi.fn();
    const controller = createMaskController({
      method: 'transwarp',
      durationMs: 2000,
      onMidpoint,
      onComplete,
    });

    const f0 = controller.sample(1000);
    expect(f0!.progress).toBe(0);
    expect(onMidpoint).not.toHaveBeenCalled();

    controller.interrupt();
    expect(controller.active).toBe(false);
    expect(onMidpoint).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(controller.sample(1200)).toBeNull();
    expect(controller.peek(1200)).toBeNull();

    // Idempotent repeat interrupts do nothing.
    controller.interrupt();
    expect(onMidpoint).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('guards backward timestamps and non-finite clocks without stalling', () => {
    const onMidpoint = vi.fn();
    const onComplete = vi.fn();
    const controller = createMaskController({
      method: 'warp',
      durationMs: 1000,
      onMidpoint,
      onComplete,
    });

    const f0 = controller.sample(1000);
    expect(f0!.progress).toBe(0);

    const f1 = controller.sample(1400);
    expect(f1!.progress).toBeCloseTo(0.4, 6);

    // Backward jump cannot rewind progress.
    const back = controller.sample(1100);
    expect(back!.progress).toBeCloseTo(0.4, 6);

    // Non-finite timestamp clamps directly to finished arrival.
    const bad = controller.sample(Number.NaN);
    expect(bad).toBeNull();
    expect(controller.active).toBe(false);
    expect(onMidpoint).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('supports pure peek() without mutating completion state', () => {
    const onMidpoint = vi.fn();
    const onComplete = vi.fn();
    const controller = createMaskController({
      method: 'warp',
      durationMs: 1000,
      onMidpoint,
      onComplete,
    });

    expect(controller.peek(1000)?.progress).toBe(0);
    expect(onMidpoint).not.toHaveBeenCalled();

    controller.sample(1000);
    const pMid = controller.peek(1600);
    expect(pMid?.progress).toBeCloseTo(0.6, 6);
    expect(onMidpoint).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    expect(controller.peek(2500)).toBeNull();
    expect(controller.active).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
