# A billboard star occludes only if its core writes depth

Written against WebGPU, reverse-Z (`depthCompare: 'greater'`, clear 0), Layer 2 star system
(2026-11-23).

## Symptom

A planet behind the sun paints a crisp disc over the glare. The star's pipeline is
`depthWriteEnabled: false, depthCompare: 'always'`, so it contributes no depth; the planet's
depth beats the cleared 0 and it draws over the glare.

## The fix that works

Two passes from **one** shared intensity function:

1. **Opaque core disc**, smaller than the glare quad, `depthWriteEnabled: true`,
   `depthCompare: 'greater'`, drawn before the planets. This is the occluder.
2. **Additive corona**, `depthWriteEnabled: false`, drawn after the core and before the planets.
   Its fragment shader discards the core's radius, so it never double-brightens the centre.

Map the core's own UV into the glare's units before evaluating the shared function
(`d_glare = length(uv) * coreRadius / glareRadius`). At the rim both passes then return the same
value, and the disc's edge is invisible.

## The traps

- **Do not depth-write the whole glare quad.** A body crossing the dim outer halo would vanish
  before it reached the bright core. The occluder radius is the near-white core (~0.55 of the glare
  quad), not the full halo.
- **Reverse-Z `greater` does not clip bodies in front.** A nearer fragment has a larger depth and
  passes; the risk is over-occluding the halo, not losing foreground bodies.
- **The default orrery camera hides the bug.** It sits ~1.33 units above the orbital plane, so a
  planet directly behind the star still projects ~0.79 star radii out — outside a 0.55 core. Test
  with a low pitch (~0.09 rad) and scan `t` for the minimum projected offset; the inner planet then
  crosses within a few pixels of the centre.
- **Occluder plane vs sphere.** The core is a camera-facing quad, so it writes the star's centre
  depth, not a sphere's. At this exaggeration the difference is far below the drawn radius.

## How it was verified

A scan over one inner-planet period found `t` values where the planet is 4.8 px behind and 5.3 px
in front of the star centre at a low pitch (`src`-side temporary test, output in
`.scratch/transit-scan.json`). Captured both (`node tools/capture.mjs --manifest
.scratch/transit-shots.json`): behind, the planet is absent from the core; in front, it silhouettes
as a black transit disc. Keep both as the negative-control pair if this ever regresses.