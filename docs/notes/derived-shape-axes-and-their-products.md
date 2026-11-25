---
date: 2026-11-25
verified_against: 93eaf89 + Slice B working tree (ticket 06, item 4)
files:
  - src/universe/disc.ts
  - src/render/galaxy-scene.ts
  - src/render/arm-measure.test.ts
  - tools/galaxy-gallery.mjs
status: active
---

# A generated shape's variety axes are not its parameters — check the product

## The trap

The galaxy variation law draws one galaxy's shape from its own stream. The first cut drew
`winding` (radians of turn per scale length) and `scaleLengthFraction` as two independent fields,
each in a range taken from the old fixed design (`winding` 1.6–3.2, scale 0.28–0.45). Every field
was in range; the code was "a variation of the law"; the tests passed.

Four of twelve galaxies drew radial spokes around a dark pinwheel instead of arms.

**Cause: the arm's total turn from centre to rim is `winding / scaleLengthFraction`, a product of
two draws, and nothing bounded the product.** Across twelve galaxies it fell anywhere from 217° to
561°. Below roughly 300° the swoop through the nucleus is shallow enough that the lane between two
arms is a wedge rather than a lane, and the disc reads as spokes. Measured ridge/trough density
ratio: **1.3** on those galaxies against 10–16 on the tight ones. The old fixed design happened to
sit at `2.4 / 0.36` = 382°, so nobody had ever had to know this.

## How it was found, and what nearly hid it

The pixel-level measurement harness disagreed with the images and with itself: it scored `v1/3` at
1.63 (bad) when `v1/3` was a clean three-arm spiral, and `v1/9` at 8.66 (fine) when `v1/9` was one
of the loose ones. The harness reverse-maps screen pixels to world positions, and stars pushed out
of the local field's exclusion sphere break that mapping. **The images were right; the proxy was
wrong.** Trust the render over the reverse-mapped metric when they disagree, and say which one you
believed.

What did catch it: `tools/galaxy-gallery.mjs`, twelve galaxies each framed at 2.6× its **own**
radius. One manifest shot of one galaxy cannot show a law's tail.

## What to do instead

1. **When a shape axis is a derived quantity, draw the derived quantity and compute the parameters
   from it.** Here: draw `armSweepRad` (378°–550°) and set `winding = sweep · scaleLengthFraction`.
   The variety axis a viewer sees is how far the arm winds, so that is what is drawn.
2. **Bound the product, and assert it.** `galaxy.test.ts` ("draws a real spiral at every arm count
   and pitch") checks the sweep range, the derivation, and a per-galaxy harmonic amplitude at that
   galaxy's own arm count. A re-introduced free draw fails the sweep assertion.
3. **Judge a generator as a law, not as a sample.** Capture a gallery across the whole draw range
   before believing the single framed shot. `node tools/galaxy-gallery.mjs --out .scratch/gallery`
   (needs `npm run build`, port 4174 free).
4. **Measure at the galaxy's own arm count.** A four-armed field measured at `m = 2` reports the
   beat between its two pairs — near zero for a *good* galaxy. Anything that asserts "the arms are
   still there" must use `m = armCount`.

## Evidence

- Before: twelve galaxies measured `sweep` 217°–561°, ridge/trough 1.3–16.7 (`v1/4` 1.77, `v1/6`
  1.70, `v1/9` 1.34).
- After: `sweep` 381°–544°, ridge/trough 4.99–13.62, all twelve galleries read as spirals.
- `src/universe/disc.ts` `ARM_SWEEP_MIN_RAD` / `ARM_SWEEP_MAX_RAD` and the `GalaxyShape` comment.
- `src/render/arm-measure.test.ts` output: m=2 mean 0.4116, m=3 0.4060, m=4 0.3889 — the numbers
  the HUD normaliser is now calibrated to.
