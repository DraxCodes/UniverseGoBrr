# `base probe` image case fails on tiny images

Written against `drax-ai-workflow` 0.7.1, 2026-11-22.

## Symptom

`node .opencode/tools/base.mjs probe hillclimb.blindspot . --budget-usd 0.25` reports:

```
text   passed
json   passed
tool   passed
image  failed   expected red
```

The model is vision-capable; text, JSON and tool calling all pass.

## Cause

The probe's `image` case sends a **1×1 PNG** (`RED_PIXEL` in
`tools/lib/probe.mjs`). The Surplus endpoint accepts it and returns 200, but the
image contributes no usable tokens — the probe run reports `input: 49` tokens
for the image case, and the model's `reasoning_content` shows it never read a
pixel ("Without being able to actually process the pixel values… It appears to
be blue"). The model guesses, the answer is wrong, the case fails.

This is a probe false negative, not a capability gap.

## What to do instead

1. Do not re-seat a model on this signal alone. Check the other cases and the
   token counts: a real image payload shows up as a much larger `input`.
2. Verify with a normal-sized image. A 64×64 solid-red PNG sent through the same
   OpenAI-compatible `chat/completions` body returns `"Red"` from
   `surplus/glm-5.3-flash` in ~1 s.
3. Record both results: the probe outcome and the manual check, with the date.

## Related

`surplus/gemini-4-argon` is listed in the catalogue but was **unroutable** at the
80% discount floor on 2026-11-22 — the API returned 404 "No marketplace sellers
currently meet the minimum 80% estimated discount" (best offer 50.92%). Listed is
not routable; probe before seating.