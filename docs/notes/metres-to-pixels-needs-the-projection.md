# A large error in metres can be an invisible error in pixels

**Written 2026-11-24**, against `src/render/approach-probe.ts` and
`src/render/system-scene.ts` (commit `f09261e`).
**Demonstrated by:** `npx vite-node .scratch/approach-print.ts`, or
`npx vitest run src/render/approach-probe.test.ts`.

## What happened

The Layer 4 approach probe asked whether the camera can fly from a frame's origin down to a body
inside one frame. Its worst case reported:

```
worst float32 body displacement: 5.29e-05 px (6848.85 m) on Venus at 5 radii
```

**Six point eight kilometres.** Read alone, that sounds like a catastrophic precision failure —
and the first instinct is to go looking for the bug that lets a body drift kilometres off.

It is correct, and the picture is unaffected. The two numbers are not in tension because they
describe different spaces, and dividing one by the other does not produce the answer.

## The cause

Three facts stack:

1. **The stage normalises before rounding.** `buildSceneFrame` computes
   `(objectMetres - cameraMetres) / scale`, where `scale` is the system's outermost orbit. So the
   float32 value is an offset *inside the frame*, about one unit across — never an absolute
   coordinate. This is what ADR-0008's camera-relative path bought.
2. **`scale` is huge.** For a system whose outermost orbit is ~4.5×10¹² m, one display unit is
   4.5×10¹² m. A float32 step near 0.03 units is therefore ~1.7×10⁵ m ≈ 170 km.
3. **A 170 km step is ~10⁻⁵ px** when the body is `radiiOut` away, because the angular size of
   that step is `step / distance` and both are in the same units.

So metres and pixels are related by `scale` and by the distance to the camera. A kilometre-scale
error in world metres can be far below a pixel if the frame is astronomically large.

## The rule

- **Never convert a positional error to pixels from metres alone.** Go through the projection:
  project the exact and the rounded camera-relative point with the same view-projection matrix and
  diff the screen positions. That is what the probe does, and it is the only number that can be
  compared to "one pixel".
- **A float32 step changes only at powers of two.** A decade of distance gives a resolution ratio
  of 8 or 16, never 10. A test that asserts a smooth 10 is asserting that floats are logarithmic.
  (This exact assertion failed once here before it was corrected.)
- **Report both numbers, and say which question each answers.** Metres near the object's origin
  belong to the HUD's "what this picture exaggerates"; pixels belong to "can the eye see it".

## The related trap: the same probe has a real counterweight

The probe passes for the **drawn orrery**, where bodies are exaggerated so they are legible. At
true scale the near plane sits 1,412 real Earth radii out, so a camera cannot reach a surface at
all — that is a Layer 6 depth-range problem, not a rebase one. `trueScaleReach()` reports it, and
its test asserts it, so a future reader does not mistake "approach holds" for "landing is solved".

## Evidence

- `src/render/approach-probe.ts` — `approachReport`, `trueScaleReach`, the thresholds.
- `src/render/approach-probe.test.ts` — the pass, the 4K and 2560 widths, the four directions, the
  negative control that must fail, and the binade assertion.
- `renderer.ts:400` — `planet.center` written into a `Float32Array`, which is why rounding the
  centre is the honest model of what the GPU receives.
- `docs/notes/precision-error-to-pixels.md` — the Layer 1 companion note, same family of mistake.