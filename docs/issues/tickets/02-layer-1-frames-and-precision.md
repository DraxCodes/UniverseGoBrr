# 02 — Layer 1: camera-relative precision and an unbounded address

**Type:** brief (approval before code)
**Status:** implemented 2026-11-23 — ADR-0008 accepted; see "Result" below
**Blocks:** Layer 2 (star system), Layer 3 (galaxy), everything that places an object
**Implements:** ADR-0002 (camera-relative f32) — the cell half is deferred, see D1

## Why this is the next thing

Today the app has no absolute coordinates. The camera is three small numbers handed straight
to the GPU (`src/gpu/renderer.ts:75-77`), which is fine only because nothing is more than
40 m from origin.

This is not a far-future problem. Measured (below): **at 1 AU float32's step is 16.4 km**, so a
1 km separation between two points is not representable at all — they become the same number
and the object is drawn at the camera. Layer 2 puts a planet at exactly that distance. The
bookkeeping has to exist before there is scenery, or the first star system will be built on a
coordinate system that has to be torn out.

## Plain-language model

Two nouns matter now; the rest is deferred.

| Noun | What it is |
| --- | --- |
| **Frame** | A local origin. Everything inside is measured from that origin, never from the centre of the universe. |
| **Position** | A frame origin plus a double-precision local vector. Its internal representation is hidden behind a narrow interface. |
| **Address** | The name of a frame: an ordered list of integers, one per level. This is what a URL shares. |

Drawing: the CPU subtracts the camera **in double precision** and sends the GPU only the small
camera-relative result as float32. The GPU never sees an absolute coordinate.

## Measured baseline (spike, 2026-11-23)

Before committing to any of this, the GPU's arithmetic was reproduced on the CPU
(`.scratch/precision-spike.mjs`): round the target and the camera to float32, subtract, project
at 4K with a 70° horizontal field of view.

| Frame-local magnitude | float32 step | A 1 km separation |
| --- | --- | --- |
| 1 km | 61 µm | exact |
| 1 AU (1.5×10¹¹ m) | 16.4 km | **not representable — the two points become one number** |
| 10¹³ m | 1,049 km | not representable |
| 10¹⁵ m | 67,109 km | not representable |
| 1 ly (9.5×10¹⁵ m) | 1.07×10⁶ km | not representable |

Two conclusions, measured rather than argued:

- **The naive path breaks at 1 AU** — Layer 2, not Layer 4. Anything closer together than the
  float32 step collapses to the same number *before* the subtraction, so no later resolution
  recovers it.
- **No cell arithmetic is required.** The camera-relative path subtracts while both values are
  still doubles; every tested case then lands under a tenth of a pixel. Cells and automatic
  rebasing are deferred to Layer 4, behind the `Position` type.

**Correction, recorded deliberately:** an earlier version of this section reported
"3,140 px" of on-screen error for the naive path. That number came from dividing the positional
error by the marker's own distance and using a small-angle approximation; once the relative
position collapses, the object is drawn *at the camera* and has no separate depth to divide by.
The figure is withdrawn — see `docs/notes/precision-error-to-pixels.md`. The step table above is
arithmetic that survives the retraction.

## Result (built, 2026-11-23)

`capture/shots.json`, 1920×1080, three markers in a frame whose origin is 10¹³ m from the camera:

| Shot | Marker spread | Worst positional error |
| --- | --- | --- |
| `layer1-precision-fixed` | 146 px | 2.0 mm |
| `layer1-precision-naive` | **0 px** (all three on one point) | **246.9 km** |

They differ only in how the CPU built the camera-relative value. The harness fails the naive
shot if it ever separates the markers, and fails the fixed shot if the spread drops below
100 px — so the negative control cannot quietly stop detecting the bug.

## Decisions

### D1 — Camera-relative float32 now; cell arithmetic deferred behind `Position`

`Position` stores a frame origin and a double-precision local vector. The GPU receives
`toCameraRelative(origin)` as float32. A caller can never hand the GPU an absolute value,
because the type has no method that returns one.

**Deferred:** the int64-cell representation, `cellSize ≥ frameDiameter ÷ 2⁵²`, and automatic
rebasing from ADR-0002. They are not needed for Layer 2 or Layer 3 (measured above), they
first pay off when travel crosses frames at Layer 4, and they are contained behind `Position`
when they arrive.

Why defer rather than build: the cell API would be designed before a single consumer exists,
which produces an interface that fits an imagined object rather than the one actually drawn.
The irreversible parts are not in the deferred set — they are the address format (D2) and the
invariant test (Evidence 1), both of which ship now.

Rejected for the deferred slot, kept on record: `BigInt` cells (exact, but allocates in the
per-frame path, which ADR-0002 warns against) and hi/lo `int32` pairs (fast and exact, but
every compare, sort and hash becomes hand-written code where errors are silent).

### D2 — The address is an unbounded list of levels

Format: `v1/<i0>.<i1>.<i2>…` — a version prefix and a dot-separated list of signed integers,
**with no fixed depth**. Example: `v1/0.3.-7.12`.

- Display names are resolved from the indices (`"Milky Way / Orion Spur / Sol"`); unnamed
  levels get a generated designation (`"Region 4211"`). Names are presentation, indices are
  identity. **Confirmed by the owner (ADR-0008 amendment): the string stays opaque.** A pasted
  link is meant to read like a coordinate, not like prose; names are for the HUD only and never
  change what a link says. Naming must therefore be depth-indexed with a fallback, since a
  seven-level surface-site address has no entry in a five-tier table.
- A fixed five-level address would give the universe an edge. An unbounded list cannot —
  there is always a bigger region to name. This is what makes "infinite" true rather than
  rhetorical.
