# Council - Layer 4: travel tiers

**Convened:** 2026-11-24, owner's instruction ("convene the council").
**Fixed point:** `014c312` on `wip/layer-3` (pushed to `origin`).
**Status:** recommendation recorded, **decision pending** (owner, §10). No code has been written.
**Seats:** chair `task-orchestrator` (DeepSeek 4.1 Flash), shape `plan-architect` (DeepSeek 4.1 Flash),
experience `quality-gatekeeper` (DeepSeek 4.1 Flash), risk `security-auditor` (GLM 5.3). Two model
lineages, as `doctor` requires. Every seat was read-only and returned text only.

**Brief:** `tickets/05-layer-4-travel.md`. **Constraints:** ADR-0003, ADR-0005, ADR-0008, ADR-0004.

## 1. Question, constraints, non-goals

> **What is a frame at travel time, what may a rebase change, and what must crossing a travel tier
> feel like?**

Constraints that cannot move:

- **ADR-0003:** travel tiers are frame rebases; the effect masks the swap.
- **ADR-0005:** the address is public API. A rebase may rewrite the camera and the URL, but not the
  address unless a tier was genuinely crossed.
- **ADR-0008:** `Position` stays opaque; int64 cells + `cellSize >= frameDiameter / 2^52` were
  deferred to this layer; the precision negative-control capture must keep failing.
- **ADR-0004:** `t` is an input in closed form; travel may move `t`, never simulate forward.
- No new content generation in this layer; the precision floor is a double's ~1.95 mm step at 10¹³ m.

Non-goals: nebulae/volumetrics (Layer 5); surfaces/landing (Layer 6); actors and civilisations
(ADR-0006 needs its own council); mobile; new procedural populations.

## 2. Options brief

This decision touches no stack, library or language: all four options are in-repo TypeScript with no
new dependency, licence or stored data. Supply-chain risk is therefore nil for every option, and the
risk seat said so plainly. The options are shapes, not packages.

| Option | Shape | What it buys | First cost |
| --- | --- | --- | --- |
| **A. Address-origin frames** | origin is the current address node; crossing a tier rebases | one representation, one navigation state, ships in days | a focus mechanism if approach ever needs one |
| **B. Int64 cell lattice** | origin is the cell the camera is in; rebase on a cell-fraction threshold | one rule for arbitrary points, address decoupled | a second representation and a conversion module that can drift |
| **C. Frame stack** | one origin per level; rebase = push/pop | a natural postal address and compass | most state, most places for the chain to disagree |
| **D. Minimal** | no rebase this layer; compass and panning only | cheapest | defers the core loop a second time |

## 3. Proposals (round 1, unedited)

### Shape - `plan-architect`

**Proposal: A — address-origin frames, with the focus rebase declared in the same commit.**

Shape: `src/frame/position.ts` stays the only coordinate owner; a new `src/frame/rebase.ts` exports
exactly two pure functions — `rebaseToAddress(state, address)` and `rebaseToFocus(state, position)`
— each returning `{ camera, address }`, callable with no GPU and no scene. One constant,
`FRAME_MARGIN`, with a test, bounds the local offset. The focus rebase triggers on the offset; the
tier rebase on the address. Two triggers, one module, one type.

Why: the address is already the only navigation state, and `Position` was built to survive this
(ADR-0008, "why deferral is not the usual mistake"). A ships with no second representation, so there
is nothing to drift — B's whole risk is a conversion module that need not exist. The chair's "second
rule" fear is real but it is a *packaging* problem: same file, same return type, one constant. Cheap
to fix now, expensive to retrofit.

Positions on the six rows:
1. **One representation.** B's cell goes inside `position.ts` if evidence ever demands it; not now.
2. **Split the dichotomy.** The rebase is invisible; the *tier crossing* is the visible mask. A focus
   rebase never plays an effect, a tier crossing always does.
3. **Address-driven for tiers**; position-driven only for focus, and that path must not touch `addr`
   (ADR-0005).
