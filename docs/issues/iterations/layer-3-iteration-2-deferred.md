# Layer 3 iteration 2 — deferred

Date: 2026-11-24
Branch: `wip/layer-3`
Gate: `docs/issues/gates/gate-layer-3-iteration-1.md` (6/10)

## Decision

Layer 3 iteration 2 (the second `perception` pass toward an 8/10) is **deferred**, not abandoned.
The four flaws the gate named are fixed and measured; the remaining gap is polish that a stronger
visual model is better placed to judge. Layer 4 is the next real skeleton piece, and nothing in it
depends on the galaxy scoring 8/10.

The `perception` gate itself is **not** deferred as a mechanism and is **not** handed to
Antigravity/Neon: gate scoring stays in this workflow (see `AGENTS.md` → *Antigravity / Neon
handoffs*). If a later visual pass returns with changes, it is re-gated here.

## What the four flaws measured at, after the fixes

| Flaw | Before | After | Evidence |
| --- | --- | --- | --- |
| D2 clipped nucleus | 109 px flat white plateau | 12 px | `npm run capture`, `layer3-galaxy-2160p` |
| D5 home star not findable | peak 0.56, tied with the field's 0.99 | peak 0.887 at exact frame centre + `HOME_GAP_PX` ring | home-star crop |
| D3 arms not readable at 1080p | — | ridge/trough **10.67** at 1080p vs 9.65 at 4K | `.scratch/arm1080.ts` |
| D4 no dust band on the boot frame | band axis ratio 1.25 | 4.17, ~52 000 lit px, real disc population | `GALACTIC_PLANE_TILT_RAD` -30° |

Supporting measurement: the tilt is a **pure rigid rotation** of the same population (max relative
difference 3.9e-16 on disc-only rows), so `GALAXY_STREAM_VERSION = 3` keeps the stream stable while
`GALAXY_VERSION = 4` re-pins shared links.

## What is left, for the deferred pass

These are the known gaps. None blocks Layer 4.

1. **Tone and colour grading.** The disc still reads slightly hard at the nucleus edge on some
   seeds, and the palette is close to but not matching the reference's warmth. The gate's headline
   complaint. Needs a judgement call on the curve, not a bug fix.
2. **Density balance across seeds.** `ARM_CONTRAST_FULL` is now 0.42 (measured modulation 0.427,
   range 0.422–0.441 across 12 seeds), so the crossfade no longer saturates. Per-seed density still
   varies more than it should at the low arm-contrast end.
3. **Reference-image claims.** Only one reference survived triage
   (`docs/reference/arm-legibility-eight-arm-pointcloud.png`, 652×366, 8-armed). It is mechanism
   evidence only — never a target, and not its density, point size or palette. Any new claim of
   "matches the reference" has to be argued from a measurement, not an impression.

## Brief for whoever picks this up

- Read the gate scorecard first: `docs/issues/gates/gate-layer-3-iteration-1.md`. It names the four
  flaws and the rubric lines they cost.
- The camera must stay inclined with the disc: `GALLERY_PITCH = PITCH + GALACTIC_PLANE_TILT_RAD`.
  The generator rotates the disc about x, so `orbitTo(0, PITCH)` looks **along** the plane and `lod`
  correctly collapses to 0.016. Measured: `orbitTo(0, PITCH)` → 0.016, `PITCH + tilt` → 1.000.
- Do not tune a bound to make a test pass. `armModulation < 0.6` and the trough floor caught `cos⁸`
  degenerating into filaments; a weakened bound hides the regression rather than recording it.
- Re-run the blindspot pass at `--max-tokens 6000` (see `docs/notes/blindspot-reviewer-image-size.md`)
  and the native-size crops — the "at native size" label is now true, the crops are copied verbatim.
- Ship criterion is unchanged: `perception` ≥ 8/10, with `npm test`, `npm run build` and
  `npm run capture` green as the floor.

## Regression fixed during the deferral

Two real defects were found and fixed while wrapping up, both recorded in
`docs/notes/inverted-smoothstep-erases-field.md`:

- The home-star gap inverted its own `smoothstep` edges below `lod 0.7`, erasing the whole galaxy at
  intermediate legibility (reported as "disappears at some pitches" and "vanishes then reappears
  while zooming in"). Both edges now scale from the same value.
- The HUD's scene row keyed off `lod`, which folds in `inclination`, so a straight edge-on zoom-out
  read "K-type · 9 planets" at galaxy scale. It now reads `identity = fit × resolved`.

Regression coverage: `never erases the galaxy at an intermediate crossfade`,
`keeps the galaxy lit across every pitch`, and `labels the galaxy by scale, not by whether its arms
are turned toward us`. All three fail on the old code.
