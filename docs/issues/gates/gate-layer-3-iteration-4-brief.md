# Gate brief — Layer 3, iteration 4, `perception`

**Fixed point:** the working tree of `main` at `93eaf89` plus the uncommitted Slice B change
(`git diff HEAD` = 16 files, 801 insertions, 262 deletions; new `src/render/arm-measure.test.ts`
and `tools/galaxy-gallery.mjs`). Scored by the `quality-gatekeeper` seat, read-only.
**Rubric:** `perception`, target 8. **Previous scores:** 6, 7, 8. The prior 8
(`.scratch/runs/layer3-iteration3-gate.json`) is the honest baseline for this comparison, not a
pass: this iteration changes the art and must earn its own score.

## Task

Ticket 06, work item 4 — the galaxy variation law. Until this change every galaxy in the universe
was one fixed design at one fixed size (`GALAXY_RADIUS_M = 5e20`, two arms at winding 2.4, scale
0.36 R, one bulge, no bar, no halo, no dust, one palette). Now each galaxy draws, from its own
stream `seed|addr|shape|v1`:

- **size** — radius 0.5e20..9.0e20 m (18×), linear on the size fraction the sector count already
  uses, so a galaxy cannot be sized differently from the way it is sliced;
- **arms** — 2, 3 or 4 (50/25/25);
- **arm sweep** — 378°..550° of turn from centre to rim, with the log-spiral pitch derived as
  `sweep · scaleLengthFraction`;
- **scale length** 0.28..0.45 R; **bulge** 3–14% of stars in a 0.09–0.20 R flattened spheroid;
- **bar** 0–0.35 (bulge elongation along the first arm); **halo** 0–3% on a 2.2× radial tail at
  3× the disc height; **dust** 0–0.35 lane emission depression; **colour age** 0..1, red to blue.

Every framing, legibility threshold, zoom ceiling, exposure correction and star distance now uses
the galaxy's **own** radius.

## Thesis the artifact is scored against

Spec §7 row 3, ticket 06 items 1–2: *"Galaxies are varied — arm count, shape, density, size,
colour, nucleus — not one law with a different seed. Variety is what makes a field of them read as
a universe."* The owner's answer on scope: **shape, appearance and size**, and "very wide, real
spread" on size; halo/dust "honest minimal". The owner's answer on the home galaxy: **one sample of
the law** — `v1/0` is not pinned, and its boot frame and Sol backdrop change with it.

The good moment: a viewer who has seen one galaxy and then travels to another sees a **different
object** — different size, different arms, different colour — and each one still reads as a galaxy:
a band of light on a spiral, a lane as wide as the arm, a graded nucleus, no visible disc edge, no
stipple mush.

## What changed (chair's own build)

Files: `src/universe/disc.ts` (the shape law, `galaxyShape`, `galaxyRadiusM`, `REFERENCE_SHAPE`,
halo/bulge/bar in `sampleDiscStar`, `armStrength` width tied to arm spacing), `src/universe/galaxy.ts`
(`GALAXY_VERSION` 9→10, `APPEARANCE_VERSION` 8→9, dust, halo tint, shape-threaded bulge/colour,
`radius`/`shape` on `Galaxy`), `src/render/galaxy-scene.ts` (per-galaxy `galaxyMaxDistanceM`,
`armModulation` at the galaxy's own `m`, per-arm-count normaliser, radius-scaled legibility and
exposure), `src/render/scale.ts` (MIN/MAX/REFERENCE radii, `galaxyFramingDistanceM`, void anchor on
the min radius), `src/universe/navigation.ts` (`galaxyFraming(centre, radiusM)`),
`src/universe/placement.ts` (`inHalo`, `PLACEMENT_VERSION` 2→3), `src/main.ts` (per-galaxy ceiling
and debug rows), `capture/shots.json` (galaxy cameras scaled by the `v1/4` radius ratio; address
`v1/4.0.-2.7` → `v1/4.1.-2.7` because star −2 now derives sector 1 under the new law),
`tools/measure-layer3.mjs` (camera and address derived instead of pinned).

