# 03 — Layer 2: one procedural star system

**Type:** brief (approval before code) — **approved 2026-11-23** in session; decisions below
**Status:** Layer 2 shipped at perception **8/10** (2026-11-23); awaiting the Layer 0–2 commit
**Blocks:** Layer 3 (star field + galaxy) — its zoom-out assumes a system worth leaving
**Implements:** ADR-0002 (reverse-Z depth), ADR-0004 (time as input), ADR-0005 (pure, versioned
content), ADR-0008 (`Position`, camera-relative upload)

## Deliverable (spec §7, row 2)

Star shader, orbits, lit planets, atmospheres, rotation. **First screenshot; proves the
foundation.**

## What exists today

One full-screen triangle. No vertices, no depth buffer, no camera motion, no content. The camera
is five numbers from the URL. Layer 2 is therefore the first real 3D: first meshes, first depth
buffer, first lit surfaces, first generated content.

## D1 — Framing: an orrery with a labelled exaggeration

Earth: radius 6,371 km, orbit 1.496×10¹¹ m. Ratio **23,481 : 1**. A camera wide enough to show
that orbit at 1920 px across 2 AU puts Earth at ~0.13 px. True scale and "you can see the
planets" are mutually exclusive in one frame.

**Decision: orrery.** Spec §3.4 already resolves this — *truthful structure, legible population*.

Two documented distortions, both reported in the HUD rather than hidden:

1. **Orbit spacing** uses `displayOrbitRadius = (a / a_outer)^0.55`, normalised so the outermost
   planet is at 1. Monotone in `a`, so ordering is preserved; the ratio is not. (`0.55` rather
   than the `0.5` first written here: the extra compression buys inner-planet separation at the
   cost of crowding the inner ring, which is why the body radius needs a clamp — see 2.)
2. **Body radius** is a fixed fraction of the **frame** radius (1–3% by class, gas giants
   largest), independent of the body's own orbit — not a fraction of its orbit. True scale would
   put Earth at 0.13 px. Two discs can overlap once the spacing is compressed, so
   `displayBodyRadius` finally clamps to **38% of the gap to the nearest neighbour**; a
   40-address sweep asserts no two discs ever overlap.

The HUD row says what is being exaggerated, as a range over the system: `M-type · 5 planets · ×41-252 real`. (A
per-body readout was the first plan, but the HUD row is one clipped line and a clipped readout
that loses the word `real` reads as a measurement instead of a disclaimer.) A lie that is measured
and printed is a rendering convention; a lie that is hidden is a bug.

## D2 — Camera: orbit and zoom in the app

