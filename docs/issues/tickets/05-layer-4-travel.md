# 05 - Layer 4: travel tiers

**Status: decided (owner, 2026-11-24).** D1, D2, D4 and D5 as recommended; **D3 amended** to
`Δt = d / v(method)` (ADR-0010). **Lane P is done and passes** (2026-11-24): approach stays inside
one frame (worst 5.3×10⁻⁵ px), so the rebase is **address-only** and the focus rule is out of v1.
**Lane 1 is done**, and the placement direction is decided (ADR-0011): the address grid is the
world and the picture is a view of it. **Both halves of placement are built**
(`src/universe/placement.ts`, with the shared disc law in `src/universe/disc.ts`): every address has
a position **and** the picture draws by address, so every drawn light carries one
(`GALAXY_VERSION` 5 → 6). Speed constants are confirmed (see the end of this brief). Still ahead:
travel state/history, the compass, and the tier masks with panning.

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

## D5 - Panning

Deferred here from Layer 3 (status.md, open question 4). Left-click X/Y panning changes the
camera `target`, which is the same generalisation as travel: `target + yaw/pitch/distance`. It must
not break the "position is derived" invariant or the precision window; it belongs with the rebase
work, not before it.

## D6 - Time during travel

**Decided (owner, 2026-11-24): `Δt = d / v(method)`.** Time advances by the distance travelled
divided by the method's speed, never by a fixed duration per tier: a 5 ly warp and a 500 ly
transwarp can both take five days. `d` is measured in the parent frame; camera gestures are not
travel and never advance `t`; effect duration (screen time) and elapsed time (universe time) are
different numbers. Speed constants and the placement prerequisite are in ADR-0010.

## D7 - The URL and sharing contract

A link already carries `seed`, `addr`, `cam`, `t`, `epoch`. During travel the address, the camera
and possibly `t` all change. The contract must say:

- when the URL is rewritten (per frame is wasteful and makes history unusable);
- whether a mid-travel link is legal (it probably must be, or a reload loses the journey);
- that a rebase never changes the address unless a tier boundary was crossed - otherwise a link
  taken before and after a rebase would disagree about where the traveller is.

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
  behind a `PLACEMENT_VERSION` bump. Do not rely on a position as a primary key before then.
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