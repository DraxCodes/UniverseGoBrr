# 0015 — The galaxy draws into its own HDR buffer, and one tone curve owns its ceiling

**Status:** accepted (2026-11-25, owner; adopted across the Layer 3 visual pass, iterations 2–3)
**Context:** the first Layer 3 galaxy was drawn straight into the frame's `bgra8unorm` target and
gated 6/10: the nucleus clipped (122 px above 0.97, global max 1.000 in a 170×196 block), the arms
did not read as arms, the home star disappeared into a bright field, and the boot frame had no dust
band behind the orrery. A second iteration moved the galaxy into a separate high-dynamic-range buffer
with a hand-shaped tone curve and fixed all four; it scored 7/10 because the disc then read as a
scatter of points rather than a band of light. The third iteration restored density and reached
8/10. This records the shape that both the scoring and the code now depend on, so a later pass
changes it deliberately rather than by drift.

## Decision

**1. The galaxy is drawn into its own `rgba16float` buffer, not into the swap-chain target.** Every
impostor adds light into HDR, so overlaps accumulate honestly and nothing saturates per star. The
buffer is composited into the main pass **after the sky and before the orrery**, premultiplied
(`one` / `one-minus-src-alpha`), so galaxy light lands under the planets and the star rather than
over them (`src/gpu/renderer.ts`).

**2. One soft-shoulder tone curve maps the accumulated HDR to display, and its ceiling is a
per-pass constant.** `ceil_lum` is the brightest the galaxy composite can emit. It is set **below the
home star** (0.79 against the star's 0.887) so the camera target stays the brightest thing in the
frame, and above the knee (0.38) so the curve has headroom and never divides by zero:
`mapped = knee + headroom · excess / (excess + headroom)`, with `headroom = ceil_lum − knee`. At the
nucleus, mapped luminance above 0.48 forces the composite's alpha to 1, so the core cannot show sky
through it.

**3. Exposure is derived from the camera's distance, with a floor and a cap.** The galaxy pass scales
by `min(1.55, max(0.80, distRatio^-0.40))`. The **floor matters more than the cap**: the outer disc is
where sparseness shows, so the minimum exposure is what keeps it a band rather than a scatter. The
exponent is shallow (−0.40) so the frame does not change brightness dramatically across the zoom
range.

**4. Density is bought with population and overlap, not with brightness.** The rich tier draws the
declared 60,000-instance budget (`local 5,000 + disc 55,000`), disc emission is `0.73·base^0.42` and
bulge `0.72·base`, and the impostor footprint is near-uniform (4.65–5.05 px at 1080p). A larger,
equal-size footprint makes neighbours overlap into a continuous band at the cost of the per-star
size cue — accepted, because the band is the read that failed, and the size cue is only missed at
1:1 4K.

**5. Anything that changes how the galaxy looks bumps `GALAXY_VERSION`.** The version seeds per-star
appearance and drives `appearanceKey`, so a shared link re-pins rather than silently redrawing a
different sky. `GALAXY_STREAM_VERSION` and `PLACEMENT_VERSION` are separate and did not move in
iteration 3, because the frame and the placement rule did not change.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Own HDR buffer, composite before the orrery | Overlaps accumulate; one place to clamp; orrery stays in front | **Chosen** |
| B. Draw galaxy into the frame target with per-star clamping | No extra buffer | Rejected — per-star clamping still saturates where thousands overlap; the nucleus clips exactly this way |
| C. Clamp every pass at 0.93 | One global ceiling | Rejected — it makes the home star and the nucleus compete; the star must win by number, not by luck |
| D. Buy density with a brighter gain | One constant | Rejected — it raises the whole frame and makes the boot band a bright wall over the orrery |
| E. Per-star size spread for depth | Restores the cue | Deferred — costs the overlap the band needs; a ±0.6 px spread is the smallest future change if 1:1 4K uniformity is ever named |

## Why

- **HDR is what makes "a band of light" possible.** On a display-referred target, the brightest
  pixels clamp first, so the only way to add density is to add near-maximum dots — which reads as
  grain. In HDR, many dim stars sum into a smooth band, and one curve decides the final brightness.
- **A ceiling below the home star keeps the camera target findable for free.** The star is the one
  point the viewer must be able to return to; if galaxy light can out-shine it, identity depends on
  luck per seed.
- **The floor is a composition control, not a brightness control.** It chooses how much of the faint
  outer disc survives at the widest view; without it, the arm loses the band exactly where the gate
  looks.

## Consequences

- **The ceiling is per pass, not per frame.** The galaxy cannot exceed 0.79, but the orrery pass can
  (the home star reaches 0.887) and the sky has its own values. So a measured `maxLum` above 0.79
  outside the galaxy core is *not* clipping — it is another pass, or sky showing through a
  semi-transparent arm pixel. Confirm which before calling it a defect.
- **Near-uniform footprint means no per-star depth cue.** Accepted at 1080p/1440p/960, where the disc
  reads as light. If someone inspects at 1:1 4K and names the uniformity, the fix is a small size
  spread, not another population change.
- **`GALAXY_GAIN` (0.194) and the tier table are coupled.** The 60,000 budget is asserted at
  equality, and `GALAXY_MAX_INSTANCES` sizes the CPU and GPU instance buffers from the same table, so
  a star-count change must move the budget and the allocation in the same commit.
- **The exposure test's lower bound is now slack.** The code floors at 0.80; the test still permits
  0.68. A future drop to 0.70 would pass silently. Tighten it when the floor is next touched.
- **What must be revisited:** a per-star size spread for 1:1 4K; whether the outer-disc edge should
  fade harder than the current traceable soft transition; and the boot-frame band texture, which
  reads as dust but is blotchier at 1:1 than the iteration before it.