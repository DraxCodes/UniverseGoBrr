# A local star field piles into a hard disc at galaxy scale

Written 2026-11-23 for Layer 3 (`src/universe/galaxy.ts`, `src/render/galaxy-scene.ts`), against
`GALAXY_VERSION = 2`. Written because the artifact looks like a stray UI marker rather than a star,
and the cause is not in the shader.

## Symptom

At the Layer 3 still camera (2.6 R from home) a hard-edged, flat-white circle sits exactly at the
screen centre — 8 px across at 1080p and 17 px at 4K, pure `255,255,255` with a one-pixel ramp.
It follows the home star when the seed changes, and every soft impostor around it has a gentle
falloff. The blindspot reviewer called it "a solid white disc with a hard, crisp circular edge,
several times the diameter of every other star point".

## Cause

The local field is ~5 000 stars inside `LOCAL_RADIUS_M` (100 ly ≈ 9.46e17 m). From a camera at
1.3e21 m that entire sphere subtends ≈7e-4 rad ≈ 0.85 px at 1080p: **every local star lands within
one pixel of the home star**. Each instance is drawn at its own footprint (`GALAXY_STAR_MIN_PX`..
`GALAXY_STAR_MAX_PX`, 3–5 px radius at 1080p), so the whole field stacks into one saturated disc
whose edge is the largest quad's radius. The pile is brighter and larger than the orrery star's own
2–3 px glare, so the thing you are supposed to find (issue 04 D5) is hidden by its own neighbours.

The exclusion clamp in `generateGalaxy` does not help: it pushes stars *out* to 1.2×`LOCAL_RADIUS_M`,
which is still 1 px away at that distance, and those pushed stars pile on the same spot.

## Fix

`writeGalaxyFrame` measures the local field's projected radius,
`LOCAL_RADIUS_M * focalPx / cameraDistanceM`, and multiplies the local block's per-instance reveal
by `smoothstep(1.5 px, 8 px, thatRadius)`. The field fades out as it converges, and the orrery's
glare quad (`STAR_MIN_PX`, with its own hue) is the single point that survives the handoff. The disc
block is unaffected, so tier prefixes and the arm contrast do not move.

Do not "fix" this by shrinking the impostor footprint: the footprint is what keeps the disc from
reading as stipple, and the pile is a projection consequence, not a size bug.

## How to see it

`node .scratch/map.mjs .scratch/captures/layer3-galaxy-1080p.png 948 528 24 24 1` prints an ASCII
luminance map of the centre; before the fix it is a solid `########` block, after it a three-pixel
warm dot. `.scratch/scan.mjs <png> 948 540 25 x` prints the raw RGB across the centre.