`GALAXY_SHAPE_VERSION = 1` is a new stream; `GALAXY_STREAM_VERSION = 3` and `SCALE_VERSION = 1` are
unchanged.

## The correction this iteration carries, and why it is the thing to attack

The first cut of the law drew **winding** (radians per scale length) and **scale length**
independently. Their *ratio* is the arm's total turn from centre to rim, and that ratio is what
makes a spiral. Drawn freely it ranged 217°..561° across twelve galaxies, and at the loose end the
lane between arms reads as a radial wedge — a dark pinwheel with spokes. Measured ridge/trough fell
to **1.3** on those galaxies (`v1/4`, `v1/6`, `v1/9`) against 10–16 on the tight ones, and the
gallery images showed exactly that. The law now **draws the sweep** (378°..550°) and **derives the
pitch**; after the fix every galaxy in the 12-galaxy gallery reads as a spiral and the measured
ridge/trough minimum is 4.99.

Two independent lines of evidence found this (the `arm-measure` numbers and the gallery images), and
they disagreed about *which* galaxies were bad (a pixel-level reverse-mapping artefact), so the
gallery images were treated as the truth and the pixel proxy abandoned. A test now pins the
invariant — `src/universe/galaxy.test.ts`, "draws a real spiral at every arm count and pitch".

## Measurements (chair's build, 12 seeds, `.scratch/layer3-var-final/metrics.json`)

| Measure | Prior 8/10 (`gated`) | This iteration |
| --- | --- | --- |
| lit px mean (12 seeds, 1080p) | 194,635 | **196,942** (175,589..221,933) |
| mean luminance | 0.0383 | 0.0379 |
| ridge/trough 1080p | 5.82..15.61, mean 8.98 | **4.99..13.62, mean 8.10** |
| nucleus plateau / above-0.97 (1080p, 12 seeds) | 0 / 0 | **0 / 0** |
| nucleus 4K plateau / above-0.97 | 0 / 0 | **0 / 0** |
| home-star peak / ring peak | 0.887 / 0.646 | **0.887 / 0.550** |
| arm window coverage (>0.06) | 55.0%, 135 components | **58.1%**, 114 components |
| 4K arm-edge 1:1 (>0.08) | 31.1%, 77 blobs ≥80 px | **33.9%**, 66 blobs ≥80 px |
| dust band faint px (orrery) | 219,629 | **223,359** |
| max luminance, 4K galaxy | 0.880 | **0.880** |

Arm-contrast normaliser, re-measured after the sweep fix (75 / 34 / 35 galaxies): m=2 mean 0.4116,
m=3 0.4060, m=4 0.3889 — the table now has one entry per arm count, so a four-armed galaxy is no
longer reported as unresolvable.

## Evidence

- Shots `.scratch/captures/` — `npm run capture` **20/20**, all galaxy shots `expectGalaxyLod 1`.
- Gallery `.scratch/gallery3/galaxy-00.png`..`galaxy-11.png` + `shapes.txt` — 12 galaxies at the
  manifest composition, each at 2.6 of its **own** radius.
- 12-seed report `.scratch/layer3-var-final/metrics.json`.
- Before/after art: `.scratch/evidence/layer3-iter3/captures/` is the gated 8/10 set; compare
  `layer3-galaxy-1080p.png`, `layer3-arm-edge-2160p.png`, `layer3-home-star-1080p.png`.

**Crop offsets re-derived and verified for this composition** (the prior gate found the chair had
mislabelled one, so these are stated with the arithmetic): the home star projects to (960,540) at
1080p and the nucleus to (1145,694), so the `layer3-home-star-1080p` cut at (764,375) 600×380 puts
the star at crop **(196,165)** and the nucleus at **(381,319)** — both inside. The 4K nucleus is at
(2290,1388), so the `layer3-arm-edge-2160p` cut at (2061,736) 900×600 has the nucleus at (229,652),
**below** the window: it frames a mid-disc arm and its lane, no nucleus.