4. **Anchors as content**, scoped to the nearest nodes at two adjacent tiers, evaluated by
   `f(seed,address)` so it cannot lie. The trail is a pin, not the compass; a trail-only compass
   "lies" (ticket §Risks).
5. **Tiers and panning first, compass second.** A compass with nothing to point at is decoration;
   panning is the same `target` generalisation and belongs with it.
6. **A now.** Migrating to B later is one module's internals — priced, not rejected.

Cost: two pure functions, one constant, one test each, a probe, a capture pair. Days.

Risk: a body sitting near a frame edge makes the focus threshold and the tier boundary flap.
Mitigation: the focus rebase moves the origin **inward only**, never across a tier.

What would change my mind: if the capture pair cannot be made identical at 1:1 under A without a
per-scene hack, or if the compass genuinely needs two origins live at third-tier distance — then C,
not B.

### Experience - `quality-gatekeeper`

**Proposal: A**, with the focus rebase and the tier rebase as *one* rule in one owner module: origin
is "the node you are focusing", which is the address node unless you approach a body from far away.
One rule, two ways to set it.

Why: the address is already the only navigation state and already public API; A is the only option
that ships the compass HUD from state that exists today. Cost: a second trigger, days not weeks.
Risk: address flapping on a focus boundary — mitigate with a hysteresis band, so the address moves
only on a genuine tier crossing (ADR-0005), and the threshold is a named constant with a test. What
changes my mind: a probe showing free flight inside one A-tier carries the camera past the point
where the double's step exceeds a pixel — then focus rebase is constant, not rare, and B's one rule
wins.

Trade-off rows: **1** one representation (A). **2** both — the *rebase* is invisible by construction;
the *crossing* is a visible journey. If the rebase itself is visible, the capture pair is not
evidence. **3** address-driven. **4** anchors as content, breadcrumb as trail; the lie is showing
your trail *as* anchors, and §3.2 requires both. **5** tiers first, shipping the breadcrumb and the
*current frame's* anchors (already generated, free); cross-frame nearest-anchor search after. **6**
A now — ADR-0008 already puts cells inside `src/frame/`.

**Time:** travel advances `t` by traversal time at a stated per-tier rate (impulse 0, warp hours,
transwarp years). Otherwise arriving is a cut with a coat on. Consequence: the effect must end on a
frame already rebuilt at the new `t` — last effect frame ≡ first static frame.

**Thesis.** Three-second read: a lit orrery in black, one address line, one compass needle pointing
at something, no edge, no seam. First run: land in a seeded system, orbit, click the address up a
level, warp to a neighbour — the streaks end with the destination star already there, growing
exactly where the streak ended. Good moment: the address changes once, silently, mid-effect, and
nothing else does. Friction to avoid: the URL and address line rewriting every frame, and the needle
swinging as your own trail reorders.

**8/10 later:** 1:1-identical capture pairs at 1920/2560/3840/DPR2 straddling every tier; a
before/after probe printing address, camera in metres, offset from origin, float32 step and `t`; a
mid-travel URL reload landing identically; last-effect-frame ≡ first-static-frame; negative control
still failing.

### Risk - `security-auditor`

**Proposal: Option A, with two hard riders** (hysteresis constant; history discipline). All four
options are in-repo TypeScript with **no new dependencies, licences, or data beyond the URL** —
supply-chain risk is nil for every option; the threat model is purely self-inflicted: crafted links,
perf, and history.

**Why:** the URL is the attack surface, and A keeps it one-representation: one `addr`, one `cam`. C
multiplies URL state (per-level offsets) or breaks the round-trip; B adds a conversion module that
can drift with a hostile `cam`; D leaves ADR-0008's deferral unspent and defers the core loop a
second time. ADR-0008's own text — internals of one module, no caller touched — is what makes B
retrofittable inside `Position` later, so A-now/B-later is designed-for, not debt.

