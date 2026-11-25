# Layer 3 iteration 4 — blindspot pass, findings and adjudication

**Date:** 2026-11-25
**Work item:** ticket 06 item 4, Slice B (the galaxy variation law)
**Rubric:** `perception`, target 8
**Reviewer:** `surplus/glm-5.3-flash` (seam `visualReview.model`), run through
`.opencode/tools/visual-review.mjs`
**Gate:** `quality-gatekeeper` scored **8/10 — SHIP** on the same art
(`ses_ded9d81c0ffeAxL4gxaQNuooHG`), conditional on this pass running.
**Outcome:** **the art does not change.** Of 12 findings, 10 are downscale misreads of HUD text,
1 is a real fact whose expectation came from a false sentence in *my* brief, and 1 restates a
deliberate composition as a defect. One committed doc comment was factually wrong and was fixed.

---

## How the pass was run, and the instrument failure

The provider caps a request at **8 images**, and `visual-review.mjs` sends the whole manifest in one
call. A 14-shot manifest failed with `HTTP 400 … maximum allowed of 8`. The manifest was split into
three (6 + 3 + 3 images). Batch B first returned **0 findings**, which was not a clean bill: it was
a silent truncation. `glm-5.3-flash` is a **reasoning model** — its reasoning tokens are drawn from
the same `max_tokens` budget, so the 2000 default left nothing for `content` and the call returned
`empty response`. At `--max-tokens 32000` the same shots produced 6 findings.

- Every reviewer call here used `--max-tokens 32000`. Anything less is unreliable for this model.
- `empty response` from this tool means **budget**, not a broken endpoint. It cost four failed runs
  before the cause was found; the note is in `docs/notes/`.
- All returned findings are unvalidated model output. Each was checked against evidence.

## Evidence used for adjudication

- Native-resolution HUD crops (2x neighbour-upscaled) of `galaxy-1440p`, and of gallery
  `v1/8`, `v1/9`, `v1/10` — `.scratch/blindspot-crops/`.
- `nucleus-check.mjs`: brightest box-averaged point (nucleus) vs brightest 1-px point (home star),
  plus the same measure on the **iter-3 8/10** capture for a before/after.
- `centroid.mjs` / `disc-size2.mjs`: box-averaged luminance field, background-calibrated
  threshold (sky p99.9 x 1.5) so the shared sky star field cannot enter the disc bounding box.
- `galaxy-centre.mjs` (vite-node): `galaxy.centre` per address, to test the camera-anchor premise.
- `.scratch/captures/summary.json`: the capture set's own camera and address records.

---

## Findings

### GLM-01 — "the core is not behind the home star" (galaxy-1080p, major/high)

**Fact confirmed; the expectation was wrong.** Measured: home star at (960,539), nucleus at
(1132,702) — **237 px apart**. The iter-3 8/10 capture is **247 px** apart. Nothing changed.

The camera looks at the **home star**, and the star is a random point in the disc
(`galaxy.centre` is `0.47R..0.54R` from it at every address, by design). So the drawn centre *must*
sit off frame centre. My own brief said *"the galactic centre sits behind the home star"* — that
sentence is false, and this finding is the model correctly rejecting it. The same false sentence was
in the committed doc comment at the top of `tools/galaxy-gallery.mjs`; **fixed** there.

**Verdict: not an art defect. A brief defect and a doc defect, both corrected.**

### GLM-02 — "1440p CAMERA reads +56997.6 ly, not +29697.6" (galaxy-1440p, major/medium)

**False.** Native 2x HUD crop reads `36627.6 ly, 44697.2 ly, -30990.5 ly` — byte-for-byte the
1080p values. The `5` was a downscale artefact of `3`; the companion claim of a smaller galaxy
follows from the same misread and from text being 1.25x larger in CSS px at that tier.

### GLM-03 — "1440p T reads +1280 s, not +1200 s" (galaxy-1440p, minor/medium)

**False.** Native crop reads `+1200 s`. `summary.json` records `t=1200` for all four galaxy shots.

### GLM-04 — "gallery-01 is clipped at the top edge" (gallery-01, minor/medium)

**False.** The top rows of `galaxy-01` are **pixel-identical** to `galaxy-00` (same 56 lit px at
y=0, identical maxima to 4 dp at y=0..10). That is the shared orientation-only sky, which is the
same in every frame. The background-calibrated disc box confirms it: `galaxy-01` clears the top
edge by 123 px.

