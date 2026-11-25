# Gate brief — Layer 3, iteration 3, `perception`

**Fixed point:** `origin/agent/antigravity-layer3-density` at `e237545`, branched from `ae909ba`
(iteration 2). Scored by the `quality-gatekeeper` seat, read-only.
**Previous scores:** 6/10 at iteration 1, 7/10 at iteration 2. Iteration 2 named exactly one
main-path flaw, F1: the disc read as a pointillist scatter rather than a band of light.

## Task

Restore disc density so the arm reads as a band of light at 1080p and 1:1 at 4K, without
reintroducing clipping or filling the lanes. The work report is
`docs/issues/iterations/layer-3-iteration-3-neon.md` on the branch; it is untrusted except where
this brief says the chair re-verified it.

## Thesis the artifact is scored against

`docs/issues/council-layer-3.md` §10, spec §7 row 3, issue 04 D1–D8.

- Three seconds on the boot frame: the orrery stays composed; a faint dust band crosses the sky
  behind it; the viewer can point at the rest of the universe.
- The good moment: the zoom-out reinterprets that band as the arm containing this star, and the
  star stays one point the eye can still find at 1:1, unaided.
- The galaxy must read as a **place**, not a diagram: a two-armed disc of **light**, a lane as wide
  as the arm, a nucleus that is a core rather than a clipped hole, no stipple mush, no visible disc
  edge, no pop or double exposure, one wheel rate.

## What changed in this iteration (chair re-verified on its own build)

Five files, no test file touched, no change to `capture/shots.json`, `opencode.json`, `.opencode`
or `AGENTS.md`.

- Rich disc population 40,000 → **55,000** (tier total exactly 60,000, the declared budget).
- Disc emission `base` → `0.73·base^0.42`; bulge `base` → `0.72·base`.
- Impostor PSF: core exponent 6.5 → 3.2, tail 0.18 → 0.28; footprint `3.0–5.0 px` →
  **`4.65–5.05 px`** at 1080p; `sizeBias` now a constant `0.15·lod` (was distance-dependent).
- `GALAXY_GAIN` 0.56 → **0.194**; tone ceiling `ceil_lum` 0.90 → **0.79**; core-occlusion ramp
  `smoothstep(0.10,0.65)` → `(0.08,0.48)`.
- Exposure `min(1.55, max(0.68, distRatio^-1.25))` → `min(1.55, max(0.80, distRatio^-0.40))`.
- `discBootLift` `1 + 0.25·(1−lod)` → **`1 − 0.12·(1−lod)`** — the boot disc is now dimmed 12% at
  `lod 0`, not lifted.
- `GALAXY_VERSION` 7 → 8. `GALAXY_STREAM_VERSION = 3`, `PLACEMENT_VERSION = 2` unchanged.
- `tools/measure-layer3.mjs` gains `maxLumAt` and `measureRegionCoverage` (4-connected flood fill
  over a rect at a luminance threshold). Additive; the existing metrics are unchanged.

## The F1 measurement, before and after, same tool, chair's builds

| Measure | `ae909ba` | `e237545` |
| --- | --- | --- |
| arm window 240×160 at (1150,780), 1080p, >0.06 | **38.0%**, 332 components, mean 44 px, largest 9,810 px | **55.0%**, **135** components, mean 156.4 px, largest 13,130 px |
| 4K 1:1 arm crop 900×600, >0.08 | 21.6%, 1,841 components, 103 blobs ≥80 px, largest 81,441 px | **31.1%**, 1,321 components, **77** blobs ≥80 px, largest 135,059 px (80.5%) |
| lit px mean (12 seeds) | 132,523 | **194,635** (174,238–208,226) |
| mean luminance | 0.0337 | 0.0383 (0.0366–0.0396) |
| ridge/trough 1080p | 4.56–14.43, mean 7.65 | **5.82–15.61, mean 8.98** |

The chair reproduced both columns exactly by building `ae909ba` and `e237545` and running the new
tool against each set of captures. Neon's before/after claims are therefore confirmed, not taken on
trust.

## Regressions checked

- **Nucleus:** 0 px plateau and 0 px above 0.97 on all 12 seeds at 1080p; 4K plateau 0, above-97 0.
  Nucleus max luminance 0.726–0.865, all below the home star's 0.887.