**Top failure mode: address flapping rewriting history.** In A the address is the rebase trigger; a
camera hovering on a tier/focus boundary oscillates addresses, rewrites the URL per frame, and
poisons Back. Riders: (1) a named dead-band constant with a test; (2) `replaceState` for
rebase-driven rewrites, `pushState` only on genuine tier crossings (MDN/Dynatrace guidance, checked
2026-11-24).

**Red-team list:**
- Crafted `cam=1e30` (legal under `MAX_POSITION_M`) in a 10¹³ m frame → precision garbage must
  surface in `issues` via the HUD-authority rule, never silent NaN.
- Unbounded `addr` depth → cap at parse; a 10⁴-level link is a self-DoS on generation.
- Mid-travel link must resolve to a *defined* state (journey encoded, or clamped to arrival) — if
  travel advances `t`, an ambiguous link reproduces an unshareable arrival.
- Interrupted warp: define it or clamp to an endpoint; "half-swapped frame" must not be a legal state.
- Floating-origin literature (Babylon/Godot, checked 2026-11-24): every cached consumer must hear
  the rebase or smoke trails snap — enumerate them in the owner module.

**Trade-off rows:** (1) one representation — B's conversion is the drift surface. (2) Invisible swap
— settled by ADR-0003; the mask is the visibility. (3) Address-driven, focus rebase in the same rule
family with its own dead band. (4) Anchors as content or defer; a trail is a trusted lie — if it
ships, label it "trail". (5) Tiers first; an honest compass needs frames to exist. (6) A now, B
behind the module later.

**Cost:** days. **Risk:** concentrated in the focus rebase — contained by the capture pair, probe and
round-trip evidence. **What changes my mind:** a probe showing approach exceeds the precision floor
inside one frame, or the compass demonstrably needing intermediate levels held simultaneously.

## 4. Critiques (round 2, unedited)

### Shape critiques

**Experience seat.** Strongest objection: "the origin is the node you are focusing" makes the origin
*not* a function of the address. Condition: a link captured mid-approach carries `addr=<system>` but
an origin at the planet; reload has nothing to rebuild that origin from, and the camera lands off by
the planet's orbital offset — the round-trip fails unless focus is itself serialised, which is new
URL state the seat didn't price. Fixable, but only by keeping the origin address-derived and letting
focus rewrite the `cam` offset alone. Concede: the hysteresis band and its named constant — my
inward-only clamp is one-sided hysteresis, underspecified; adopt theirs.

**Risk seat.** Objection: "`replaceState` for rebase-driven rewrites" presumes a rebase writes the
URL at all. Under A a focus rebase must never touch `addr` (ADR-0005), so the rule is stronger: a
rebase never writes history; only a tier crossing pushes. Their `1e30` and depth-cap points are
correct and orthogonal to the frame choice. Concede: enumerate cached consumers in the owner module —
that is what makes "invisible" provable, and my plan omitted it.

**Boundary — this changes my design.** `rebaseToFocus(state, position)` cannot resolve that position
itself: `f(seed,address)` lives in `universe/`, so a lookup inside `src/frame/` inverts the
dependency and drags generation into the frame layer. Signature becomes `rebaseToFocus(camera,
focus: Position, address)` — the caller resolves, the frame layer stays content-agnostic. One
argument, one rule, no lookup.

### Experience critiques

**I was wrong about the rubric** — it is vendored at
`.opencode/skills/hillclimb/references/rubrics/perception.md`; §196-232 fixes the shape. Conceded.

**Objection to Shape:** `rebaseToFocus` moving the origin *inward* without touching `addr` makes the
URL under-specify the frame — same link, different float32 step, different pixels. That is fatal to
A as written, and it lands on me too. The focus must live in `cam`, not silently in the frame. Fix:
`cam` gains a focus key. "Inward only, never across a tier" can still land outside `FRAME_MARGIN`
for a body near an edge; your test asserts margin, not address stability.

