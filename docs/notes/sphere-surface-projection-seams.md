---
date: 2026-11-23
verified_against: 74ec750 + uncommitted Layer 2
files: [src/gpu/noise.wgsl, src/gpu/scene.wgsl, src/render/system-scene.ts, .scratch/seam-probe.mjs]
status: active
---

# Sampling 2D noise from a 3D direction produces a seam and a pole

**Cause.** The first planet surfaces took a unit-sphere direction `dir` and projected it to 2D
noise. Both projections fail, in different ways, and both are visible the moment you zoom in:

1. `longitude = atan2(dir.z, dir.x)` wraps from +π to −π. The noise input jumps by
   `2π × frequency`, so the pattern is **cut at the 180° meridian and rejoined with unrelated
   content**. Measured (`.scratch/seam-probe.mjs`, 17 latitudes): adjacent points differ by
   0.00039; across the seam 0.128; two genuinely unrelated points 0.146. The seam behaves like a
   random sample — 87% of the floor.
2. `dir.xz` collapses at the poles: as `dir.y → ±1`, `|dir.xz| → 0`, so every longitude samples the
   same value. The pattern stops varying with longitude and smears radially. Measured: the
   longitude-to-longitude difference falls from 0.109 at the equator to 0.011 at 89.5°. The same
   projection also mirrors north from south, because `(x, y, z)` and `(x, −y, z)` are identical.

A UV seam in the sphere mesh is *not* a cause here: nothing in the shader reads UVs.

**What to do instead.** Sample **3D noise on the unit direction** (`value_noise3` / `fbm3` in
`src/gpu/noise.wgsl`). It is continuous over the sphere by construction — no seam, no pole, no
mirroring — and it costs one extra hash per corner (8 instead of 4) per octave. Add objects like
storms as a **direction** on the sphere and use `acos(dot(dir, stormDir))`, never a longitude
range, or you reintroduce the cut.

**Do lighting in the planet's local frame when you perturb the normal.** The vertex shader rotates
the light and view directions into the surface frame (`to_local`), and the fragment perturbs the
normal there. Sampling a height gradient in one frame and applying it to a normal in another is how
bump maps end up pointing the wrong way; doing it in world space would need the rotation matrix in
the fragment, which the instance buffer does not carry.

**Evidence.** `.scratch/seam-probe.mjs` reproduces the shader's noise on the CPU and prints both
tables. Before/after captures: the two `layer2-closeup-*` shots in `capture/shots.json`.

**Cost note.** `fbm3` is 3 octaves on purpose: planets call it up to five times per fragment
(surface, two gradient samples, two cloud layers). Relief is gated on a per-instance `detail` value
(0 below ~20 px of radius, 1 at ~42 px), so orrery-scale thumbnails pay nothing for it.