# Gate — Layer 3, iteration 3 (`perception`)

Recorded 2026-11-25. Scored by the `quality-gatekeeper` seat (read-only) against
`council-layer-3.md` §10, spec §7 row 3 and issue 04 D1–D8. Brief:
`gate-layer-3-iteration-3-brief.md`. Ledger: `base run show 20261125T021249-a62f2277`
(score 8, evidence hashed).
Branch scored: `agent/antigravity-layer3-density` at `e237545`, from `ae909ba` (iteration 2).
Merged as `87ddcc1` (no-ff) once the score landed.

| | |
| --- | --- |
| Rubric | `perception` |
| Score | **8 / 10** ("clean and clear") |
| Target | 8 (reached; no 10 demanded) |
| Delta | 6 → 7 → 8 |
| Verdict | **SHIP** |
| Floor | `npx tsc --noEmit` clean · `npm test` 269/269 in 23 files (re-run by the gate) · `npm run build` clean 97.35 kB / 34.49 kB gzip · `npm run capture` 20/20 · `probe:live` pass on an isolated port, listener proven · 12-seed metrics and both coverage numbers reproduced exactly by the chair and by the gate's own flood fill |
| Not credited | 1650-class floor performance — proxy still unavailable; HUD, sky density and composition are out of scope |

## Why it is 8 and not 7

Level 7's definition is "one named rough edge remains on the main path". The single flaw that
defined 7 — F1, the disc reading as a pointillist scatter — is measurably gone where it read worst,
with no new main-path flaw:

| F1 measure (same tool, same thresholds, both builds) | `ae909ba` | `e237545` |
| --- | --- | --- |
| arm window 240×160 at (1150,780), 1080p, >0.06 | 38.0%, 332 components, mean 44.0 px | **55.0%, 135 components, mean 156.4 px** |
| 4K 1:1 arm crop 900×600, >0.08 | 21.6%, 1,841 components, 103 blobs ≥80 px, largest 81,441 px | **31.1%, 1,321 components, 77 blobs ≥80 px, largest 135,059 px (80.5%)** |
| lit px mean over 12 seeds | 132,523 | **194,635** (174,238–208,226) |
| ridge/trough 1080p | 4.56–14.43, mean 7.65 | **5.82–15.61, mean 8.98** |

The gate recomputed the arm window with its own flood fill and matched the brief to the digit. It
also sampled an arm **interior** patch at (1160,790): **99.2% lit at >0.06 and 0.0% below 0.02**, and
a lane patch at (1390,700): 9.4% lit, mean 0.037 against 0.21 in the arm. The band is continuous and
the lane is still open.

## What it does better than iteration 2

| | iteration 2 (`ae909ba`, 7/10) | iteration 3 (`e237545`, 8/10) |
| --- | --- | --- |
| Arm interior | dot field on black | 99.2% lit, no dark cells |
| Nucleus on the two worst seeds | 0.894 (0002), 0.888 (0010) — above the home star | 0.811, 0.810 — below 0.887 on all 12 |
| Nucleus shape | graded, 0 px clipped | graded and monotone: 0.704 → 0.586 → 0.373 → 0.213 → 0.105 → 0.061 |
| Boot band | fine sprinkle, spikes to 0.726 | smoother band, maxima 0.562–0.683, planet contrast byte-identical |
| Home star | 0.887 over ring 0.672 | 0.887 over ring 0.646 |

## Rough edges, recorded and not driving the score

These are the level-9 tail, not reasons to iterate. Kept for the next Layer 3 touch.