**Objection to Risk:** `pushState` on tier crossings collides with t-advance. Back from arrival
restores departure — at *departure* `t`, which is no longer the state you left. Either Back re-runs
the warp (replay risk) or it is a pinned restore. Fixable, but the history contract must say which.

**The `t` attack, tightening the thesis:** `t`-advance makes `t` a per-traveller value only if the
rate is in code; otherwise the same link arrives at different epochs. Rule: mid-travel links are
legal and pin the *arrival* `t`; the effect duration is a constant per tier, so the arrival state is
a pure function of the link. The pinned-`t` HUD shows the arrival epoch during the effect, not a
ticking value.

**Last-effect ≡ first-static:** unachievable without rebuilding mid-effect. The seam is: rebase
first, then the effect composites a fading departure snapshot over the *live destination at arrival
`t`*. Last effect frame is a live frame by construction.

**8/10 evidence, rubric shape:** Seed — one throwaway `capture/seed/travel.ts` plus hook, exercising
a system, a sector edge, an empty point. Shots — `travel-<tier>-pre|post` at 1920/2560/3840/DPR2,
identical at 1:1. Blindspot — `findings.glm.json`, `merged.json`, adjudicated. Read-through —
first-run and keyboard notes, each side of a tier. Floor — `npm run build`, `npm test`, exact
output. Probes: three-second (primary action *warp*, current state obvious); first-run (warp to a
clicked neighbour, no questions); state sweep (mid-travel, interrupted, failed, void, root);
dead-end (every address line, needle responds); copy (address reads as a coordinate; no jargon
during travel).

### Risk critiques

**Shape seat.** Strongest objection: `rebaseToFocus` breaks the claim it is named for. If the focus
rebase may not touch `addr`, the origin is no longer the address node — state now records "which
node is the origin", and that field **is** B's second representation, smuggled in. Worse, it must
serialize: a mid-travel link taken after a focus rebase has to reproduce it, so either the URL grows
a focus param (new attack surface, new flapping target) or the focus is a pure function of
`(addr, cam)` — deterministic, but then it *is* position-derived and hysteresis-bearing. **Fatal to
"no second representation"; fixable if focus is derived, never stored.** Concede: pure, GPU-free,
same-return-type functions are exactly the testable shape.

**Experience seat.** Strongest objection: advancing `t` by traversal time forces the *journey* into
the URL or the round-trip test fails: a mid-travel link must land at the same arrival `t`, which
needs `(fromAddr, toAddr, phase)` with `t` **derived** — never a stored `jour` param a crafted link
can mismatch. Their own hysteresis concession is muddled: if the address moves only on genuine
crossings, the dead band gates the origin, not the address — say so. **Fatal if journey state is
stored in the URL; fixable if derived.** Concede: last-effect ≡ first-static is a strong, checkable
invariant, and anchors-as-content with the trail as a pin is the honest split.

**Ask 1:** It sharpens it: 1e30 is *accepted*, so today it silently renders "everything at the
camera" — a wrong image, not a reported issue. The requirement extends to accepted-but-degenerate
values: report in `issues`, negative control keeps failing.

**Ask 2:** Not sufficient. Tier bounce (warp, look back, warp) pushes per crossing. Test rule: **push
only on user-initiated arrival; consecutive same-`addr` pushes collapse to replace.** Scripted
boundary oscillation with no input → history length constant.

**Ask 3:** `rebaseToFocus`: input position must be derived; `t`-advance: derive, don't store. Both
fatal-if-stored, fixable-if-derived.

**Tightened failures:** focus serialization; tier-bounce history spam; accepted degenerate `cam`;
mid-travel `t` divergence; body-at-frame-edge flap.

## 5. Experience thesis

At eight out of ten, travel reads as **one continuous place**, not a sequence of screens.

