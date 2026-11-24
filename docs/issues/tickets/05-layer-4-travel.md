# 05 - Layer 4: travel tiers

**Status: decided (owner, 2026-11-24).** D1, D2, D4 and D5 as recommended; **D3 amended** to
`Δt = d / v(method)` (ADR-0010). **Lane P is done and passes** (2026-11-24): approach stays inside
one frame (worst 5.3×10⁻⁵ px), so the rebase is **address-only** and the focus rule is out of v1.
**Lane 1 is done**, and the placement direction is decided (ADR-0011): the address grid is the
world and the picture is a view of it. **Both halves of placement are built**
(`src/universe/placement.ts`, with the shared disc law in `src/universe/disc.ts`): every address has
a position **and** the picture draws by address, so every drawn light carries one
(`GALAXY_VERSION` 5 → 6). Speed constants are confirmed (see the end of this brief). **Lane 2 is
built** (`src/universe/travel.ts`, the history rule, Back/Forward re-entry; ADR-0012), **lane 3 is
built** (the compass, clickable address lines, free zoom-out; ADR-0013), and **panning is built**
(the camera target, right-drag panning, `tgt=`; ADR-0014). Still ahead: the tier masks. The owner's
2026-11-24 answer on those: **not this round** — the state machine and effect go to Neon, and the
`perception` gate is scored with a lower bar (a 6 or 7 is a pass with work routed, not a failure).

## Deliverable (spec §7, row 4)

> **Travel tiers** - frame rebases, warp effects, navigation compass. *The core loop.*

ADR-0003 says travel tiers **are** frame rebases and the effect is the mask for the swap.
ADR-0008 deferred int64 cells, the `cellSize >= frameDiameter / 2^52` rule and automatic rebasing
to exactly here. Layer 4 is where that deferral is either spent or retired.

## What exists today

- `Position` (`src/frame/position.ts`) is already an opaque frame origin plus a double local
  vector; the only route to the GPU is `toCameraRelativeF32`, and the naive path exists as a
  negative control. That interface was built so the internals could change without touching a
  caller.
- The address is unbounded, has a root (`v1/`), and is opaque identity (`describeAddress` is
  display only). `childAddress` / `parentAddress` are the only navigation primitives.
- The camera is `target + yaw/pitch/distance` (`src/state/url-state.ts`,
  `src/input/orbit-controls.ts`); "position is derived from angles and distance" is an invariant
  several tests rely on.
- Every scene normalises to its own scale: `buildSceneFrame` uploads `(object - camera) / scale`,
  so the float32 window is per scene, not per universe.
- One galaxy and one system render from `(seed, address)`; nothing is cached or persisted.

## D1 - What a frame is, and where its origin lives

The question the whole layer turns on: **when the camera moves, what moves with it?**

- If the origin is the current **address node**, then crossing a tier is the rebase, and the
  address is the only navigation state.
- If the origin is a **cell** on an int64 lattice, rebasing is a threshold event independent of
  the address, and the address changes only when a tier boundary is actually crossed.

These are compatible (an address node can own a cell), but the choice decides how many coordinate
representations exist and what a "rebase" is allowed to change.

## D2 - The rebase trigger and its threshold

ADR-0008 recorded `cellSize >= frameDiameter / 2^52`. If cells land, the trigger is the camera's
offset within its cell crossing a fraction of `cellSize`; if they do not, the trigger is the
address changing tier. Either way the rule must be a named constant with a test, not a magic
number in a frame loop.

**A rebase must be pixel-invisible.** The evidence is a capture pair straddling the trigger that
is identical to the eye, plus a precision readout that does not move.

## D3 - The tiers and their masks

Spec §3.2 names four tiers and four effects: impulse (none), warp (star streaks, sector to
system), transwarp (tunnel, system to another quadrant), subspace (aperture, galaxy to galaxy).
Open questions the council must answer, because they define the feel:

- Is a tier crossing **a cut with a mask** (instant, effect plays over the swap) or **a journey**
  (the camera actually traverses, and the effect is what traversal looks like)?