Drag orbits, wheel zooms, and the camera is written back to the URL so a view stays shareable —
the URL remains the single source of truth (Layer 0's contract). `R` resets to the framing.

Explicitly **not** free flight. Spec §3.2 puts impulse/free flight in the travel tier (Layer 4),
and adding it here would pre-empt decisions about rebasing and the compass that layer owns. Orbit
controls are framing, not travel.

Double precision stays on the CPU: the camera position is a `Position`, and the uniform receives
`toCameraRelativeF32` output only. At system scale this is already load-bearing — a camera at
10¹¹ m cannot hand absolute float32 to the GPU without losing kilometres.

## D3 — Generation: pure, versioned, tested before it is drawn

`src/universe/system.ts`:

```ts
SYSTEM_VERSION = 2          // 1 at approval; the D4a class draw bumped it
generateSystem(seed: string, address: Address): StarSystem   // structure
planetPosition(planet, system, tSeconds): Vec3               // state, closed form
```

- **Structure** from `f(seed, address)` only: star class and temperature, planet count 3–9,
  orbital semi-major axes, phase at epoch, axial tilt, spin period, size class, atmosphere
  presence. All from one seeded PRNG (mulberry32 seeded by FNV-1a of `seed + address`), so a
  system is reproducible from its address alone (ADR-0005) and a link keeps working.
- **State** from `t`: true anomaly advances at the Kepler period
  `T = 2π√(a³/GM)` with `GM = 1.327×10²⁰ m³/s²` (one solar mass). Circular orbits for Layer 2 —
  eccentricity is a Layer 3 refinement, not a foundation decision.
- `SYSTEM_VERSION` is the seed→content function's first version bump. This is the public API
  ADR-0005 warns about: changing the generator must invalidate old links loudly, so the version
  is exported and will be encoded in the address version when content identity starts to matter.

**The generator is written and tested before any shader work**, because period, phase, spacing and
determinism are all invisible in a screenshot until something drifts. Tests assert: identical
output for identical inputs; different output for a different address; `T ∝ a^{3/2}`; every
position finite and exactly `a` from the star; no planet inside the star or outside the address's
frame.

## D4 — Rendering shape

| Element | Geometry | Why |
| --- | --- | --- |
| **Star** | camera-facing quad, analytic corona | A star's disc is never resolvable at any real distance; a mesh would be a lie about size and cost more |
| **Planets** | UV sphere mesh, lit, with a procedural surface | First real geometry; depth is the point |
| **Atmospheres** | limb term plus a sunset band in the planet shader | Cheap, and it is what makes a lit planet read as a planet rather than a ball |
| **Orbits** | thin line strip, drawn under the bodies | The orrery is the composition; without the rings it is floating dots |

### D4a — Surface classes (added 2026-11-23, after the first frame)

The first render had correct spheres and no identity: every world was a smooth coloured ball.
Five classes now drive the fragment shader from noise — `rock`, `super-earth`, `ice`, `gas`,
`ocean` — and **class follows position**: rock inner, gas and ice outer, `ocean` only in the
temperate band where surface water can exist. `noise.wgsl` is shared with the starfield and is
prepended to both modules at compile time, so there is one copy of `value_noise`.

Two things this surfaced, both fixed:

- **`a^0.55` compresses the inner orbits**, so a class-sized gas giant could be wider than the gap
  to its neighbour and two discs overlapped. `displayBodyRadius` is now clamped to 38% of the
  nearest gap, with a 40-address sweep asserting no two discs ever overlap.
- **Noise frequencies tuned at orrery scale looked flat at close range** (2–3 cells across a
  sphere shades as one gradient). Raised, and judged from a focused camera at ~19 body radii.

`SYSTEM_VERSION` → **2**: the class draw consumes different randomness, so every address now
generates a different system. Nothing was shipped, so this break is free now and would not be
later.

**Reverse-Z** with a float32 depth buffer (ADR-0002). The near plane is set relative to the camera's
distance from the star so precision is spent where the geometry is, not spread over 10¹¹ m.

## Evidence plan

1. Unit tests for the generator and the camera matrix (pure, no GPU).
2. `npm run capture` gains a `layer2-orrery` shot at the seam's three widths plus the DPR-2 shot.
   The harness already fails a shot whose URL the app rejected, so a mis-typed camera cannot
   produce a picture of the wrong system.
3. **Hillclimb `perception`** once the first frame renders — not before, since a gate on a blank
   canvas scores nothing. Iterations run against the live dev server, so the loop is watched
   rather than inferred from stills.
4. **State and live-loop probes** (added 2026-11-23, after the gate said the unprobed states bound
   the score): `tools/state-probe.mjs` captures booting, a rejected URL (the issue banner), an
   unpinned clock and the no-WebGPU fatal panel; `tools/live-probe.mjs` steps the wheel across
   the ring-hide threshold and reports frame luminance per step, so a fade that pops shows as a
   discontinuity rather than as a still. Both run against the dev server and are not part of the
   deterministic shot set.

## Open defects from the first close-up review (2026-11-23)

Found by the user on `layer2-closeup-ocean` / `layer2-closeup-gas`; the `perception` gate is
deferred until these and the close-ups are signed off.

1. ~~**Planets are visible through the sun**~~ — **fixed 2026-11-23 (option A)**. The star is now
   two passes from one shared glare field. An **opaque core disc** (`STAR_CORE_FRACTION = 0.55` of
   the glare quad) is drawn first and is the only part that writes depth
   (`depthWriteEnabled: true, depthCompare: 'greater'`); the additive corona is drawn second and
   discards the core's radius in the fragment shader, so the rim values match and there is no seam
   or double-brightening. A body behind the core now fails the depth test; a body in front still
   passes and paints over the glare. Nothing behind the *dim* outer halo is hidden — that is the
   honest edge of the occluder, not a bug. Verified with a low-pitch transit pair
   (`.scratch/captures/_verify-occluded.png` / `_verify-infront.png`): the inner planet at 4.8 px
   from the star centre disappears when behind and silhouettes when in front. The per-body shader
   alternative was offered and rejected because it would need repeating for orbit rings and every
   later body.
2. ~~**`rock` / `super-earth` read as too rocky** at close range~~ — **fixed 2026-11-23** from a
   recapture, not from taste. The two new close-ups (`layer2-closeup-rock` /
   `layer2-closeup-superearth`, added to the manifest) showed a ~5:1 albedo range and a 1.15 bump
   gain as a dark crumpled walnut. Measured by capture: relief off was a billiard ball, 0.55 and
   0.28 were still blotchy, **0.15** reads as a world with the 20 px identity intact. Albedo range
   compressed (`0.52 + 0.72·h` instead of `0.40 + 0.95·h`), maria softened (0.38 toward 0.55×base),
   crater rims reduced to 0.05. Ocean land keeps its stronger relief.
3. ~~**The ocean world's polar cap reads as a grey blob**, not as ice~~ — **fixed 2026-11-23** from a
   recapture. The cap was `smoothstep(0.82, 0.95, |dir.y|)` in one flat `vec3(0.86, 0.90, 0.97)`:
   latitude-only, so its edge was a perfect circle, and one tone, so it shaded as a dome. The edge
   is now warped by 3D noise (`capEdge = 0.84 ± 0.08` at frequency 5.2) and the ice is broken by a
   second, finer field (frequency 14) into sheets between `vec3(0.62, 0.72, 0.85)` and
   `vec3(0.82, 0.88, 0.95)`. At 4× the boundary now meets the sea as a coastline and the sheets read
   as ice; measured, the dark speck that sat inside the dome was a low-frequency two-tone patch at
   `rgb(118,124,139)`, not a hole, and the finer field removed it. The same pass varied the shelf
   band's width and colour with noise (it drew a uniform cyan outline 1–2 px wide around every
   coast) and widened the ocean glint from power 48 to 26, which at 9 body radii had been a 2 px
   pinhole that read as a speck of dirt.

   The gate then found a second speck at `rgb(56,49,53)` at ~(996,437), and it was **not** the ice
   tone: it was **relief shading on the ice**. The ocean branch gives land `relief · 1.15` bump and
   the cap is drawn over the same height field, so where high terrain sat under the sheet the
   normal tilted and the ice went dark. Fixed by gating the ocean bump on latitude
   (`· (1 − smoothstep(0.70, 0.84, |dir.y|))`): ice is flat, so it gets no relief. The deep sea was
   also lifted from `vec3(0.010, 0.040, 0.13)` to `vec3(0.017, 0.058, 0.16)` (a near-black sea
   beside white ice read as a crater) and the cap edge band widened 0.06 → 0.085.
