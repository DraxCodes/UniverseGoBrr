# Gate brief — Layer 3, `perception`, target 8

## Task
Layer 3 of UniverseGoBrr: an instanced-impostor galaxy and the system→galaxy crossfade.
One camera frame, static galaxy, ≤60k tiered impostors, home star findable at 1:1.
The approach was decided by council (`council-layer-3.md`) and issue 04; it is not open.

## Thesis the artifact is scored against
`docs/issues/council-layer-3.md` §10 (Experience thesis):
- Three seconds: the orrery stays composed; a faint dust band crosses the sky behind it; the
  viewer can point at the rest of the universe. *I am inside something.*
- No input: no auto-tour; boot on the Layer 2 framing.
- The good moment: the zoom-out reinterprets that band as the arm containing this star, and the
  star becomes **one point the eye can still find** — not the first frame that looks like a map.
  Findability is the acceptance test: a person can put a finger on it at 1:1, unaided.
- Friction to avoid: galaxy legible before the system is a single point; system released before
  the galaxy resolves; a visible disc edge; a zoom rate that changes at the handoff; the ×N
  factor growing into an apology.

Spec §7 row 3 and §6 (`docs/issues/spec.md`) carry the same row plus the
evidence rules. Issue 04 (`docs/issues/tickets/04-layer-3-star-field-and-galaxy.md`)
D1–D8 states what was required; its evidence plan asks for "arm/inter-arm contrast visible, no
stipple mush", a 4K arm-edge crop, a findable home star, and the live handoff loop.

## Evidence
Stills (native, `npm run capture`, 19/19 shots passed): `.scratch/captures/`
- `layer3-galaxy-1080p.png` (1920×1080), `layer3-galaxy-1440p.png` (2560×1440),
  `layer3-galaxy-2160p.png` (3840×2160), `layer3-galaxy-2160p-scaled.png` (1920 CSS @ DPR 2)
- `layer3-arm-edge-2160p.png` — 1:1 4K crop (1200×800) of an arm and the inter-arm gap
- `layer3-home-star-1080p.png` — 1:1 crop (600×380) around the nucleus and the home star
- `.scratch/captures/summary.json` — per-shot frame, mean, stdev, `galaxy.lod`

The same frames at 960 px wide, because the bound blindspot reviewer returns nothing above that
size: `.scratch/visual-review/layer3/layer3-*.png`. Note the two crops in that folder were
*downscaled* from 1200→960 and 600→600; the native files above are the 1:1 evidence.

Live handoff (`npm run probe:live`, 81 steps at 1080p, `.scratch/live-probe/summary.json`):
- `handoff` summary: `{steps:81, decreases:0, worstDecrease:0, firstRampAt:"step-69",
  firstFullAt:"step-71", handoffSteps:2, maxCount:45000}` — `lod` climbs 0 → 1 with no step back,
  no double-exposure, and the HUD scene row swaps once (`K-type · 9 planets…` → `one galaxy · ×1 real`).
- Steps 68–71 report `lod` 0.005 → 0.267 → 0.821 → 0.997. The window is 2 intermediate notches at
  120 px per wheel notch because the void compression moves ~40% of the distance per notch; a
  trackpad delivers smaller deltas continuously.
- `inward` and `outward` legs are in the same file.

Watchdog (`.scratch/watchdog/summary.json`, `npm run probe:watchdog`): 90 forced ~45 ms frames →
tier `rich`→`medium`, count 45000→22500, status stays `ready`, notice
"quality: medium · long frames". Not a device loss.

Measurements taken from the rendered 1080p frame (native pixels, `.scratch/armrender.mjs` at the
shipped camera):
- m=2 arm modulation over 0.25–0.8 R: 0.334 (r=2.6 R, pitch −0.75), 0.313 (3.0 R), 0.302 (3.4 R).
- grain (mean |L − 9×9 local| / local over the mid disc): 0.33 / 0.32 / 0.30.
- radial luminance profile from the disc centre (`.scratch/profile.mjs`, 20 bins to 1 R): monotone
  from 1.00 at the centre to 0.04 at the rim; pixels above 0.995 luminance are **4.5%** of the
  disc area, i.e. the nucleus, not the inner third.
- Budget is argued, not measured: 45 000 impostors, footprint 3–5 px at 1080p scaled by
  viewport height, mean coverage ≈ 1.1× screen area. **The 1650-class proxy is not available this
  session; do not credit or claim floor performance.**

Floor, run just before this brief:
- `npm test` → 16 files, **141 tests passed**
- `npm run build` → `tsc --noEmit && vite build`, clean

## Blindspot pass (independent reviewer, `surplus/glm-5.3-flash`)
Six single-shot runs, `.scratch/visual-review/layer3/run3-*/findings.glm.json`. Capability probe
(a magenta block painted on the real frame) returned the block, so an empty array is a true negative.
Run summary:
- `run3-galaxy-1080p`: 5 findings; `run3-galaxy-1440p`: 0; `run3-galaxy-2160p`: 1;
  `run3-galaxy-2160p-scaled`: 1; `run3-arm-edge`: 3; `run3-home-star`: 2.

Adjudication inputs, stated as facts, not conclusions:
- The arm-edge and home-star review copies are downscaled, so "blocky clumps", "ruler-straight
  vertical edge", "rectangular void" and "flat blue-grey rectangle" claims could not be reproduced
  in the native 1200×800 crop at 1:1; the native crop is a soft speckle field.
- An earlier brief (run2) wrongly stated there was a scale legend at the bottom-right. There is
  none; those findings are from the corrected brief, and the current brief names no legend.
- The background star field is genuinely sparse: outside the disc the sky pass draws a few very
  faint points (mean luminance ≈ 0.016–0.02), which survive at 1:1 and mostly vanish at 960 px.
- The nucleus is a saturated, near-white ellipse. Its clipped area is 4.5% of the disc and the
  profile around it is monotone.

## What to return
Score this artifact on the `perception` rubric
(`.opencode/skills/hillclimb/references/rubrics/perception.md`) against target **8**, in the
scorecard shape the rubric specifies. Name the flaws that hold it below 8 (what, where, which
condition), state which findings you confirmed against the shots and which you rejected, and give
the floor line. Do not score 8 on a green floor alone, and do not credit floor-class GPU
performance: it was not measured. Set the score; do not fix anything.