- Does the effect scale with distance, or is it one animation per tier?
- What happens on a **failed** or **interrupted** crossing - is an interrupted warp a state the
  app can be in?

## D4 - The compass

Spec §3.2: warping to an arbitrary empty point requires a **navigation compass** - bearing and
distance to the nearest anchors, a pin on where you came from, a return breadcrumb. The cosmic
address HUD (moved here from Layer 3) is half of it: the postal address of where you are, each
line clickable to zoom out. The breadcrumb is the other half.

Open: are anchors **content** (nearest generated nodes, which cost a search) or **navigation state**
(the trail you actually travelled)? The former is honest and expensive; the latter is cheap and
lies about the neighbourhood.

**Answered (owner, 2026-11-24) and landed — ADR-0013, lane 3 below.** Anchors are **content**: the
three nearest stars the galaxy population is already drawing, so the compass cannot point at
something the picture does not show (ADR-0011). The pin is the place the last committed travel
started, carried in the link as `from=` and treated as a coordinate. The address line is a **free
zoom-out**: it changes the address and the camera but costs no universe time, and still gets a
history entry because Back retraces places. v1 offers the compass as a HUD list (anchors + pin,
bearing, distance, click to travel); an on-canvas needle is later work.

## D5 - Panning

Deferred here from Layer 3 (status.md, open question 4). Panning changes the camera `target`, which
is the same generalisation as travel: `target + yaw/pitch/distance`. It must not break the "position
is derived" invariant or the precision window; it belongs with the rebase work, not before it.

**Decided (owner, 2026-11-24): left-drag keeps orbit, right-drag pans.** Built, with the target
generalisation and `tgt=` in the URL — see "Lane 4 mechanics" under D7 and ADR-0014. `rebaseCamera`
is still without a production consumer: the galaxy zoom-out stays a face-on reframe, because a
translation-preserving one would look along the disc's own plane.

## D6 - Time during travel

**Decided (owner, 2026-11-24): `Δt = d / v(method)`.** Time advances by the distance travelled
divided by the method's speed, never by a fixed duration per tier: a 5 ly warp and a 500 ly
transwarp can both take five days. `d` is measured in the parent frame; camera gestures are not
travel and never advance `t`; effect duration (screen time) and elapsed time (universe time) are
different numbers. Speed constants and the placement prerequisite are in ADR-0010.

## D7 - The URL and sharing contract

A link already carries `seed`, `addr`, `cam`, `t`, `epoch`. During travel the address, the camera
and possibly `t` all change, and a panned view adds `tgt`. The contract must say:

- when the URL is rewritten (per frame is wasteful and makes history unusable);
- whether a mid-travel link is legal (it probably must be, or a reload loses the journey);
- that a rebase never changes the address unless a tier boundary was crossed - otherwise a link
  taken before and after a rebase would disagree about where the traveller is.

**Landed (2026-11-24, ADR-0012).** A committed travel is one atomic state change — destination
address, advanced clock, destination's opening camera — and a travel is *exactly* "write the arrival
link and enter it". So a mid-travel link is the arrival link: it is legal, it pins the arrival `t`
when the clock was pinned, and there is no stored `jour` parameter for a crafted link to mismatch.
History discipline (`historyWrite` in `src/state/url-state.ts`):

- **the rule is the address**: a write that changes it `push`es, a write that keeps it `replace`s;
- a camera gesture cannot change the address (ADR-0004), so a gesture always replaces;
- a repeat of the current entry's address collapses to `replace`;
- Back/Forward re-enter the coordinate, because `popstate` rebuilds the scene from the URL.

Two honest limits: a **live** clock can only be advanced by moving its epoch (the alternative
freezes the orrery), so a live arrival link drifts with the wall clock exactly like every live link
already does; a **pinned** arrival link is exact. And `rebaseCamera` still has no production
consumer: under ADR-0012 an arrival is re-framed, not translated, and so is the lane-3 zoom-out
(ADR-0013); lane 4's panning moves within one frame and never rebases either (ADR-0014). Its first
consumer will be a travel that keeps the departure's offset instead of re-framing — not this layer.

### Lane 2 mechanics, as built