The three-second read: a lit orrery or a galaxy in black, one address line, one needle — you can say
where you are and what the obvious next action is (*warp to the thing the needle points at*) without
reading anything twice. The first run: land in a seeded system, orbit it, click the address up one
level, warp to a neighbour; the streaks end with the destination already there, growing exactly
where the streak ended, and the clock has moved by the tier's stated duration. The moment that
should feel good: **the address line changes once, mid-effect, and nothing else does** — the seam
between frames is the one thing the eye never catches. The friction to avoid: the URL and the address
line rewriting every frame; the needle swinging because your own breadcrumb reordered; a warp that
lands on a static frame that does not match the last frame of the effect.

Copy voice: the address reads as a coordinate, not as a sentence. No "you are now entering"; the
`v1/…` string and the scene row carry the state.

**This thesis is a proposal.** It enters spec §7 row 4 only when the owner answers §10 D2, and the
`perception` gate then scores the built artifact against it plus the rubric.

## 6. Value trade-off register

| Trade | What it buys | What it costs | Who feels it | Reversible? | Position | Strongest counter-argument |
| --- | --- | --- | --- | --- | --- | --- |
| One representation (A) vs a lattice (B) | nothing to drift; days not weeks | any future focus rule must land inside one module | the next implementer | yes, inside `Position` | **A** | B's one rule covers arbitrary points; A needs a second rule the day approach breaks the floor |
| Invisible rebase vs visible swap | the universe feels continuous | correctness is invisible; proof is a capture pair, not a demo | the reviewer | n/a (design) | **invisible, always**; only the tier crossing is visible | an invisible invariant regresses quietly; a debug overlay is mandatory |
| Address-driven vs position-driven | no address flapping; one navigation state | a body near a frame edge may force a focus rule | the traveller, via the URL | yes, with a derived focus | **address-driven; focus derived, never stored** | if approach exceeds the floor, address-driven alone cannot fix it without a stored origin |
| Anchors as content vs as trail | a compass that cannot lie | a nearest-node search and candidate evaluation | the lost traveller | yes (add later) | **anchors as content; the trail is a labelled pin** | the search is real work for a feature that may ship before it matters; trail-only ships first |
| Tiers first vs compass first | tiers make the compass necessary | warping to empty space stays disorienting until it lands | the first-run user | yes (order) | **tiers + panning first, compass in the same layer as its second commit** | §3.2 says a warp to empty space *requires* the compass; tiers alone ship a disorienting feature |
| A now / B later vs B now | evidence before commitment | if the probe fails, the focus work is designed twice | the schedule | yes | **A now, gated on the approach probe** | "migrate later" is the sentence before every rewrite; if the probe is cheap, run it first |

## 7. Options table

| Option | Shape | Cost | Risk | Reversibility | What it buys |
| --- | --- | --- | --- | --- | --- |
| **A (recommended)** | origin = address node; rebase on tier crossing only, v1 | days | the approach case, unbounded until probed | internals only; B can land later | one representation, one state, the core loop |
| B | int64 cell + threshold rebase | weeks | a conversion module that drifts | medium | one rule for arbitrary points |
| C | origin stack per level | between | chain disagreement | medium | a natural compass/address HUD |
| D | no rebase, compass only | hours | defers the core loop again | trivial | nothing structural |

## 8. Recommendation

**Build A: address-origin frames, rebasing on tier crossings only, and drop the focus rebase from
v1.** Run the approach probe *before* the first line of the rebase module; it is what decides whether
a focus rule is ever needed.

The synthesis is the chair's, and it exists because all three seats put the same load on one weak
point. Each seat assumed a focus rebase (origin moves inward to a body you approach) and each then
had to defend it:

- the **shape** seat had to change its signature so the frame layer does not gain a content lookup;
- the **experience** seat had to put the focus into `cam`, or the link under-specifies the frame;
- the **risk** seat had to choose between a stored focus (a second representation, smuggled in) and a
  derived one (deterministic, and hysteresis-bearing).

