# The blindspot reviewer's limits: token budget first, then size

Written 2026-11-23 against `surplus/glm-5.3-flash` (the seam's `visualReview.model`) through
`node .opencode/tools/visual-review.mjs`. Written because a review that silently returns nothing
looks exactly like a review that found nothing, and that difference decides whether the blindspot
pass counts as evidence.

**Corrected the same day.** The first version of this note blamed image size. Size was a
confounder: the real driver of an *empty* response is the reasoning budget, and a 1920 px shot
works once that budget is raised.

## The two failure modes

1. **`"error": "empty response"`, `raw: ""`** — HTTP 200 with no message content. The model is a
   reasoning seat (`reasoning: true` in `opencode.json`), and the tool's default
   `--max-tokens 2000` can be spent entirely on reasoning before any JSON is emitted. The
   tool retries once and fails honestly (it writes `findings.glm.untrusted.json` and exits 1), so
   this never masquerades as "0 findings".
   **Fix:** pass `--max-tokens 6000` (8000 for a dense full-frame shot). Verified A/B on the same
   960 px galaxy frame: default budget → empty response; `--max-tokens 6000` → 1 finding.
2. **A valid `{"findings": []}`** — the model answered and saw nothing worth reporting. This is
   only meaningful after a capability probe (below), and it is most likely on a busy or tiny frame.

## What actually works

- **One shot per call.** Six 960 px shots in one manifest returned an empty response; the same six
  as single-shot manifests (at 6000 tokens) all answered. If a multi-shot pass is needed, expect
  to split it.
- **Multi-shot does work once the budget is high enough** (2026-11-25): **eight 1280 px shots in one
  manifest** returned 6 findings at `--max-tokens 16000 --timeout 240000`. The same eight failed at
  the default budget; a 4-shot manifest failed at 1500 and a **single** 1280 px shot failed at 1200
  but answered at 16000. So budget is the axis, and shot count only raises the budget needed.
- **The endpoint caps a request at 8 images.** Nine or more returns HTTP 400
  `Total number of images exceeds the maximum allowed of 8` — it fails loudly, not by silently
  reviewing a subset. Trim the manifest to the eight most informative states rather than splitting
  one review into two runs, because two runs give two independent reviewers and the pass is
  supposed to be one.
- **1920 px is in reach** with `--max-tokens 8000`: a 1920×1080 still returned two findings
  (composition, and the shape of the nucleus). The earlier "1920 is out of reach" conclusion came
  from calls that were actually hitting the reasoning budget. Do not pre-emptively downscale past
  1920; try native at 8000 first, and downscale only if that fails.
- **1:1 crops must stay 1:1.** A 1200 px crop downscaled to 960 produced findings about "blocky
  clumps", "ruler-straight vertical edges" and a "rectangular void" that are absent in the native
  crop — resampling a sparse speckle field invents geometry. Pass the crop at its own size (a
  900×600 window cut from the image, not a scaled copy).
- **Small text is not readable at 960 px.** At that size the reviewer reported hud rows as
  `nan · manual scale1` and `64deg108.4 ly` where the frame says `normal scene` and
  `76754.1 ly, 93664.1 ly, -64941.4 ly`. Treat any finding that depends on reading a label at
  960 px as noise; check the native frame before acting on it.
- **Never trust a 0 without a probe on the same input shape.** Paint a magenta rectangle on a copy
  of a real shot and check the reviewer reports it (`.scratch/probe-shot.mjs` writes
  `.scratch/visual-review/layer3/probe.png` with a matching manifest and brief). A probe that
  passes proves the pipeline sees the image; a 0 from the same shape is then a true negative.
- The findings are a second pair of eyes, not a gate: the gatekeeper adjudicates them, and a
  disagreement that cannot be resolved goes to the user.