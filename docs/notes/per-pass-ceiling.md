---
date: 2026-11-25
verified_against: e237545 (Layer 3 density pass, `GALAXY_VERSION 8`)
files: [src/gpu/galaxy.wgsl, src/gpu/renderer.ts, tools/measure-layer3.mjs]
status: active
---

# A luminance above `ceil_lum` is another pass, not clipping

**Cause.** The galaxy's tone curve ends at `ceil_lum = 0.79` (`src/gpu/galaxy.wgsl`), so the galaxy
composite can never emit more than 0.79. A measurement script that reads the *frame* and compares
its `maxLum` to 0.79 will therefore report a failure on a build that is behaving exactly as designed:
the frame has three more writers.

Draw order in `encodePass` (`src/gpu/renderer.ts`):

1. the sky pass (a full-screen starfield, unclamped by the galaxy curve);
2. the galaxy composite, premultiplied `one` / `one-minus-src-alpha` over the sky;
3. the orrery — orbits, planets, star core — on top.

So a bright pixel is one of: the home star (0.887 on the pinned boot camera), a sky star showing
through a galaxy pixel whose `core_alpha < 1`, or the galaxy itself (≤ 0.79). Seen on 2026-11-25:
three seeds reported nucleus `maxLum` 0.865 against the 0.79 ceiling, at the **same pixel**
`[1152,649]`, RGB ≈ (211,218,237) — blue-white, not the warm nucleus (218,176,117), and identical
across seeds, which a galaxy pixel cannot be. It is a fixed sky star under a semi-transparent arm.

**A fourth writer arrived with the Layer 4 tier masks** (2026-11-25, `src/gpu/tier-mask.wgsl`). During
a `warp` or `transwarp` the frame is replaced by the mask composite, whose own tone curve uses
`ceil_lum = 0.90` - deliberately **above** the home star's 0.887, because during a crossing the effect
is the camera target and nothing else is. Measured on the probe frames: `transwarp-early` peaks at
**0.9921**, `transwarp-mid` at 0.9420, `warp-early` at 0.9104, all in the aperture/streak core.
`warp-mid` measures 0.8833 (the star showing through the streak field) and every settled frame is back
at 0.8833. So the rule to apply to a mid-crossing frame is **0.93 channel clamp, no exception**, and a
`maxLum` above 0.887 there is the mask, not a defect. Measure a *settled* frame before judging the
ADR-0015 ordering.

The galaxy composite's alpha reaches 1 where mapped luminance > 0.48, so at the core the sky cannot
show through and the ceiling does bind. That is why the nucleus measures ≤ 0.79 while the frame
measures higher a few hundred pixels away.

**What to do instead.**

- To test the galaxy ceiling, measure **inside the galaxy pass** or sample the warm core
  (e.g. `maxLumAt` around the nucleus), not the brightest pixel in the frame.
- To test the frame, expect the **home star** to be the maximum (0.887 at the pinned boot camera)
  and require no pixel above the 0.93 channel clamp anywhere. `tools/measure-layer3.mjs` already
  excludes the HUD rect; it does not exclude the star.
- When a `maxLum` looks wrong, print the **pixel location and RGB** before concluding. A fixed
  location across seeds is a sky or orrery pixel; a moving warm pixel is the galaxy.

**Related.** `docs/notes/stale-dev-server-fakes-evidence.md` uses a max-luminance invariant to
prove which build a frame came from; that invariant is about the 0.93 channel clamp, not the 0.79
galaxy ceiling. Both are true at once because they bound different things.