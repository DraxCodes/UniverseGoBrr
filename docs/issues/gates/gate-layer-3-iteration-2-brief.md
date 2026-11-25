# Gate brief — Layer 3, iteration 2, `perception`

**Fixed point:** `agent/antigravity-layer3-visual-pass` at `ae909ba`, branched from `33166f6`
(the tip of `wip/layer-3`). Scored by the `quality-gatekeeper` seat, read-only.
**Previous score:** 6/10, `gates/gate-layer-3-iteration-1.md`. The four flaws it named were fixed
before this pass; this iteration addresses the residue it deferred.

## Task

The deferred visual pass (`iterations/layer-3-iteration-2-deferred.md`): tone and colour grading at
the nucleus, per-seed density balance, and reference-image claims. The report of the work is
`iterations/layer-3-iteration-2-neon.md` on the branch.

## Thesis the artifact is scored against

`docs/issues/council-layer-3.md` §10, spec §7 row 3 and §6, issue 04 D1–D8.

- Three seconds on the boot frame: the orrery stays composed; **a faint dust band crosses the sky
  behind it**; the viewer can point at the rest of the universe.
- The good moment: the zoom-out reinterprets that band as the arm containing this star, and the
  star stays **one point the eye can still find** at 1:1, unaided.
- The galaxy must read as a **place**, not a diagram: a two-armed disc of light, a lane as wide as
  the arm, a nucleus that is a core rather than a clipped hole, no stipple mush, no visible disc
  edge, no pop or double exposure across the handoff, one wheel rate.

Friction named by the previous gate: four flaws on the main path; findability is a missing
identity, and the arms are the deliverable's own acceptance criterion. Do not credit the HUD, sky
density or composition work: they were explicitly out of scope for this iteration.

## What changed in this iteration (verified, not taken on trust)

The chair re-ran the floor and the measurement tool on its own build of `ae909ba`, and re-ran the
same tool on a fresh `33166f6` build for the "before" column. Every number below reproduced.

- **Nucleus clipping is gone.** Largest flat-white region (>0.97 on every channel) at 1080p: 0 px on
  all 12 seeds (baseline: 0–15 px, up to 179 px above 0.97). At 4K: 0 px (baseline: 29 px plateau,
  509 px above 0.97).
- **Hue separation between arm and lane** went from 2–10° (effectively one hue) to 53–169°.
- **Ridge/trough at 1080p** across 12 seeds: 4.56–14.43 (baseline: 3.19–8.02).
- **Home star:** peak 0.887 at frame centre, ring peak 0.672 (was 0.780), gap mean 0.0202 vs ring
  mean 0.0318. Unchanged from the fixed baseline — identity not regressed.
- **Boot dust band** (`layer2-orrery`): axis ratio 2.40 (baseline 2.36), 150 399 faint px.
- **Two bars in the handoff brief were stale** and were re-baselined rather than met: the `12 px`
  nucleus, `10.67` ridge/trough and `4.17` band ratio were measured at `5f14277`
  (`GALAXY_VERSION = 4`), before ADR-0011 re-keyed the address. On `33166f6` the same tool measures
  14 px, 3.79 and 2.36. The chair confirmed both columns.
- **Lit pixels fell** from 152 942–169 314 to 113 455–146 365 (−18% mean), and the disc's mean
  luminance is 0.031–0.037, roughly unchanged.
- **Layer 1 precision shots:** 0 changed scene pixels. Layer 2 / Sol frames changed only in the
  background galaxy (population v7, new PSF, gain, boot lift); the foreground is unchanged.
- **Live handoff** (`npm run probe:live`, 81 steps): `decreases 0`, `firstRampAt step-64`,
  `firstFullAt step-68`, `handoffSteps 4`, `maxCount 45000` — **identical on `33166f6`**.

## Floor (chair, on its own build)

`npx tsc --noEmit` clean · `npm test` 23 files, 269/269 · `npm run build` clean (97.31 kB /
34.46 kB gzip; the 260-byte difference from the handoff's figure is CRLF vs LF in the worktree) ·
`npm run capture` 20/20 · `npm run probe:live` pass · 12-seed measurement tool reproduced exactly.

## Evidence

Images (chair's build, `C:\Users\joelp\code\UniverseGoBrr-review\.scratch\captures\`):
`layer3-galaxy-1080p.png`, `-1440p`, `-2160p`, `-2160p-scaled`, `layer3-arm-edge-2160p.png`
(900×600 native 1:1), `layer3-home-star-1080p.png` (600×380 native 1:1), `layer2-orrery.png`,
`layer3-sol-1080p.png`, `layer1-precision-fixed.png` / `-naive.png`.

Review copies at 960 px and the native crops: `.scratch/visual-review/layer3-iter2/`.

Measured 12-seed report: `.scratch/layer3-check/metrics.json` (after) and
`.scratch/base-check/metrics.json` (baseline, same tool, same camera, fresh `33166f6` build).

## What to decide

One score, 1–10, on `perception`, with the named flaws that hold it below the next level, and the
specific evidence for each. Score the artifact the chair built and captured; treat the work
report's own claims as untrusted except where this brief says the chair re-verified them.