**Size is only visible at a fixed absolute camera.** Because framing distance scales with radius,
every galaxy fills the same fraction of frame when zoomed to it. The size law is visible in the
boot/orrery band (fixed camera) and in the HUD distances, not in the galaxy gallery. Judge the
gallery for shape and colour variety; judge the boot frame for size.

**Fixed-camera size evidence** (added after the gate, closing its "not verified" item — the gate
correctly noted that the brief's own instruction could not be satisfied by one galaxy):
`.scratch/gallery-size/` is the same twelve galaxies from **one absolute camera at 3.0e21 m**,
produced by `node tools/galaxy-gallery.mjs --out .scratch/gallery-size --fixed-distance-m 3.0e21`.
The camera coordinates in the HUD are identical in every frame (`177124.9, 216147.8, -149864.8 ly`)
and the discs differ by the full drawn range: `v1/2` (1.03e20 m) is ~52 px across, `v1/0`
(6.68e20 m) ~196 px. That is the size law made visible, at one camera, without a per-galaxy framing
rescale.

**Correction to this brief (found by the blindspot pass).** An earlier version of the paragraph above
said the camera composition puts *"the centre behind the home star"*. That is false and was false
before this slice: the camera targets the **home star**, which is a random point in the disc, so
`galaxy.centre` sits 0.47R–0.54R from it at every address. The nucleus therefore projects **237 px**
from frame centre at 1080p (247 px in the iteration-3 8/10 set — unchanged). The `layer3-home-star`
crop arithmetic below is correct and was derived from the render; only the prose claim was wrong.

## What to judge, and the changes most likely to be flaws

1. **Three-arm galaxies.** The arm profile is now a one-sided `cos²` compressed by `k/2`, so an odd
   count no longer draws double lobes. Does a 3-arm galaxy actually read as three arms, and do the
   arms stay separated at the rim rather than merging into a ring?
2. **The nucleus on the loosest-sweep galaxy.** `v1/4` sweeps 389°; its inner lane is the widest in
   the population. Is the nucleus still a graded core, or does it read as a dark pinwheel hole?
3. **Dust depth 0.35 and halo 2.4% galaxies** (`v1/5`, `v1/9`). Do they read as a dusty galaxy and a
   faint halo, or as a dimmer/streaky defect?
4. **The home galaxy changed.** `v1/0` is now a 6.68e20, three-arm barred galaxy. Does the boot
   frame still compose (orrery in front, band behind), and does the Sol backdrop still read?
5. **Uniform brightness across sizes.** Exposure is normalised by each galaxy's own radius. Does a
   small galaxy look like a small galaxy, or is the normalisation hiding the size law?

## Floor (chair, own build of this tree)

`npx tsc --noEmit` clean · `npx vitest run` **337 passed, 1 skipped** (the opt-in arm-measure
harness) · `npm run build` clean, **123.07 kB / 42.00 kB gzip** · `npm run capture` **20/20** ·
`probe:state` pass · `probe:travel` **12/12** · `probe:compass` **20/20** · `probe:pan` **15/15** ·
`probe:masks` **12/12** · `probe:ladder` **11/11** · `probe:live` pass (`decreases 0`,
`firstRampAt step-68`, `firstFullAt step-72`, `handoffSteps 4`, `maxCount 60000`).

**Not run:** `npm run probe:watchdog`, `npm run verify:dev`. `opencode.json` and `package-lock.json`
are dirty in the tree and are **not** part of this change (owner's file / no content diff) and must
not be committed or scored.

## What to decide

One score, 1–10, on `perception`, with the named flaws that hold it below the next level and the
specific evidence for each. Do not credit the HUD, sky density or composition: out of scope.
