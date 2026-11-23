# 0006 — Actors are a separate, tiered, swappable layer

**Status:** proposed (2026-11-23) — **requires a council before implementation**
**Context:** Ships making course corrections, taking storm damage, and civilisations growing
and expanding are wanted and genuinely exciting. They are also the only thing in the design
that needs *history*, which the pure universe (ADR-0005) and closed-form time (ADR-0004)
deliberately forbid. Leaking emergence into the universe layer would make everything
expensive.

## Decision

Actors (ships, civilisations, growth) live in **their own layer behind an interface**
(`stateAt(t)`, `advanceTo(t)`), never inside the universe generator. Implement **Tier 1**
first; leave Tier 2 open behind the same interface.

- **Tier 1 — event fold.** `state = f(route, eventsAlongRouteBefore(t))`: a scan over a
  finite, sparse event list, with causal depth capped (~8 hops). Looks emergent; stays
  deterministic, shareable and scrubbable; costs O(events).
- **Tier 2 — deterministic simulation.** Fixed timestep, seeded PRNG, replay from periodic
  checkpoints. Genuine feedback loops. **Runs on the CPU only.**

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Pure only, no reactions | No actors; nothing reacts | Rejected — gives up the most exciting extension for no gain |
| B. Event fold (Tier 1) | Closed-form reactions over sparse events | Chosen as the first implementation |
| C. Deterministic simulation (Tier 2) | Stateful, replayable, checkpointed | Open — same interface; needs a cost decision |
| D. Server-authoritative world | Shared mutable universe | Rejected — breaks URL distribution and no-account sharing |

## Why

Tier 1 gets most of the *apparent* emergence for almost nothing, and keeps every property
the rest of the design depends on: determinism, shareable `address/epoch` coordinates, and
time travel. Tier 2 is a real escalation in cost and must be a deliberate choice, not a
drift.

**Cross-vendor rule:** rendering may differ between AMD, NVIDIA and Intel; simulation may
not. GPU transcendental functions (`sin`, `pow`, `exp`) are not bit-identical across
vendors, so a GPU-side simulation would silently diverge and make shared coordinates depend
on the viewer's hardware. Therefore any simulation runs on the CPU.

## Consequences

- Emergence cannot contaminate the universe layer; the interface is the fence.
- Tier 1's causal-depth cap means some pathological chains are truncated — accepted.
- Tier 2 can be adopted later without touching generation, transport or coordinates.
- A council is required before implementation because this is the most expensive decision
  in the project to reverse.