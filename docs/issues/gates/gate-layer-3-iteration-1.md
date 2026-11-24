# Gate — Layer 3, iteration 1 (`perception`)

Recorded 2026-11-23. Scored by the `quality-gatekeeper` seat (read-only) against
`council-layer-3.md` §10, spec §7 row 3 and issue 04 D1–D8. Brief: `gate-layer-3-iteration-1-brief.md`.
Ledger: `base run show 20261123T230542-5fd428d6` (score 6, status failed, evidence hashed).

| | |
| --- | --- |
| Rubric | `perception` |
| Score | **6 / 10** |
| Target | 8 (declared, not moved) |
| Verdict | KEEP and iterate — first iteration, so the two-strike stop does not apply |
| Floor | `npm test` 141/141 pass · `npm run build` clean (the gatekeeper ran both) |
| Not credited | 1650-class floor performance — proxy not available this session |

## The four flaws that hold it at 6

1. **The home star is not findable at 1:1.** Native `layer3-home-star-1080p`: peak luminance
   **0.56**, a 2 px core with a ~5 px halo; surrounding field reaches **0.99**; its warm RGB
   (176,139,97) is the same family as every disc impostor. No hue, size, marker or local gap
   distinguishes it. This is D5's stated acceptance test and the thesis's "good moment".
2. **The nucleus is a clipped, featureless white mass with a hard boundary.** 16 289 px above 0.97
   luminance in a 465×210 bbox (~5.7% of the disc); a flat `1.00` plateau across 180 px and stepped
   contours at the speckle boundary. The generator's own comment promises "a core rather than a
   clipped hole"; the render shows the clipped hole.
3. **The arms do not read.** All three widths and live steps 67–70: a mottled oval with one bright
   arc and one dark lane, no traceable two-arm sweep. The measured m=2 of 0.334 is a density
   number that does not survive as a legible read; the intermediate state (lod 0 → 0.27) is a
   field of identical dots with no band to reinterpret.
4. **No dust band on the boot frame.** `.scratch/live-probe/handoff/step-00.png` vs `layer2-orrery.png`: the
   sky is a near-uniform sprinkle with no coherent stripe. The thesis's three-second read is "a
   faint dust band crosses the sky behind it", and `galaxy-scene.ts` asserts that band exists. The
   evidence contradicts the assertion — the claim needs fixing whichever way the pixels go.

Non-driving, recorded: disc boundary traces an ellipse (soft but traceable, ~80 px falloff);
core sits at (981,396) of 1080 with the lower ~40% empty sky; debug HUD rows; sparse sky.

## Why not 7, and why not 5

Not 7: level 7 allows **one** named rough edge, and requires everything else to meet the level-8
traits. There are four flaws on the main path, and two are not rough edges — findability is a
missing identity, and the arms are the deliverable's own acceptance criterion.

Not 5: the flow is sound. One axis, one rate across the joint (0 decreases, 2 intermediate notches,
one scene-row swap), no extra steps, no dead ends, feedback present. The handoff is continuous.

## Reading the blindspot pass

12 findings, **5 confirmed, 7 rejected** (adjudication in the run note). The rejections matter as
much as the confirmations: "no background stars" is contradicted by measurement (0.34% of sky
pixels above 0.06 at 4K), and the three "blocky clumps / rectangular void / ruler-straight edge"
findings exist only in the 1200→960 downscale — `.scratch/visual-review/layer3/manifest.json` wrongly
labels that copy "at native size". **Fix the manifest label**: it manufactures phantom defects.

## The next iteration, smallest change first

1. **Give the home star identity that survives the field at 1:1** — peak brightness above the
   field's 0.99, a hue outside the disc's warm palette, and a 2–3 px clear gap in the galaxy pass
   around its projected position. This alone moves 6 → 7.
2. **Grade the nucleus** so the plateau breaks (lower bulge/impostor gain).
3. **Make the arms read at 1080p from the 2.6 R camera.**
4. Do not spend the next iteration on the HUD, the sky density or the composition.