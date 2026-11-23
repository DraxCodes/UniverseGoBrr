# 0008 — Camera-relative positions now; cells and rebasing deferred behind `Position`

**Status:** accepted (2026-11-23) — amended twice the same day: the address gained a root, and the
format was confirmed to stay opaque identity rather than becoming human-readable.
**Context:** ADR-0002 predates any rendering. Its decision — absolute positions on the CPU,
camera-relative float32 on the GPU — is confirmed by measurement. Its *mechanism* (int64 cell
indices and automatic rebasing) was chosen before a single consumer existed, and a spike shows
it is not needed for the next two layers.
**Amends:** ADR-0002 (the representation; the invariant stands).

## What was measured

The GPU's arithmetic was reproduced on the CPU — round the target and the camera to float32,
subtract, project at 4K with a 70° horizontal field of view. The float32 step table is asserted
in `src/frame/position.test.ts`, so it is not a claim that depends on a scratch script.

| Frame-local magnitude | float32 step | A 1 km separation |
| --- | --- | --- |
| 1 km (10³ m) | 61 µm | exact |
| 1 AU (1.5×10¹¹ m) | 16.4 km | **not representable — the two positions become one number** |
| 10¹³ m | 1,049 km | not representable |
| 10¹⁵ m | 67,109 km | not representable |
| 1 ly (9.5×10¹⁵ m) | 1.07×10⁶ km | not representable |

Two facts, both decisive:

1. **The naive path breaks at 1 AU**, which is Layer 2's first planet, not a far-future
   concern. Anything closer together than the float32 step collapses to the same number, so
   the object is drawn *at the camera* rather than where it is. No amount of resolution
   recovers it, because the information was destroyed before the subtraction.
2. **Camera-relative double subtraction fixes every case**, with no cell arithmetic and no
   rebasing: the subtraction happens on values that are still doubles, and only the small
   result is rounded.

The precision probe measures the result end to end in `capture/shots.json`: at 10¹³ m, three
markers 123,456.789 m apart are 146 px apart on the fixed path and **0 px** apart on the naive
path, with worst errors of 2.0 mm and 246.9 km respectively.

A pixel count for the naive failure is deliberately not quoted. Once the relative position has
collapsed to zero, the displacement is "to the camera", not a measurable offset, and any
px figure for it would be an artefact of the formula rather than an observation.

## Decision

1. **Position is an opaque type**: a frame origin plus a double-precision local vector, in
   metres. Its representation is private to `src/frame/position.ts`.
2. **The only route to the GPU is `toCameraRelativeF32(target, camera)`**, which subtracts in
   double precision and rounds **once**, afterwards. No export of that module returns an
   absolute coordinate as float32.
3. **`toCameraRelativeNaiveF32` exists on purpose.** It reproduces the pre-fix path so the
   negative-control capture has something real to fail against.
4. **The address is an unbounded list of levels**, `v1/<i0>.<i1>.<i2>…`. No fixed depth, so no
   largest region and therefore no edge. Display names are resolved from the indices; the
   indices are identity.
5. **`v1/` with no levels is the root** — the frame that contains everything. Zooming out drops
   one level (`parentAddress`), so the walk terminates at a real frame rather than at an error,
   and "the whole universe" is a link that can be shared. The root is also the only frame with
   nothing outside it, which is what "no edge" means concretely.
6. **Int64 cells, the `cellSize ≥ frameDiameter ÷ 2⁵²` rule, and automatic rebasing are
   deferred to Layer 4**, when travel first crosses frames. They are recorded in this ADR so
   the deferral is a decision rather than an omission.

## Why deferral is not the usual mistake

"Infrastructure never gets done if deferred" is a real risk, and the answer here is that the
parts that cannot be retrofitted are *not* in the deferred set:

- The **address format** is public API: a shared link encodes it. It ships now.
- The **invariant test and the negative control** are the guard against regression, and they
  ship now. They hold whether or not cells ever arrive.
- Cell arithmetic and rebasing sit entirely behind `toCameraRelative`. Replacing the internals
  of one module touches no caller. Designing that module before its first consumer exists
  would produce an interface shaped by an imagined object rather than a drawn one.

## Consequences

- `Position` carries an origin, so equal-frame subtraction is exact rather than merely close:
  the origin difference is `0.0`, and a one-metre local offset survives untouched.
- A double's own step at 10¹³ m is ~1.95 mm. That is the floor the readout reports, and no
  number here claims sub-millimetre precision at system scale.
