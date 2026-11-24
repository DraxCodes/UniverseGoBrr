# Council - Layer 4: travel tiers (proposal to convene)

**Status: not convened.** Prepared 2026-11-24 by the chair so the owner can decide whether to run
it. Nothing here is a decision, and no seat has been asked to take a position. The brief it serves
is `tickets/05-layer-4-travel.md`; the constraint record is ADR-0003 and ADR-0008.

## 1. Question

Layer 4 is *the core loop*: moving between frames. The council's question is not "how do we
animate a warp" but:

> **What is a frame at travel time, what may rebasing change, and what must crossing a tier feel
> like?**

Three sub-questions decide the shape:

1. **Where does a frame's origin live** - at the address node, on an int64 cell lattice, or in a
   stack of nested origins?
2. **What triggers a rebase**, and how do we prove it is invisible?
3. **Is a tier crossing a cut with a mask, or a journey** - and does it advance `t`?

## 2. Constraints (cannot move)

- **ADR-0003:** travel tiers *are* frame rebases; the effect masks the swap. Not an effect with an
  optional rebase underneath.
- **ADR-0005:** the address is public API. A rebase may rewrite the camera and the URL, but it may
  not change the address unless a tier boundary was genuinely crossed.
- **ADR-0008:** `Position` is opaque (origin + double offset), the only route to the GPU is
  `toCameraRelativeF32`, and int64 cells + `cellSize >= frameDiameter / 2^52` were deferred to
  this layer. The negative-control capture must keep failing.
- **ADR-0004:** `t` is an input, evaluated in closed form. Travel may move `t`; it may not simulate
  forward to get there.
- Precision floor: a double's step at 10¹³ m is ~1.95 mm; no claim may go below that.
- No new content generation in this layer (D8 of the brief).

## 3. Non-goals

Nebulae and volumetrics (Layer 5); surfaces and landing (Layer 6); actors, traffic, civilisations
(ADR-0006 needs its own council); mobile layout; any new procedural population.

## 4. What would settle it

- A named rebase strategy with one owner module, and a threshold constant with a test.
- A capture pair straddling the rebase trigger that is identical at 1:1.
- A probe that prints address, camera in double metres, offset from origin, and the float32 step
  at that offset - before and after a rebase, for each tier.
- A mid-travel URL round-trip that lands in the same state.
- A stated experience thesis: what a crossing feels like, and whether you arrive later.

## 5. Options brief

### A. Address-origin frames - rebase on tier crossing

The origin is the current address node; the camera is a double offset from it. Crossing a tier
changes the address and therefore the origin, and the effect masks the swap. Within a frame,
scenes keep normalising to their own scale, exactly as Layer 2 and Layer 3 already do.

**Strength:** one coordinate representation, one navigation state (the address), and it matches
ADR-0003 literally. Nothing new is needed to ship it.

**Cost:** free flight far from the address node leaves a large local offset; approaching a body
then needs a *focus* rebase (origin moves to that body) which is a second, smaller rebase rule.

**Risk:** the second rule is where the "address flapping" bug lives if it is not designed with the
first.

### B. Int64 cell lattice - automatic rebase

`Position` gains a cell index and the renderer rebases whenever the camera's offset crosses a
fraction of `cellSize`. Rebasing becomes a precision event independent of the address; the address
changes only at tier boundaries.

**Strength:** general. It handles arbitrary points, free flight and focus at any distance with one
rule, and it is what ADR-0002 originally imagined.

**Cost:** a second coordinate representation beside the double offset, plus the rule that the
address is never derived from the cell. More invariants to test.

**Risk:** two representations drift exactly where nobody looks - the conversion module.

### C. Frame stack - nested origins

A chain universe → quadrant → sector → system → body, each with its own origin; the camera holds
an offset per level. The HUD's postal address falls out of the stack.

**Strength:** the compass and the address HUD become natural; "zoom out one level" is a stack pop.

**Cost:** the most state and the most places for the chain to disagree; every consumer must know
which level it is in.

**Risk:** it is A with extra bookkeeping unless something needs the intermediate levels
simultaneously - which is exactly what the compass might.

### Trade-off table

| | A. Address origin | B. Cell lattice | C. Frame stack |
| --- | --- | --- | --- |
| Origin | address node | int64 cell | one per level |
| Rebase trigger | tier crossing (+ focus) | offset vs cell fraction | level change |
| Address coupling | total | none (by rule) | total |
| New representations | 0 | 1 (+1 rule) | 1 stack |
| Compass fit | needs anchors | needs anchors | natural |
| Ships without new work | yes | no | no |
| Main risk | focus rebase | drift | chain disagreement |

## 6. Council triggers

The workflow convenes a council when at least two of these hold. For Layer 4:

| Trigger | Holds? | Why |
| --- | --- | --- |
| New user-facing surface | **yes** | compass, address HUD, breadcrumb - the first navigation UI |
| New subsystem / transport | **yes** | rebasing, tier state, travel as a first-class mode |
| Crosses a seam | **yes** | ADR-0008's deferred boundary: frame/render/state/input all meet here |
| Expensive to reverse | **yes** | the coordinate representation is public API via the URL |
| More than one design is credible | **yes** | A, B and C above are each defensible |
| The user asks | no | the owner asked to *start* Layer 4, not for a council |

**Five of six hold.** By the project's own rule this is a council, not a solo design session.
The owner still chooses whether to run it.

## 7. Decisions the owner must make

- **D0 - Convene?** Run the council (`/council`), or decide the strategy directly, or defer
  Layer 4.
- **D1 - Rebase strategy:** A, B or C (the council's job is to recommend; the owner decides).
- **D2 - Experience thesis:** a tier crossing is a **cut with a mask** or a **journey**; the
  council scores the built artifact against whichever is chosen.
- **D3 - Time during travel:** no advance, advance by traversal time, or advance at a stated rate.
- **D4 - Scope order:** tiers first, or the compass first (the compass is what makes a warp to
  empty space usable, but the tiers are what make a compass necessary).
- **D5 - Panning:** ship with the compass or before it (deferred here from Layer 3).

## 8. Chair's opening position (for the seats to attack)

Not a recommendation and not a decision. My opening position is **A**, with `Position` kept as the
single coordinate module so that B's cell lattice can land inside it later if the evidence demands
it. Reasons: the address is already public API and already the only navigation state; A ships
without a second representation; and the focus rebase is a rule Layer 5's nebulae need anyway
(you approach a real nebula from light-years away). I expect the seats to attack exactly the
focus-rebase risk and the compass's anchor problem, and I would rather lose the argument in the
council than in a bug report.

## 9. Cost, stated before it runs

The council is one artifact and one sitting. Implementation is not estimated until D1 and D2 are
answered: A is days, B is weeks, C is between. The **security lens** runs on the rebase work
regardless, because a rebase touches the URL and the precision path.

## 10. What happens next

Owner: answer D0. If the answer is "convene", the seats are asked for round-1 positions against
§5 and §8, and this file gains §8-§14 in the shape of `council-layer-3.md`. If the answer is
"decide directly", D1-D5 are recorded here and the brief is amended; the ticket stays
"proposed, not decided" until the last of them is answered.