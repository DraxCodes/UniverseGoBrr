# Tier masks score 6/10: mechanics ship, finish does not

Written 2026-11-25, against `5f6cdd0..8b5632e` (branch `agent/antigravity-tier-masks`), base 0.7.1.

**Outcome:** the mechanics merged to `main`; the visual finish was deferred to
`docs/issues/tickets/07-tier-mask-finish.md`. The gate scored **6/10** against a target of 8, and the
owner chose to ship the verified mechanics rather than block on polish. The ticket carries the evidence
so the work is not lost.

## What is verified and can be trusted

- `npm test` 280/280 (24 files), `npm run build` clean.
- `npm run probe:masks` **12/12** — re-run by the chair, not taken from the returned claims:
  - mid-effect frame differs from both departure and destination;
  - **end frame is pixel-identical** (`maxChannelDiff === 0`) to both the later static frame and a
    fresh reload of the arrival URL;
  - the HUD address swaps **once**, history +1;
  - Escape, Back, mid-crossing re-travel, and a refused `subspace` jump all clamp cleanly with no
    half-swapped frame.
- `probe:travel` 12/12, `probe:compass` 20/20, `probe:pan` 15/15, `npm run capture` 20/20.
- **Console and GPU validation across three crossings: 0 errors.** Not part of the probe; measured
  separately with `.scratch/mask-console-check.mjs`. The app logs `uncapturederror` to console
  (`src/gpu/device.ts`), so a console listener is sufficient.

## The three flaws holding it at 6 (all in `src/gpu/tier-mask.wgsl`)

1. **Warp focal point is a flat grey disc.** At u≈0.5–0.6 the destination is only ~6% composited
   (`destWeight ≈ 0.06`), so the frame's centre of attention is a ~40 px featureless blob: mean
   luminance 0.4059, max 0.526, against the static star's 0.8807. Visible at 1:1.
2. **Transwarp aperture is veiled.** `tunnel_core` (`1 - smoothstep(0.38, 0.68, u)`) lays a broad
   grey/ivory haze over the arrival scene, leaving the star and rings lower-contrast than the blue rim.
3. **The mask outshines the home star.** `tone_map_mask` uses `ceil_lum = 0.90` and a 0.95 peak, where
   ADR-0015 sets the galaxy at 0.79 so the star (0.8807) stays the brightest thing. Measured:
   `transwarp-early` **0.9921** (52 px >0.95, max channel 1.0), `transwarp-mid` 0.9420 (35 px >0.90),
   `warp-early` 0.9104, `warp-mid` 0.8833, all settled frames 0.8833.

## Evidence gaps in the probe — fix these before scoring the fix

These are probe bugs, not shader bugs, and they will mislead the next iteration:

- **Effect frames are captured only at 1280×720.** The seam declares 1920, 2560 and 3840. A 6 that was
  measured at 1280 cannot be compared with a re-score at 1920.
- **The exit and reveal are never captured.** `warp-late.png` and `transwarp-late.png` are pixel-
  identical to the *settled* frames, so the warp fade (u 0.62→1.0) and the aperture opening
  (u 0.58→0.98) — the two places the veil fix will land — are unobserved.
- **The end check samples after completion** (>1960 ms for a 1600 ms warp), so it proves
  post-completion equality, not last-effect-frame equality. The envelope does fade
  `effectIntensity` to exactly 0 by u=1 and settle to a 1:1 sample, so the design is right, but the
  boundary frame itself is unproven.
- **No human first-run or Tab/focus pass was recorded.**

## Blindspot adjudication (what the second reviewer got right and wrong)

GLM-5.3-flash found 6 items; the gatekeeper confirmed 2, rejected 2, and reclassified 2. Worth
remembering because it shows the pass works:

- **Confirmed:** a soft ghost blob at ≈(452,493) in `warp-mid` (minor); fine evenly-spaced hatch dashes
  in the `transwarp-early` wall (nit).
- **Rejected:** a "stray glyph" before the `T` value — it is a plain `+`, mangled by the console; and
  the blank FPS row, which predates this change and resolves on the first 250 ms stats callback.
- **Reclassified:** "transwarp fully obscures the destination / near-black centre" is **false** — the
  orange star, planets and rings are visible inside the haze. The haze is real; the absence is not.

## What to do

Fix the three flaws in `src/gpu/tier-mask.wgsl` — composite with the destination star as the brightest
element, clamp at 0.887 rather than 0.90/0.95, and attenuate `tunnel_core` inside the aperture — then
widen the probe's widths and add the exit frames before re-scoring. The three flaws and their measured
luminances are in `docs/issues/tickets/07-tier-mask-finish.md`.
