---
date: 2026-11-24
verified_against: wip/layer-3, GALAXY_VERSION 4 (GALAXY_STREAM_VERSION 3)
files:
  - src/render/galaxy-scene.ts
  - src/render/galaxy-scene.test.ts
  - src/main.ts
status: active
---

# Inverted smoothstep erases a field instead of saturating

**Cause.** `smoothstep(edge0, edge1, v)` divides by `(edge1 - edge0)`. When `edge0 > edge1` it does
not clamp to "everything is inside" — it **inverts**: values below the smaller edge return 1 and
values above the larger edge return 0. So a mask built as "1 near the star, 0 far from it" silently
becomes "1 far from the star, 0 near it" the moment its two edges cross.

The specific instance: the home-star findability gap multiplied its **outer** edge by the
crossfade progress, but left its **inner** edge at a constant.

```ts
const homeGapPx = HOME_GAP_PX * legibility.lod;                 // outer edge shrinks with lod
// inner edge was the constant HOME_GAP_PX * HOME_GAP_INNER = 8.0 * 0.7 = 5.6 px
reveal *= smoothstep(HOME_GAP_PX * HOME_GAP_INNER, homeGapPx, gapPx);  // BUG
```

At `lod >= 0.7` the order was normal (outer 8.0·lod ≥ 5.6) and the gap worked. Below `lod 0.7` the
outer edge dropped under the constant inner edge and the mask inverted, culling every star outside
a ~5 px ring around the home star. Disc emission fell from ~24 000 to ~4 (a handful of impostors)
and the sky read as empty.

Because `lod` is an **envelope product** — `fit × resolved × inclination` — it is partial across a
wide range of both pitch and zoom, so one arithmetic slip showed up as two unrelated-looking bugs:

- pitch sweep: blank from pitch ≈ +0.10 to +0.65 and again from ≈ +0.75 up;
- zoom to the system: blank from ≈ 4.8e20 m down through ≈ 3.8e20 m, i.e. across the
  "one galaxy → K-type" scene-row swap, then "reappearing" once the whole disc left the frustum.

The reappearance at `lod = 0` is a red herring: the gap block is skipped entirely when `lod` is 0,
so the field returns for a reason unrelated to the mask being correct.

**What to do instead.** Derive **both** edges from the same scaled quantity, so they cannot cross:

```ts
reveal *= smoothstep(homeGapPx * HOME_GAP_INNER, homeGapPx, gapPx);
```

More generally: any `smoothstep` whose edges are computed separately deserves a check that
`edge0 < edge1` holds for every input in range. If the width is meant to shrink to zero, multiply
a single base by the factor rather than scaling one edge and pinning the other.

**Guarding it.** An absolute "is anything lit" assertion is too weak: the inverted mask still leaves
a few impostors near home, so `emitted > 1` passes. Compare against a **relative** floor (≤ 30 % of
the brightest sample in the sweep) and assert the sweep actually visits the partial regime
(`0.02 < lod < 0.95`), or the test can silently stop covering the bug.

**Evidence.** `.scratch/vanishtest.ts` and `.scratch/gapmath.ts` sweep pitch and distance and print
`lod`, lit count and total emission per pose. Before the fix, pitch +0.15 gave `lod 0.376` with
4 lit stars and emission 4.4; after, the same pose emits ~21 660. Regression tests "never erases the
galaxy at an intermediate crossfade" and "keeps the galaxy lit across every pitch" fail on the old
expression and pass on the new one.

**A second trap in the same family: one scalar cannot serve two questions.** `lod` is
`fit × resolved × inclination`, and the HUD's scene row used it to decide *where the viewer is*
("one galaxy" vs "K-type · 9 planets"). That was survivable while the disc lay in world `y = 0` and
the default camera looked at it face-on. Once the disc was genuinely inclined 30°, a straight
zoom-out from the default view is edge-on, so `lod` — correctly — stayed at 0.016 while the whole
galaxy filled the frame and the row still read "K-type · 9 planets" at 45 000 ly. The fix is to ask
each question its own question: identity is `fit × resolved` (scale, no orientation), and only the
arm crossfade keeps `inclination`. When a derived value starts being asked a question it was not
composed for, split it rather than tuning the threshold — the same number cannot mean both
"how legible are the arms" and "how much galaxy is on screen".
