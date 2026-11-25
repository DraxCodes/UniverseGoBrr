# Gate — Layer 3, iteration 2 (`perception`)

Recorded 2026-11-25. Scored by the `quality-gatekeeper` seat (read-only) against
`council-layer-3.md` §10, spec §7 row 3 and issue 04 D1–D8. Brief:
`gate-layer-3-iteration-2-brief.md`. Ledger: `base run show 20261125T001024-5e8a767f`
(score 7, evidence hashed). Branch scored: `agent/antigravity-layer3-visual-pass` at `ae909ba`,
from `33166f6`.

| | |
| --- | --- |
| Rubric | `perception` |
| Score | **7 / 10** ("nearly clean") |
| Target | 8 (declared, not moved) |
| Delta | 6 → 7 |
| Verdict | KEEP and iterate — one named main-path flaw remains |
| Floor | `npx tsc --noEmit` clean · `npm test` 269/269 in 23 files · `npm run build` clean (97.31 kB / 34.46 kB gzip) · `npm run capture` 20/20 · `probe:live` pass (re-run, see below) · 12-seed metrics reproduced exactly on a fresh `33166f6` build |
| Not credited | 1650-class floor performance — proxy still unavailable; HUD, sky density and composition are out of scope for this iteration |

## The one flaw that holds it at 7

**F1 — the disc reads as a pointillist scatter, not a band of light.** It is the same read on every
seed and every width, worst in the outer arm at 1080p:

- 240×160 window on the arm at (1150, 780) of `layer3-galaxy-1080p.png`: **38% coverage** at
  threshold 0.06 across **332 connected components**, mean component 44 px.
- `layer3-arm-edge-2160p.png` (900×600, native 1:1): **21.6% lit** at 0.08 with hard black gaps;
  104 isolated blobs ≥ 80 px beside the one dense mass.
- The pass is **19.4% sparser** than `33166f6` (lit px mean 132,523 vs 164,443). Brightness moved
  into a narrower core term, and the sparseness is what exposes the grain.

Level 7 is defined as "one named rough edge on the main path"; level 8 requires that remaining flaws
be nits a user would not name. This one is on the main path and a first-time viewer names it.

## What iteration 1's four flaws now read

| Iteration-1 flaw | Then | Now |
| --- | --- | --- |
| Clipped nucleus | 122 px > 0.97 in a 170×196 bbox, global max 1.000 | **0 px** > 0.97 at 1080p and 4K; nucleus max 0.781 (0000) to 0.894 (0002); radial profile 0.716 → 0.56 → 0.46 → 0.38 → 0.15 |
| Arms do not read | hue separation 2.1–10.4°, ridge/trough 3.19–8.02 | **53–169°**, ridge/trough 4.56–14.43 (mean 7.65); warm core plus cool outer sweep |
| Home star unfindable | 0.56 under a 0.99 field, no gap | **0.887** at (960, 539), ring peak 0.672, gap mean 0.0202; found unaided in the 1080p frame |
| No boot dust band | near-uniform sprinkle | band crossing behind the orrery, axis ratio **2.40**, 150,399 faint px |

Also met: `layer3-sol-1080p` max 0.951 with no clipping; `layer2-closeup-ocean` foreground intact;
Layer 1 precision shots `maxDeltaScene = 0` (bit-identical outside the HUD), and the Layer 2/Sol
diffs contain only galaxy points and HUD text — confirmed with amplified diff images, not by eye.

## Rough edges, recorded and not driving the score

- **The dense disc's edge is traceable**: annulus lit-density 62% (r100–140) → 55% → 41% → 29% →
  20% (r220), a ~60 px transition visible at the lower left of the 1080p frame. Soft, not cut. Same
  non-driving item as iteration 1.
- **Seed 0002 reads weakest**: a warm crescent plus a pale scatter, ridge/trough 4.82 against 14.43
  on seed 0005. The deferred density-balance item, improved but not finished.
- **The debug HUD is in every frame.** Out of scope.
- **Identity rests on hue and gap, not brightness, on two seeds**: nucleus max 0.894 (0002) and
  0.888 (0010) exceed the home star's 0.887.

## Two measurement claims not to reuse as written

- `laneToArmWidthRatio` (1.36–2.23) counts cells below the mid-level along radial rings, so the dim
  outer falloff is counted as "lane". Direct ray cuts through the nucleus give lane ≈ arm (0°: lane
  40–60 px vs arm ~50 px; 270°: ~60/60; 180°: ~100/90). The thesis's "lane as wide as the arm" is
  met on the canonical frame; the ratio overstates it.
- `hueSepDeg` compares pale-blue arm pixels with near-neutral dark lane pixels; the hue of a
  near-black is arbitrary. The perceptually real separation is warm core against cool arms.

## Evidence corrections made after scoring

The gate raised three evidence problems; two were the chair's, one was a real invalidation.

1. **The live-probe frames were not from `ae909ba`.** A `vite` dev server rooted at the `33166f6`
   tree had been listening on 5173 since 06:51, so both the "after" and the "before" probe runs hit
   it and produced byte-identical frames (step-80 had 6,025 px > 0.97 and max 1.0, impossible under
   this build's 0.93 clamp). Re-run with each build's own server on dedicated ports: frames differ,
   after step-80 has 0 px > 0.97 and max 0.887, and both builds read `decreases 0, firstRampAt
   step-64, firstFullAt step-68, handoffSteps 4, maxCount 45000`. The handoff leg passes, and the
   4-step ramp is not a regression. Trap recorded in `docs/notes/stale-dev-server-fakes-evidence.md`.
2. **The blindspot pass it saw as empty was the first five-shot manifest.** Split into one shot per
   call, following `docs/notes/blindspot-reviewer-image-size.md`, it returned findings; adjudication
   in the run note. Three findings were downscale artifacts (HUD overprint, square points, which are
   clean at 1:1), one sprite-footprint finding was upheld as real but expected (3–5 px footprint at
   1080p, 6–10 px at 4K, overlapping in the bulge), one home-star finding rested on the chair's own
   wrong crop-centre label.
3. **The home-star crop label was wrong.** The star is at (196, 164) of the 600×380 crop, not at its
   centre. The manifest and brief are corrected; it was a labelling error, not a defect.

## Why not 8, and why not 6

Not 8: F1 is on the main path and a first-time viewer names it; level 8 allows only nits.

Not 6: the four flaws that defined 6 are measurably gone, and F1 is a texture-level rough edge, not
a missing acceptance criterion. The flow is unchanged and continuous.

## The next iteration, smallest change first

1. **Restore disc density** toward the declared 60k budget (45k is used) and/or lift the 0.68
   galaxy-scale exposure floor until the outer arm reads as a band at 1080p, keeping the nucleus at
   0 px > 0.97 and ridge/trough ≥ 4.55. Handed to Neon as iteration 3
   (`agent/antigravity-layer3-density`); the chair re-runs the 12-seed suite and re-gates.
2. Re-check the nucleus clamp and the home-star gap after any exposure change, since both depend on
   the field's brightness.
3. A LOW from the security lens rides along: `sampleFrame` creates its four sample resources above
   the `try` in `src/gpu/renderer.ts`, so an exception before `mapAsync` skips their destroys.
   Pre-existing shape, extended by the new sample texture; move the creations inside the `try`.