- **`planTravel(seed, from, to)`** (`src/universe/travel.ts`) returns the method, the distance in
  the shared galaxy frame, `Δt = d / v(method)`, or a plain `reason` the jump is refused. It never
  invents a number: a galaxy-to-galaxy jump is refused because no root layout exists.
- **The method uses the address, not a threshold.** A trip that touches the disc population is a
  transwarp; a local-field-only trip is a warp (ADR-0011's two populations). The rule is symmetric,
  so a round trip cannot pick two speeds. `impulse` is free flight and is never a travel action;
  `subspace` is selected for a galaxy crossing and then refused for lack of distance.
- **`advanceClock`** (`src/state/url-state.ts`) preserves the clock's mode: pinned `t` moves, live
  epoch shifts back. Travel never freezes a live world (ADR-0012).
- **The trigger is the debug surface for now.** `window.__ugb.travel('v1/0.9')` commits a jump;
  the compass and the clickable address HUD bring the user-facing control in lane 3. No placeholder
  key was invented, so nothing ships that lane 3 has to remove.
- **Evidence:** `npm test` covers the plan, the history rule and the clock's two boundary refusals;
  `npm run probe:travel` (`tools/travel-probe.mjs`) drives the built app (travel → arrival link
  reload → Back → Forward → framing write) and is the check to re-run after any `start()`/`init()`
  change, including that the arrival link reproduces the address, camera and epoch exactly.

### Lane 3 mechanics, as built

- **`src/universe/navigation.ts`** holds the three answers to "what is within reach of this
  address": `nearestAnchors` (one pass over the drawn galaxy, best-K, deterministic tie-break by
  address text), `bearingOf` (the renderer's own `cameraBasis`, so the printed bearing is the
  direction the eye is pointing), `planZoomOut` (the address-line policy) and `galaxyFraming` (the
  face-on camera that fits the whole disc).
- **`from` in `UrlState`.** A committed travel sets `from` to the departure address; the link
  carries it as `from=`. A malformed or self-pointing pin is dropped with an issue, never a crash.
  The pin is shown only when it is in the current galaxy, because a cross-galaxy distance is
  unmodelled (ADR-0010).
- **`writeUrl` now sets `currentEntryAddress` on every write**, not only on `push`. A framing write
  that changed the address would otherwise leave the comparison stale and turn the next navigation
  into a duplicate `push`.
- **The zoom-out is one reframe.** `commitZoomOut(depth)` writes the ancestor address and
  `orbitTo(framing.yaw, framing.pitch, framing.distanceM)`, then re-enters through `start()`.
  `galaxyFrame(seed, address).centre` supplies the offset without generating a population.
- **The HUD is the v1 control.** Address segments are buttons; the compass is a list of rows, each
  a button that commits the same travel `window.__ugb.travel` does. Bearings are re-rendered on
  every camera change; distances are fixed to the place.
- **Evidence:** `src/universe/navigation.test.ts` (anchors, bearings, policy, framing, orbit
  invariant); `npm run probe:compass` (`tools/compass-probe.mjs`) drives the built app: the address
  lines, the rows and their addresses, a drag changing a bearing, a row travelling and pinning the
  departure, the arrival link reproducing the pin, the zoom-out keeping `t`/`epoch` and gaining one
  history entry, Back returning to the star, and a refused root leaving the page alone.

### Lane 4 mechanics, as built: the camera target and panning

- **`Camera` gained `target: Vec3`** (`src/state/url-state.ts`). The eye stays **derived**:
  `target − forward(yaw, pitch) · distance`. Every function in `src/input/orbit-controls.ts`
  (`orbitTo`, `orbitParams`, `dragOrbit`, `zoomBy`, `panBy`) returns a camera satisfying that, so the
  renderer's contract is unchanged and the invariant several tests rely on still holds — only the
  point the angles and distance are relative to became explicit, and it is the frame origin by
  default.
- **`orbitDistance` is eye-to-target**, and the orbit-controls clamp, the wheel's `notchFactor`
  input and the HUD's scene row all use it. Measuring from the frame origin would make a panned view
  look like a zoom-out and fire the clamp at the wrong moment.