- **`maxLum` above the 0.79 ceiling explained:** the reported 0.865 pixel is blue-white (214,220,245)
  at a *fixed* location across seeds, and it is a sky star showing through a semi-transparent arm
  pixel (`core_alpha < 1`). The draw order is sky → galaxy composite (premultiplied
  `one`/`one-minus-src-alpha`) → orrery (`renderer.ts:524-561`). Where the galaxy's mapped luminance
  is > 0.48, alpha is 1 and the composite's own output cannot exceed 0.79. So the *nucleus* is at or
  below its ceiling; the 0.865 is not galaxy light and not clipping.
- **Home star:** peak 0.887 at (960,539) and (196,164), ring peak 0.646 (was 0.672), gap mean 0.0209
  (was 0.0202). Its brightness ratio over the local field improved, because the field's ring peak
  fell.
- **Dust band:** axis ratio 2.41 (was 2.40), faint px 150,399 → **219,629**, sky floor 0.0247.
- **Layer 1 precision shots:** `maxDeltaScene = 0`, `changedScene = 0/1880100` — bit-identical.
- **Layer 2 / Sol:** 43k–1.44M scene pixels changed (galaxy points), `maxDeltaScene` 124–165. The
  chair rendered amplified diff images for `layer2-orrery`, `layer3-sol-1080p`,
  `layer2-closeup-ocean` and `layer2-closeup-gas`: they contain galaxy points and faint HUD text
  only — no planet surface, no solar disc, no orbit ring.

## Floor (chair, own build of `e237545`)

`npx tsc --noEmit` clean · `npm test` 23 files, **269/269** · `npm run build` clean (97.35 kB /
34.49 kB gzip) · `npm run capture` **20/20** · `npm run probe:live` pass on an isolated port 5201
with the listener command line proven to be this worktree: `decreases 0`, `firstRampAt step-64`,
`firstFullAt step-68`, `handoffSteps 4`, `maxCount 60000`. Build-specific proof that the frames
came from this build: `step-80.png` has **0 px above 0.97** outside the HUD, max 0.8871 at the home
star and 0.7828 next-brightest at the nucleus, both inside the 0.93 channel clamp.

## Evidence

Images (chair's build, `C:\Users\joelp\code\UniverseGoBrr-density\.scratch\captures\`):
`layer3-galaxy-1080p.png`, `-1440p`, `-2160p`, `-2160p-scaled`, `layer3-arm-edge-2160p.png`
(900×600 native 1:1, cut at (2061,736) of the 4K frame), `layer3-home-star-1080p.png` (600×380
native 1:1, cut at (764,375); the star is at crop (196,164)), `layer2-orrery.png`,
`layer3-sol-1080p.png`, `layer1-precision-fixed.png` / `-naive.png`.

960 px review copies and native crops: `.scratch/visual-review/layer3-iter3/`.
Measured 12-seed report: `.scratch/layer3-density/metrics.json`; before column
`.scratch/before-check/metrics.json`, and `ae909ba`'s own captures remain in
`..\UniverseGoBrr-review\.scratch\captures\`.

## Blindspot pass (untrusted; chair adjudicated)

Five single-shot calls. `galaxy-2160p-scaled` returned **0 findings** after a schema retry. Surviving
findings: the bottom-left haze (measured 0.0139 vs 0.0091–0.0099 in other corners — the outer disc,
nit); an enclosed inter-arm void with no faint sprinkle (a design question, nit); and the home star
reading as a single speck, peak 0.887 vs ring peak 0.646, gap present. Three "major" findings were
rejected: two hallucinated HUD rows at 960 px, and one "missing HUD" that came from the chair
mislabelling the `arm-edge` crop offset as (0,0) instead of (2061,736). Full adjudication:
`.scratch/visual-review/layer3-iter3/adjudication.md`.

## What to judge, and the changes most likely to be flaws

Score the artifact, not the report. Three changes in this iteration are worth attacking explicitly:

1. **Sprite size is now almost uniform** (4.65–5.05 px, `sizeBias` constant). Overlap is bought by
   making every impostor nearly the same size. Does the disc now read as a band, or as uniform
   popcorn/cloud with no depth cue?
2. **Mean luminance rose 13.6%** (0.0337 → 0.0383) and faint pixels in the boot frame rose 46%
   (150k → 220k). Does the boot dust band still sit *behind* the orrery, or has it become a bright
   wall competing with the planets?
3. **The tone ceiling came down to 0.79** and the core-occlusion ramp moved earlier. Does the
   nucleus still read as a graded core, or has it gone dim/flat (seed 0004's nucleus max is 0.726,
   well below the others' 0.8)?

## What to decide

One score, 1–10, on `perception`, with the named flaws that hold it below the next level and the
specific evidence for each. Do not credit the HUD, sky density or composition: out of scope.