# The blindspot reviewer's image size limit

Written 2026-11-23 against `surplus/glm-5.3-flash` (the seam's `visualReview.model`) through
`node .opencode/tools/visual-review.mjs`. Written because a review that silently returns nothing
looks exactly like a review that found nothing, and that difference decides whether the blindspot
pass counts as evidence.

## What happens at each size

Five shots at 1920×1080 → **0 findings** (a valid-but-empty array).
One shot at 1920×1080 → HTTP 200, but `content` is empty twice in a row → the tool records
`findings.glm.untrusted.json` with `"error": "empty response"` and exits 1.
One shot at 1280×720 → same empty response.
One shot at 960×540 → **works**, returns findings.

So the large images do not error at the transport level; the provider returns a 200 with no
message content. The tool's retry cannot fix it, and the tool reports it honestly rather than
writing an empty findings file — which is the behaviour to rely on.

## The other half of the limit: small text

At 960 px the reviewer can see composition (it found a painted magenta block, named its edges and
that it cut the orbit rings) but **cannot reliably read the 11 px HUD text**: it reported the
PRECISION row as `nan · manual scale1`, where the frame actually says `normal scene`. Treat any
finding that depends on reading a label at 960 px as noise, and downscale no further than that if
text matters.

## What to do instead

- For a blindspot pass on full-size captures, downscale each shot to 960 px wide first and pass one
  or two shots per call. A 1920 shot is out of reach for this model, not merely slow.
- Never record a 0-finding review as "nothing visible" without a capability probe on the same
  shape of input: paint a magenta rectangle on a copy of a real shot and check the reviewer reports
  it (`probe.png` / `probe-manifest.json` / `probe-brief.md` under `.scratch/visual-review/`). The
  probe here passed at 960 px; the 5-image 1920 pass that returned 0 is the same input shape that
  returns an empty response, so its 0 is not evidence.
- The findings are a second pair of eyes, not a gate: the gatekeeper adjudicates them, and a
  disagreement that cannot be resolved goes to the user.