- Every future scene must place objects through `Position`. Passing a raw float32 triplet from
  anywhere is the failure mode; the interface makes it awkward and the capture makes it visible.
- Layer 2 (star system) needs depth, not cells. Reverse-Z with layered near/far ranges arrives
  with the first geometry, as ADR-0002 already said.
- Revisit at Layer 4. If travel between frames needs exact cell identity for caching, the cells
  land inside `src/frame/`; if it does not, that work was correctly never done.

## Evidence in this repo

- `src/frame/position.ts` — the type and the two paths.
- `src/frame/position.test.ts` — the headline assertion: 1,000 m survives the fixed path and
  becomes 0 m on the naive one at 10¹³ m.
- `src/frame/precision-probe.ts` — three markers in a 10¹³ m frame.
- `capture/shots.json` — `layer1-precision-fixed` (146 px apart, 2.0 mm worst error) and
  `layer1-precision-naive` (0 px apart, 246.9 km worst error). The harness fails the naive shot
  if it ever separates the markers, because that would mean it has stopped detecting the bug.
- `src/frame/sharing.test.ts` — the round-trip test that found the root gap: every scale from
  the root down to a surface site must survive `urlForState` → `parseUrlState`, and dropping one
  level at a time must reach `v1/` in a finite number of steps.

## Amendment — the root, found by testing the format (2026-11-23)

The decision above said "no fixed depth" but never said whether **zero** levels is an address.
The parser said no (`/^v\d+\/(.+)$/`), while `formatAddress` emitted `v1/` for an empty list — so
the app could produce a link it could not read. The serializer and the parser disagreed, which is
a defect regardless of which side is right.

Making the root real is the resolution, for the reason the format exists: zooming out is
"drop one level" (spec §5, the clickable address HUD), and that walk has to terminate at a frame
rather than at an error. `parentAddress` is the inverse of `childAddress` and returns `null` at
the root; `describeAddress` renders it as `v1/ · root` so the HUD does not say "0 levels".

The same test found two more defects, both fixed:

- **The capture manifest held a second copy of the address grammar** (`tools/capture.mjs`,
  `/^v\d+\/[-.\d]+$/`). Two grammars drift. The harness regex is now deliberately loose — a typo
  guard — and the **page is the authority**: the harness fails any shot whose HUD reports a
  rejected parameter, because a rejected `addr` silently captures the *default* coordinate. That
  is the same class of failure as the retracted pixel figure: an image that does not prove what
  it claims.
- **`formatNumber` emitted `1e+22`, and the query string escaped the `+` to `%2B`** (`1e%2B22` in
  a shared link). A literal `+` in a query string also decodes as a space, so the sign had to go.
  Large and small magnitudes now use exact exponential form (`1e17`, `1.2345e-9`); `toExponential()`
  round-trips the same double, so this is presentation, not precision.

## Amendment — the address stays opaque identity (2026-11-23, decided by the owner)

The question put to the owner was whether the address should stay opaque, with names resolved only
for display, or whether scale should be legible in the string itself (for example a type prefix
per level). **The decision is opaque.** A pasted link is expected to look like a coordinate, and
that is the desired behaviour: *"it doesn't read as human readable but it certainly reads as a
coordinate system would."* Sending `check out this cool event` plus the link is the intended
sharing moment, and the link already carries the whole coordinate — seed, frame, camera, epoch and
pinned `t` — so it names the moment as well as the place.

Consequences to honour when display names land in Layer 3:

- **The string is not a description and must not be made to behave like one.** No parse-time
  inference of "this level is a galaxy" from its position, and no per-level type prefix: a level's
  *kind* comes from the generator at that depth (`f(seed, address)`), not from the string.
- **Names must be depth-indexed with a fallback, not a fixed enum.** The five familiar tiers
  (universe → quadrant → sector → system → body) do not cover every legal depth; a seven-level
  surface-site address has no entry in a five-entry table. Unnamed depths get a generated
  designation, as D2 of the Layer 1 brief already says.
- **The address is identity and stays byte-stable.** Renaming a displayed tier must never rewrite
  a link. Anything a person can edit is `seed`, `addr`, `t`, `cam`, `epoch`; everything else is
  derived.
- Rejected alternative, recorded so it is not re-opened by accident: a readable scheme
  (`galaxy-4.spur2.sol.earth`) costs stable identity the moment a display name changes, and it
  cannot name depths nobody has visited yet.
