---
date: 2026-11-25
verified_against: e237545 and 1d794d8
files: [capture/shots.json, capture/shoot.mjs]
status: active
---

# Read a crop's offset out of `shots.json`, never from the intent of the crop

**Cause.** The capture harness writes each cropped shot as a standalone PNG with the crop's own
dimensions, so the file itself carries no offset. The offset lives only in `capture/shots.json` as
`clip: {x, y, width, height}` against the full frame. Anyone describing a crop to a reviewer or
writing a brief has to restate it, and restating it from memory is how a false defect gets filed.

Seen three iterations running (2026-11-24/25). The `arm-edge` crop is cut at **(2061, 736)** of the
3840×2160 frame. The chair described it as "offset (0,0), centred on an arm", so the blindspot
reviewer correctly reported a *major* defect — "the debug HUD is missing" — that never existed. The
gate later proved the real offset pixel-exact: the crop equals a 900×600 cut at (2061,736) with 0
differing pixels, and offsets ±1 differ on ~155k/187k px. The same class produced "the home star is
not at the crop centre" in iteration 2; the star is at **(196,164)** of a 600×380 crop cut at
(764,375), because the camera looks at the star and the crop was cut around the frame centre.

**What to do instead.**

1. Read the numbers, do not infer them:

   ```powershell
   node -e "const s=require('./capture/shots.json'); for (const x of (s.shots||s)) if (x.name.includes('arm-edge')) console.log(x.clip)"
   ```

2. In a manifest or brief, give the **offset and the extent** and say what is *not* in the crop:
   "900×600 cut at (2061,736) of the 4K frame — not the top-left, so no HUD."
3. Never say "centred on" unless the numbers say so. If the brief needs a subject at a particular
   pixel, compute it: `subject = frameCentre − clipOffset`.
4. When a reviewer's finding rests on a label, verify the label against the pixels before routing
   it. A gate can check a crop by re-cutting it and requiring 0 differing pixels; do that whenever
   a finding's severity depends on geometry.