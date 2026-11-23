---
date: 2026-11-23
verified_against: vitest 5.1.1, Layer 2 orbit controls + Layer 3 nit pass
files: [src/input/orbit-controls.ts, src/input/orbit-controls.test.ts]
status: active
---

# A clamped distance round-trips ±1 ulp, so `while (distance > min)` never exits

**Symptom.** `npm test` printed `RUN v5.1.1` and then nothing for sixteen minutes. The vitest
worker sat at 100% CPU (CPU time climbing ~1 s/s) with no test file listed. It looks exactly
like a slow Vite cold transform; it is a busy loop, and only the CPU-time delta tells them
apart (a slow transform makes progress and eventually prints; a loop never does).

**Cause.** `zoomBy` clamps with `Math.min(max, ...)`, so it returns a camera at exactly `min`
or `max`. But the camera is stored as position + angles, and `zoomBy` rebuilds the position via
`orbitTo` (`sin/cos × distance`); `orbitDistance` then takes `Math.hypot` of three components.
That round trip is not exact: it returns `min + 1 ulp`. A test written as

```ts
while (orbitDistance(camera) > MIN_DISTANCE_FACTOR * SCALE) camera = zoomBy(camera, 0.7, SCALE);
```

therefore never satisfies its exit condition — every iteration clamps to `min`, and every
measurement reads `min + 1 ulp`. Same failure at the max end.

**What to do instead.**

1. **Never loop until a floating-point comparison flips.** Use a fixed iteration count and
   `toBeCloseTo`, which is what the pre-existing zoom tests already did
   (`for (let step = 0; step < 200; step += 1)`). The loop I replaced them with was the bug.
2. **Compare "at the limit" with a relative tolerance**, not equality. `zoomEdge` in
   `src/input/orbit-controls.ts` uses `distance >= max * (1 - 1e-9)`; 1e-9 is far below any
   visible difference and far above the round-trip error.
3. **Cap every test loop in a new test.** A runaway test hangs the whole session, not just
   the file.

**Evidence.** The bad loop was in `src/input/orbit-controls.test.ts`; after bounding it the
same suite reports `13 passed (13) · 107 tests · Duration 521ms` (probe: `npm test`).