- **`panBy(camera, dxPx, dyPx, viewportHeightPx)`** moves target and eye by the same vector at
  `2 · distance · tan(FOV/2) / viewportHeightPx` metres per pixel, so the grabbed point stays under
  the cursor. Right-drag pans; left-drag still orbits; the canvas suppresses `contextmenu` so the
  browser menu does not open at the end of a pan.
- **`tgt=x,y,z` in the URL**, written only when the target is not the origin. A link that never pans
  is byte-identical to the lane 2/3 format. `tgt` without `cam` is reported and ignored — a target
  with no eye has no meaning.
- **A pan is a gesture, not a place**: the address cannot change (ADR-0004), so `historyWrite`
  replaces the current entry, Back never grows, and no universe time passes (ADR-0010).
- **The HUD** appends `· panned` to the view row and puts the target in its tooltip, so a shared
  link's `tgt` can be checked against what is on screen.
- **Evidence:** `src/input/orbit-controls.test.ts` (the eye-to-target invariant, target-preserving
  orbit/wheel, a grabbed point staying centred, metres-per-pixel at the target's depth, no-op
  guards); `src/state/url-state.test.ts` (`tgt` round-trip, absence, orphan, malformed);
  `npm run probe:pan` (`tools/pan-probe.mjs`) drives the built app with real mouse buttons: an
  unpanned link carries no `tgt`, a right-drag moves the target and the eye by the same vector with
  the angle unchanged, history does not grow, a left-drag keeps the target and changes the angle,
  the wheel keeps it, the reloaded link reproduces target and eye, and `R` clears it.

## D8 - No new content

Layer 4 generates nothing new. It moves through what Layers 2 and 3 already produce, plus the
authored registry. If a deliverable needs new generation (nebulae, actors, belts), it belongs to
Layer 5 or later.

**One narrow exception, entailed by D6:** `placement(seed, address)` gives a node a deterministic
position in its parent frame. Without it there is no distance, and without a distance D6 cannot be
computed. It is one pure, versioned function - not a population - and the compass needs it too.
ADR-0011 fixes which way round it goes: position from address, never address from a drawn star.
**Shipped:** `src/universe/placement.ts` (`PLACEMENT_VERSION 1`), with the disc law it shares with
the generator in `src/universe/disc.ts`.

## Evidence plan (to be finalised by the council)

- A probe that crosses each tier and prints the address, the camera in double metres, the offset
  from the frame origin, and the float32 step at that offset - before and after the rebase.
- A capture pair straddling the rebase trigger, compared at 1:1 (`docs/notes/check-captures-at-1-to-1.md`).
- A link round-trip during travel: reload from a mid-travel URL and land in the same state.
- The compass read against known anchors: bearing and distance are checked arithmetic, not vibes.
- The precision negative control must still fail (it is the guard that the harness detects the bug).

## Non-goals

- Nebulae, volumetric anything (Layer 5).
- Surfaces, landing, terrain (Layer 6, possibly never).
- Actors, traffic, civilisations (ADR-0006 needs its own council).
- Any new content population.
- Mobile layout (spec §1).

## Risks, stated plainly

- **An invisible rebase is easy to believe and hard to prove.** Without the capture pair and the
  offset readout, a rebase bug looks like "the planet is slightly in the wrong place" and survives
  review.
- **Two coordinate representations drift.** If cells arrive beside `Position`, exactly one module
  may own the conversion, and it must be the same module that owns `toCameraRelative`.
- **Address flapping.** If the address is derived from position rather than from a chosen frame,
  a camera hovering on a boundary will oscillate between two addresses and rewrite the URL.
- **The compass can lie cheaply.** A breadcrumb that shows "home" at a stale coordinate is worse
  than no compass, because it is trusted.
- **Time couples to feel.** Choosing "travel advances `t`" without deciding the rate makes the
  arrival state unpredictable and unshareable.