- The version prefix exists because the seed→content function is public API (ADR-0005):
  changing it must break old links loudly, not quietly show a different planet.

### D3 — Depth is deferred, projection is not

Layer 1 builds the camera-relative view transform but no depth buffer; the current pass is a
single full-screen triangle. Reverse-Z arrives with the first geometry in Layer 2, so the view
matrix is designed to feed it rather than being retrofitted.

## Evidence

The claim is *"positions stay accurate at any distance"*. Three independent proofs, all cheap:

**1. Unit test, the headline number.** The same object 1 km from the camera, in a frame whose
origin is 10¹³ m away: naive absolute f32 errs by exactly 1,000 m (the separation is destroyed
and the object is drawn at the camera); the camera-relative path errs by 0 m. Asserted as an
absolute tolerance, as a ratio, and across separations from 1 m to 100 km. This is the test that
fails if someone later "simplifies" by sending absolute coordinates.

**2. Negative control in the capture harness.** A debug switch renders the pipeline two ways:
`?precision=fixed` and `?precision=naive`. Three markers at one depth, in a frame whose origin
is 10¹³ m from the camera. The naive shot **must** collapse them onto one point: 146 px apart
on the fixed path, 0 px on the naive one. If that shot ever passes with a spread, the harness
has stopped detecting the bug and the positive shot means nothing. Two shots in
`capture/shots.json`.

**3. A readout.** The worst-case positional error in metres for both paths, in the dev HUD, so
the number is visible while flying rather than only in a test.

## Non-goals

- No cells, no rebase automation, no grid shader. Deferred with the reasoning above.
- No travel, no warp, no LOD.
- No new scenery. The starfield placeholder stays until Layer 2.
- No octree storage. Generation is still `f(seed, address)`, evaluated on demand.
- No change to the URL's existing `seed`, `epoch`, `t`, `cam`; the address is added alongside
  them and the old form keeps working.

## Risks, stated plainly

- **`Position` is a subtle idea.** The failure mode is a future contributor sending an absolute
  position to the GPU because it "worked in the test". The negative-control capture and the
  narrow interface exist for exactly this.
- **Deferring cells means revisiting this ADR at Layer 4.** That is the accepted cost of not
  guessing an API. The mitigation is that only `src/frame/` changes.
- **The address scheme is the expensive-to-reverse part.** If an unbounded list is wrong for
  the intended product, now is the cheapest moment to say so.

## What was built (2026-11-23)

1. `docs/adr/0008-camera-relative-and-unbounded-address.md` — the rule, plus what is deferred
   and why, so the deferral is a recorded decision and not an omission.
2. `src/frame/position.ts` — `Position` and both paths; `src/frame/address.ts` — unbounded,
   versioned address parse/format; `src/frame/precision-probe.ts` — the marker scene.
3. `?precision=fixed|naive`, drawn by `src/gpu/stage0.wgsl`; the two-path readout in the HUD.
4. `capture/shots.json` gained the two shots, and `tools/capture.mjs` fails a probe shot that
   does not reproduce the control. Seam `verify` widths unchanged.
5. Floor run: `npm run build`, `npm test`, `npm run capture`, `npm run verify:dev` — real output
   reported in the session record.

## Amendment — testing the format found three defects (2026-11-23)

The question asked was "does `v1/4.-2.7.1` read as a place?" A round-trip test was written to
answer the machine half of that (`src/frame/sharing.test.ts`): every scale from the root down to a
surface site, out through `urlForState` and back through `parseUrlState`. It failed on the first
run, and for a reason that is not a matter of taste:

1. **The parser rejected the root, which the serializer emits.** `formatAddress({levels: []})`
   produces `v1/`, and `/^v\d+\/(.+)$/` cannot match it — so the app could mint a link it could
   not read. Since zoom-out is "drop one level" and must terminate, the root is load-bearing: it
   is the frame that contains everything. `parseAddress` now accepts it, `parentAddress` is the
   inverse of `childAddress` (returning `null` at the root), and `describeAddress` renders it as
   `v1/ · root` rather than "0 levels".
2. **The capture manifest carried a second copy of the address grammar.** `tools/capture.mjs`
   validated `address` with `/^v\d+\/[-.\d]+$/`, so changing the real grammar broke the harness
   instead. Worse, a value the harness accepted but the page rejected was captured anyway — a
   picture of the *default* coordinate under the requested shot's name. The regex is now
   deliberately loose and the page is the authority: `assertAcceptedQuery` fails any shot whose
   HUD reports a rejected parameter.
3. **`formatNumber` emitted `1e+22`, which the query string escaped to `1e%2B22`.** A literal `+`
   in a query string also decodes as a space, so the sign had to go. Large and small magnitudes
   now use exact exponential form (`1e17`, `1.2345e-9`).

Measured cost of the defects: none in production behaviour (the address grammar had never been
shipped to a user), but the manifest case would have produced silently wrong evidence the first
time a shot used a parameter the page rejects. Full detail in
`docs/notes/manifest-is-not-the-parser.md` and the amendment to ADR-0008.

**Six real links**, produced by the shipped serializer (`.scratch/print-share-links.mjs`):

| Scale | Length | `addr` |
| --- | --- | --- |
| universe (root) | 76 | `v1/` |
| quadrant | 85 | `v1/4` |
| sector | 91 | `v1/4.-2` |
| system | 104 | `v1/4.-2.7` |
| body | 92 | `v1/4.-2.7.1` |
| surface site | 100 | `v1/4.-2.7.1.9.3.12` |

All under 105 characters, well inside what a chat client will carry; a maximum-depth (64-level)
link is still under 1,000.