1. **4K 1:1 micro-texture is uniform pebbles.** Impostor footprint is 4.65–5.05 px ("4.71–5.05 px"
   at 1080p in the gate's read) and doubles at 4K; `sizeBias` is now constant, so there is no
   per-star size cue inside the band. Reads as light at 1080p/1440p/960; reads as equal-size grain
   only at 1:1 4K. The smallest future change is a ±0.6 px size spread if a viewer ever names it.
2. **Boot-frame band texture is blotchier at 1:1** (upper-left of `layer2-orrery.png`). It reads as
   dust, which is the thesis, but the grain is coarser than iteration 2's. Measured: band patch
   means flat or slightly down (0.131→0.121, 0.149→0.167, 0.117→0.123, 0.136→0.116, 0.162→0.155,
   0.076→0.069), brightest planet patch 0.326→0.313 mean and **0.859 max in both builds**.
3. **Outer-disc halo mottling and the traceable soft edge.** Bottom-left 100×60 patch at (700,900)
   mean 0.0221 vs corner (1500,400) 0.0148; the blindspot reviewer measured 0.0139 vs 0.0091–0.0099.
   Same edge iteration 2 recorded. No hard rim.
4. **The home-star isolation metric overstates its margin.** The tool's ring is 12–60 px; the
   nearest bright competitor is a 1-px sky star at 0.788, **64 px** away, so the true nearest ratio
   is 1.13×, not the quoted 1.37×. Findability still holds on core size and the dark gap: a 7×7
   table at (956–964, 535–543) shows a 4×4 core at 336–880, a halo of 71 at 2 px, one 1-px peak of
   887, and this is the frame's only pixel above 0.79.
5. **"The arm containing this star" is generous.** The star sits ~120–180 px from the arm ridge, in
   the disc in a lane near the arm (annulus means 0.047 @r60, 0.074 @r100, 0.100 @r120–150, against
   0.21 in the arm interior). Unchanged by this iteration; a wording question for the thesis, not a
   defect.

## The three flagged attacks, answered

1. **Near-uniform sprite size** — the disc reads as a band; the depth cue survives at disc scale
   (radial mean 0.704 at the core → 0.586 @r12 → 0.373 @r40 → 0.278 @r60 → 0.190 @r120 → 0.061
   @r220), not per-star. It is rough edge 1, not a main-path flaw.
2. **+13.6% mean luminance and +46% boot faint pixels** — spread into a smoother, wider,
   **no-brighter** band; the orrery's contrast is byte-identical. It has not become a bright wall.
3. **Ceiling down to 0.79 and an earlier core ramp** — the nucleus is graded and unclipped, not dim
   or flat: 0 px above 0.90, 0.93 or 0.97 outside the HUD at 1080p; warm-core peak 0.7085 at
   (1151,688), RGB (218,176,117), inside the 0.79 ceiling; radial profile smooth and monotone. Seed
   0004's nucleus at 0.726 is dimmer, not flatter.

The `maxLum` 0.865 anomaly raised during verification is explained and is not clipping: it is a
blue-white sky star at a fixed position showing through a semi-transparent arm pixel
(`core_alpha < 1`). Draw order is sky → galaxy composite (premultiplied `one`/`one-minus-src-alpha`)
→ orrery (`renderer.ts:524-561`). Where mapped luminance is > 0.48 the galaxy's alpha is 1 and the
composite cannot exceed 0.79, so the nucleus is at or below its ceiling.

## Evidence corrections and verification

- **The gate verified both native crop offsets pixel-exact**, which closes the chair's repeated
  labelling trap: `layer3-arm-edge-2160p.png` equals a 900×600 cut of the 4K frame at **(2061,736)**
  with **0 differing pixels** (offsets ±1 differ on 155k/187k px), and `layer3-home-star-1080p.png`
  equals a 600×380 cut at **(764,375)** with 0 differing pixels and peak 0.8871 at (196,164).
- **Layer 1 invariant holds:** `layer1-precision-fixed` differs in 52 px, all inside a 7×8 block at
  x115–121, y297–304 — the HUD compass row. `maxDeltaScene = 0`.
- **Foreground invariant holds:** `layer3-sol-1080p` 0 changed px within ±7 of the solar core;
  `layer2-closeup-ocean` 0 changed px within r=120 of the planet centre. The amplified ocean diff
  contains galaxy points only.
- **Blindspot pass:** five single-shot calls, 0 paired, 9 reviewer-only. Six rejected (four
  hallucinated HUD rows read from 960 px copies, one "dangling /" that is the `status ↗` control,
  one home-star "no orrery" that is my brief's misleading foreground sentence), one confirmed as a
  nit (bottom-left haze), one confirmed as a question (the starless inter-arm lane), one split —
  "single-pixel speck" rejected on the 7×7 table, "modest margin" confirmed as evidence rough edge
  4. `galaxy-2160p-scaled` returned 0 findings after a schema retry. Adjudication:
  `.scratch/visual-review/layer3-iter3/adjudication.md`.

## Floor detail

`npx tsc --noEmit` clean · `npm test` **269/269 in 23 files** · `npm run build` clean
(97.35 kB / 34.49 kB gzip) · `npm run capture` **20/20** · `npm run probe:live` pass on isolated
port 5201, listener command line proven to be the density worktree: `decreases 0`,
`firstRampAt step-64`, `firstFullAt step-68`, `handoffSteps 4`, `maxCount 60000`. Build fingerprint:
`step-80.png` has **0 px above 0.97** outside the HUD, max 0.8871 at the home star and 0.7828
next-brightest at the nucleus — matched independently by the gate on the 1080p frame.

## Security lens

PASS, no findings. Five claims confirmed: no shader NaN/Inf reachable with the new constants
(worst-case HDR accumulation ≈ 18,000 ≪ 65,504, so no Inf, so no Inf/Inf); `measureRegionCoverage`
is bounds-checked and terminates (region clamped, arrays sized rw·rh, neighbour pushes guarded,
`seen` set at push time); the tool stays inert, loopback-only, with no write outside its output
directory and no `eval`; no test bound weakened (no test file touched; the 60,000 budget assertion
now binds at equality, 5,000 + 55,000, which is tight rather than vacuous); no secret, personal path,
network call or storage write, and `GALAXY_VERSION 7 → 8` is appearance-only. Two informational
notes, no action: a pre-existing unreachable Inf→NaN path in the tone curve that this diff cannot
reach and only lowers magnitudes toward; and the exposure test's 0.68 lower bound is now slack
against the 0.80 floor, so a future drop to 0.70 would pass silently.

## Routed work, applied with the merge

- **The iteration-2 security LOW is fixed** alongside the merge: `sampleFrame` in
  `src/gpu/renderer.ts` now creates its four sample resources inside the `try`, so a failure before
  `mapAsync` still reaches the `finally` and releases what was allocated. `tsc` clean, 269/269 after.

## Why the loop stops

Score moved 6 → 7 → 8 with the same rubric, the same target and no change to the judge. The named
main-path flaw is fixed, nothing new is named on the main path, the floor is green, and two
independent blindspot passes found no defect that survives native-resolution adjudication. The
remaining items are the level-9 tail and are routed to the next Layer 3 touch, not another
iteration.