- **Position is not identity yet.** `placementKey` and `galaxyKey` reduce the address to 32-bit
  FNV-1a (the hash module calls itself "good enough for placeholder work"). Two addresses can collide
  and receive the same position; harmless while a position is only drawn, but if anything treats a
  position as identity — a pinned place, an arrival check — widen the key hash to at least 64 bits
  behind a `PLACEMENT_VERSION` bump. Do not rely on a position as a primary key before then. **The
  exposure grew when the picture started drawing by address:** a rich galaxy now hashes 45,000
  sibling keys, so the birthday bound gives roughly 0.24 expected colliding pairs per galaxy —
  about one galaxy in four draws two lights at the same position under different addresses. That is
  a visual duplicate, not an identity confusion (identity is the `Address`), but the next layer's
  travel state and compass are exactly the features that would turn a position into a key. Widen
  the hash before designing an arrival check. **Lane 2 keeps identity in the address:** `planTravel`
  uses positions only to compute a distance, and an arrival is still an address, so a collided pair
  reads as a zero-distance trip rather than an identity confusion. The trigger is still unmet; the
  compass's nearest-anchor search is the next candidate to meet it.
- **The root is not a galaxy.** `generateGalaxy` guards the root and returns the home star alone;
  `starKind` throws rather than classifying a shallow address. Before those guards, `?addr=v1/`
  hung the tab in an unbounded child walk.
- **A live clock cannot be made byte-exact by travel.** Time advances by moving the epoch, so a
  live arrival link drifts with the wall clock exactly like every live link already does. Only a
  pinned arrival link reproduces an instant; do not claim otherwise in copy or evidence.
- **A travel that the URL cannot represent is refused, not written.** The reader caps `t` at `±1e20`
  and accepts only four-digit ISO years, so an arrival past either bound would reload as a different
  state (pin dropped, epoch reset). `advanceClock` returns a reason instead, and `commitTravel`
  shows it. Crafted edge values reach this first; a live clock reaches it after ~7 maximum jumps.
- **Changing the address rebuilds the app.** The renderer captures `system` and `galaxy` once, so
  a coordinate change is `start()` (dispose + `init`), not a state patch. A second "update the
  scene" path would duplicate `init` and drift: `docs/notes/reentering-a-coordinate.md`.
- **Right-drag panning fights the browser.** A context menu opens on right-button release unless the
  canvas suppresses it while a right-drag is active. Suppress only during the drag, not globally,
  or the rest of the page loses its menu.

## Decisions this brief does not make

Answered on 2026-11-24 (see `council-layer-4.md` §10): rebase strategy **A**, tier-only; a
**journey** rather than a cut; **tiers + panning first**, compass second; panning with the tier work;
time by **distance over speed** (ADR-0010). The **speed table is confirmed as proposed** (impulse
0.01 c, warp 1 ly/day, transwarp 100 ly/day, wormhole 10,000 ly/day). The **panning binding** is
settled: left-drag keeps yaw/pitch as today, **right-drag pans**, and the canvas suppresses the
context menu while a right-drag is active. Touch/pen panning waits with the mobile layout (spec §1).

Still open, and small enough to answer at the first build step:

1. ~~**Speed constants**~~ - **answered 2026-11-24 (owner): the table in ADR-0010 is confirmed as
   proposed.** Changing a row later is a content change and moves the arrival `t` of every link that
   crosses it.
2. ~~**Placement choice**~~ - **answered 2026-11-24 (owner): the address grid is the world, and the
   picture is a view of its occupied cells (ADR-0011).** `placement(seed, address)` returns a
   position; it is never asked to invert a drawn star. The galaxy keying that made every address a
   private galaxy was fixed with the decision (`GALAXY_VERSION` 4 → 5). **Shipped** as
   `src/universe/placement.ts`; the remaining half — the picture drawing *by* address — **also
   shipped** (`GALAXY_VERSION` 5 → 6, `PLACEMENT_VERSION 2`), so every drawn light carries the
   address that produced it. Mechanism and versioning:
   `docs/notes/population-draws-by-address.md`.
3. **Address HUD behaviour in v1** - read-only, or clickable-to-zoom-out from the first commit.

Owner: the shape is settled. Nothing in the code assumes a decision that is not written down.