4. ~~**The star blows out to a white disc** at close range~~ — **fixed 2026-11-23**, measured on a
   recapture rather than judged by eye. The glare was an additive sum of about 3× the star's colour,
   so the centre clipped to flat white and the corona ended in a hard lens-shaped rim. It is now a
   **limb-darkened photosphere** (`(1 − r²)^0.85`, which reaches exactly zero at the disc rim), a
   power-law corona with slow angular structure, a wide faint halo and a very faint horizontal
   streak, all through a **soft shoulder** (`raw / (0.70 + 0.60·raw)`) so the peak lands at ~0.92 of
   white with a warm tint instead of clipping. The glare quad widened from 0.075 to 0.135 units to
   carry the tail; the occluding core was held **absolute** at 0.04125 units so defect 1's verified
   occlusion is unchanged. Measured: centre `rgb(250,223,189)` (lum 226, not clipped), a monotone
   radial profile with no step at the limb at 1080p or 4K, and no dark ring, seam or banding.

5. **Population legibility (gate, level-setter)** — **fixed 2026-11-23**. The HUD claims 9 planets
   while 8 were comfortably separable: the inner worlds are 15–20 px discs and, at a light angle
   that leaves most of the disc in night, only a 4–6 px lit crescent was above the sky. They were
   findable only by hunting. The fix is in the terminator, not in the geometry: the day/night edge
   wraps further round the smaller a world is on screen
   (`wrap = 0.14 + 1.25·(1 − detail)²` in the diffuse term, plus `0.08·(1 − detail)²` ambient).
   A flat ambient floor was tried first and rejected — it made every small body an evenly lit disc
   at the wrong light angle, which is a worse lie than a crescent. `detail` is the on-screen radius
   ramp (1 at ~42 px), so close-ups are unchanged. Measured on the recapture: the three bodies the
   gate named are now ~10 px discs with a visible lit side and a shaded limb.

## Outcome — perception 8/10, shipped 2026-11-23

Run `20261123T192025-0d87f7c5` in `.scratch/runs/runs.jsonl`. The gate's level-7 flaws (population,
ice speck, storm structure) are closed and the state/live traits it said bounded the score now have
run evidence (`npm run probe:state`, `npm run probe:live`). Recorded nits, none level-setting:

- the fatal panel repeats its recovery instruction ("Use a current Chrome or Edge and reload" then
  the same sentence in the hint);
- `--ink-faint` footer and label text sits at ~3.3:1 on the panel at 10 px — legible, but the
  faintest element on the page;
- the zoom clamp accepts further wheel notches with no "max zoom" feedback;
- the last of a ring's fade can complete in one wheel notch (faint 1 px line, below the bar).

## Non-goals

- No travel, no rebasing, no compass (Layer 4). No second system.
- No eccentricity, inclination or resonances. Circular, coplanar, correct periods.
- No planet surfaces, no terrain, no landing (Layer 6). No moons in this pass.
- No LOD handoff: bodies keep their orrery radius at every zoom until Layer 3 needs impostors.

## Risks, stated plainly

- **The orrery can read as a diagram rather than a place.** Lighting, atmosphere and the star's
  glare are what carry it; if the first screenshot looks like an astrolabe, the perception gate
  should say so and the fix is presentation, not physics.
- **Orbit controls are the first input handling in the project.** They must not fight the URL
  round-trip (drag updates the URL, and a URL change must not fight a drag in progress).
- **`SYSTEM_VERSION` is now load-bearing.** Any change to the generator silently re-rolls every
  existing link's planets; the version number is the only warning.