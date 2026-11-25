# 07 - Tier mask finish

**Status:** open, deferred by owner 2026-11-25 (mechanics merged; polish not shipped)
**Where:** `src/gpu/tier-mask.wgsl`, plus `tools/tier-mask-probe.mjs` for the evidence gaps
**Gate:** `perception`, scored **6/10** against a target of 8 on 2026-11-25

The tier masks were merged for their **mechanics**, which are verified. This ticket is the visual
finish that the gate withheld. See `docs/notes/tier-mask-gate-result.md` for the full run.

## What already works - do not regress it

- The warp and transwarp tiers are unmistakably different: warp is a pale radial streak field,
  transwarp is a blue tunnel with an aperture.
- Both entry frames keep the departure scene legible underneath.
- The HUD address swaps **once** at ~0.54 with history +1.
- The end frame is **pixel-identical** to both the static frame and a fresh reload of the arrival URL.
- Escape, Back, mid-crossing re-travel and a refused `subspace` jump all clamp cleanly.
- `probe:masks` 12/12, `probe:travel` 12/12, `probe:compass` 20/20, `probe:pan` 15/15,
  `capture` 20/20, console and GPU validation across three crossings: 0 errors.

## Flaw 1 - the warp focal point is a flat grey disc

At u≈0.5-0.6 the destination is only ~6% composited (`destWeight ≈ 0.06`), so the frame's centre of
attention is a ~40 px featureless blob.

- Measured, 32×32 patch at (633,358): **mean luminance 0.4059, max 0.526**.
- The static star at the same frame measures **0.8807**.
- Visible at 1:1, not just on inspection.

**Done when:** the destination star resolves cleanly through the warp midpoint and is the brightest
element at the focus.

## Flaw 2 - the transwarp aperture is veiled

`tunnel_core` in `tier-mask.wgsl` computes `1 - smoothstep(0.38, 0.68, u)` and lays a broad grey/ivory
haze over the arrival scene. The star, planets and rings are visible but lower-contrast than the blue
rim around them, so the reveal reads as a milky window rather than a clean arrival.

**Done when:** inside the aperture, the arrival scene has at least the contrast it has when static.

## Flaw 3 - the mask outshines the home star

`tone_map_mask` uses `ceil_lum = 0.90` and clamps peaks at 0.95. **ADR-0015 sets the galaxy ceiling at
0.79 specifically so the home star (0.8807) stays the brightest thing in frame.** The mask reverses
that ordering.

Measured maximum luminance per frame:

| Frame | maxLum | px above 0.887 (the star) |
| --- | --- | --- |
| `transwarp-early` | **0.9921** | 148 (52 px >0.95, max channel 1.0) |
| `transwarp-mid` | 0.9420 | 63 (35 px >0.90) |
| `warp-early` | 0.9104 | 20 |
| `warp-mid` | 0.8833 | 0 |
| every settled frame | 0.8833 | 0 |

**Done when:** no mid-crossing frame exceeds the settled star's 0.8833 except where the effect is
deliberately the brightest element, and that exception is recorded as a decision rather than left
implicit. `docs/notes/per-pass-ceiling.md` documents the mask as a fourth writer and must be updated
with the new numbers.

## Evidence gaps - fix these first, or the next score is not comparable

All are probe bugs, not shader bugs.

1. **Widths.** Effect frames are captured only at **1280×720**. The seam declares 1920, 2560 and 3840.
   Shooting the fix at 1280 cannot be compared with the 6 that was measured at 1280.
2. **No exit frames.** `warp-late.png` and `transwarp-late.png` are pixel-identical to the settled
   frames, so the warp fade (u 0.62→1.0) and the aperture opening (u 0.58→0.98) are never observed -
   which is exactly where flaws 1 and 2 will be fixed.
3. **The end check samples after completion** (>1960 ms for a 1600 ms warp), so it proves
   post-completion equality rather than last-effect-frame equality. The envelope is correct by
   inspection (`effectIntensity` reaches exactly 0 and `destSettle` reaches 0 at u≥0.96, collapsing
   `sample_dest` to a 1:1 sample), but the boundary frame itself is unproven.
4. **No human first-run or Tab/focus pass** was recorded.

## Blindspot findings to carry

Confirmed and still open: a soft ghost blob at ≈(452,493) in `warp-mid` (minor), and fine evenly-spaced
hatch dashes in the `transwarp-early` wall (nit, a texture tell at 2×).

Rejected, do not re-investigate: the "stray glyph" before `T` is a plain `+` mangled by the console;
the blank FPS row predates this change and resolves on the first stats callback; and "transwarp fully
obscures the destination" is false - the arrival scene is visible inside the haze.

## Owner decision this ticket records

Merging a 6/10 surface was deliberate. The mechanics are verified, nothing regressed, and the app has
more context now than it did before the masks existed. The finish is deferred, not abandoned, and it
must not be mistaken for done: **a later session reading "tier masks shipped" should read this ticket
before assuming they were polished.**