### GLM-05 — "gallery-01's home star is 30 px right of centre" (gallery-01, minor/medium)

**False.** The brightest pixel within 40 px of centre is at offset **(-1,-1)**. Across all eight
gallery shots the home star is at (0..-1, -1) — it is drawn on the camera target by construction.

### GLM-06 — "gallery-00 and galaxy-1080p are the same address at different camera distances"
(gallery-00, minor/medium)

**False premise.** `gallery-00` is `v1/0`; `galaxy-1080p` is `v1/4.1.-2.7`. Different galaxies,
different radii (6.68e20 vs 2.39e20 m), different 2.6R distances. The conclusion ("the same galaxy
should fill the same fraction") does not apply to two different galaxies.

### GLM-01 (batch b1) — "gallery-05 fills much more of the frame than its siblings"
(gallery-05, major/medium)

**False.** Background-calibrated disc diagonals across the eight shots:
292, 302, 322, 322, 325, 326, 333, 345 px. `gallery-05` is 322 — mid-pack, 7 % from the median.
Every disc clears every frame edge by >= 104 px; nothing is clipped. The *apparent* size varies
because the home-star anchor shifts every disc off centre by a different direction (see GLM-01),
which moves the bounding box without changing the drawn radius.

### GLM-02 (batch b1) — "gallery-02's core is up-left, bottom-right is empty"
(gallery-02, minor/medium)

**True observation, deliberate composition.** Core is ~0.5R from the true centre, which is the
home-star anchor again (GLM-01). The reviewer flagged it under "no hard expectation", so this is
filed as a description, not a defect. It is also the **smallest** galaxy in the set (1.03e20 m), so
its ~0.5R nucleus offset is the largest in screen terms — the expected tail of the law, not a break.

### GLM-01 (batch b2) — "gallery-08's first compass row reads v1/0.0.5239, not v1/8" (gallery-08, minor/medium)

**False.** Native crop reads `v1/8.0.5229`. `v1/0` was a misread of `v1/8`, and `5239` of `5229`.
All three rows carry the `v1/8` prefix, which is the frame address.

### GLM-02 (batch b2) — "gallery-09's compass uses a comma instead of a dot" (gallery-09, nit/low)

**False.** Native crop reads `v1/9.0.43470`. Dot, not comma.

### GLM-03 (batch b2) — "gallery-10's second camera coordinate is 1137267.3 ly, 10x the others" (gallery-10, minor/medium)

**False.** Native crop reads `117267.3 ly`. The leading `1` was doubled by the downscale. The row is
`96096.1, 117267.3, -81306.6 ly` — all three the right magnitude for a 6.26e20 m galaxy at 2.6R.

### GLM-04 (batch b2) — "gallery-08's bright point is 20 px right of centre" (gallery-08, nit/low)

**False.** Measured offset (0,-1). Same construction as GLM-05.

---

## What this pass is worth

It found **no defect in the art**. Its one real contribution is that it caught a **false claim in my
own evidence**: the brief told the reviewer the centre sits behind the home star, and the reviewer
believed the brief over the picture and reported the picture as broken. That is the correct
behaviour from a blind reviewer, and the lesson is mine — a state-only brief must describe what the
build *does*, and "the centre is behind the star" was never true.

It also independently reproduced the gate's two nits from reading the images alone:

- **F1, uniform star sprites** ("soft pebbles… reads as foam, not resolved stars") — matches the
  gate's F1 and the iter-3 gate's rough edge #1. Carried, not new.
- **F3, thin-arm dust width** — the gate's F3. Carried, not new.
- **F2** (detached halo clumps on `galaxy-08`/`galaxy-09`) was **not** named by this pass, and the
  pixels are real: a 2x native crop of the halo edge shows discrete soft blobs, not a smooth
  envelope. That is the designed "honest minimal" halo (1.4–2.4 % of disc stars on a 2.2x radial
  tail at 3x height, `disc.ts`), and sparse points clump by construction. It is a **true observation
  of the scoped design**, within the owner's "honest minimal" answer — a real characteristic, not a
  defect, and not contradicted here. The blindspot pass simply did not flag it independently, which
  makes it a *lower-confidence* nit than F1 and F3, not a refuted one.

## Score impact

**None.** The gate's 8/10 stands; the blindspot pass adds no defect and removes none. The three
carried nits are the same three the gate named, all below the 9 threshold, and F1 is the single
change that would reach 9 (per both reviewers) — it is a sprite-size spread, which is shader work
and therefore a candidate for the Neon handoff, not for this slice.