Remove the focus rebase and all three objections vanish at once. And it may not be needed: every
scene already normalises to its own scale and subtracts in double before rounding, which is why the
Layer 2 closeups render a planet at ~9 body radii with the origin at the star. The rebase exists for
**cross-frame continuity**, not for approach.

So the probe comes first. It is one measurement against the existing closeup cameras: walk the
camera from the system origin to a body and record the float32 step in the units the GPU actually
receives. If the step stays under a pixel all the way in, v1 is address-only and the focus question
is closed with evidence. If it does not, the focus rule is designed **before** `rebase.ts`, as a pure
function of `(addr, cam)` — never a stored origin, never a URL field of its own.

**Dissent, recorded:**

- **Experience** wants the focus rebase in v1 and the crossing to be a journey that advances `t`.
- **Shape** wants the focus rebase declared in the same commit, because retrofitting a second trigger
  into a shipped module is more expensive than writing it now.
- **Risk** accepts either, but insists the focus is derived, never stored, and that every cached
  consumer is enumerated in the owner module.

**Rejected options, named:** B (weeks, and its conversion module is the drift surface A exists to
avoid); C (most state, and the compass does not yet need intermediate levels simultaneously); D (it
defers the core loop a second time and leaves the compass pointing at nothing).

**What would change this recommendation:** a probe showing approach exceeds the precision floor
inside one frame (then a derived focus rule ships with v1); or a capture pair that cannot be made
identical at 1:1 under A without a per-scene hack (then C, not B).

## 9. Thread-split proposal

Four lanes, non-overlapping write scopes. The probe lands before lane 1.

| Lane | Writes | Depends on |
| --- | --- | --- |
| **P. Approach probe** | `.scratch/` only (throwaway `.ts` + `vite-node`) | nothing |
| **1. Rebase** | `src/frame/rebase.ts` (new), `src/frame/rebase.test.ts` (new) | P |
| **2. Travel state + URL history** | `src/state/url-state.ts`, `src/main.ts` | 1 |
| **3. Compass + address HUD** | `src/ui/hud.ts`, `src/ui/compass.ts` (new) | 2 (needs derived `t` and the history rule) |
| **4. Tier masks** | `src/gpu/scene.wgsl`, `src/gpu/renderer.ts` | 1 (composites over the live destination) |

Lane 2's history rule, as critiqued: `replaceState` on rebase, `pushState` only on user-initiated
arrival, consecutive same-`addr` pushes collapse to a replace, and a scripted boundary oscillation
must leave history length constant.

Lane 2's time rule, as critiqued: a mid-travel link is legal and pins the **arrival** `t`; the
journey is derived from `(addr, cam, t)`, never a stored `jour` parameter; the effect duration is a
constant per tier.

Lane 3's compass, as critiqued: anchors are content (`f(seed, address)` at adjacent tiers), the
breadcrumb is a pin labelled as a trail, and the needle is checked arithmetic, not an animation.

## 10. Decision (owner)

Nothing below is decided. Each line is the owner's to answer; the chair's recommendation is in §8.

| # | Question | Chair recommends | Your answer |
| --- | --- | --- | --- |
| **D0** | Convene or decide directly? | convened; this record is the input | _pending_ |
| **D1** | Rebase strategy | **A**, tier-only; focus gated on the probe | _pending_ |
| **D2** | Cut with a mask, or a journey? | a journey that advances `t` at a stated per-tier rate, with arrival `t` derived | _pending_ |
| **D3** | Does travel advance `t`? | yes, by traversal time; impulse 0, warp hours, transwarp years | _pending_ |
| **D4** | Tiers first, or compass first? | tiers + panning first; compass in the same layer, second commit | _pending_ |
| **D5** | Panning scope | with the tier work; it is the same `target` generalisation | _pending_ |

When D1-D3 are answered, the thesis in §5 and the answer are written into spec §7 row 4, and
`tickets/05-layer-4-travel.md` stops being "proposed". Until then, no code is written from this
file and `status.md` records Layer 4 as blocked on the owner.