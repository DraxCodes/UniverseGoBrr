# 0004 — Time is an input, evaluated in closed form

**Status:** accepted (2026-11-23)
**Context:** Things must move, orbit, explode and drift while the viewer is away. They must
also be findable and shareable, and revisiting a week later must show a week of change.
The naive answer — a simulation advanced over time — needs persistence, a server, or a long
catch-up loop.

## Decision

State is a **closed-form function of time**: `state = f(entity, t)`, **evaluated at `t`**,
never simulated forward to reach `t`.

- **Motion** evaluates `t` continuously, per frame, uncached.
- **Structural events** (phases, discrete transitions) quantise to a **tick** (e.g. hourly)
  so views cache and shared links match exactly.
- A **scrubber** is the time control. *Visit now* and *visit as found* are two positions on
  it, not two features.
- Dust is modelled as **changing illumination and filament structure** over long timescales,
  not as a translating object — at nebula scale a week of drift is sub-pixel.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Closed-form `f(t)` | Evaluate directly at any `t` | Chosen |
| B. Simulate forward from an epoch | Fixed steps, accumulated state | Rejected as the *base* — cost grows with elapsed time, needs persistence |
| C. Freeze time / static universe | Nothing changes | Rejected — the "alive" half of the thesis |

## Why

A year of elapsed time costs exactly what a second costs. No save file, no server, no
growing state, and two viewers at the same instant see the identical thing. Time travel and
scrubbing fall out for free, and `t` is required for orbits regardless — so this is a
*unification*, not an added feature.

Trade-off accepted: **no emergent history at this tier.** Nothing can react to anything,
because state is a pure function of time. Reactions are deferred to the actors layer
(ADR-0006), which is the only place emergence is allowed.

## Consequences

- Supernova bright phases (days–weeks) and remnant expansion (millennia) are both usable,
  via the scrubber rather than at 1×.
- Pinned `t` becomes a first-class dev tool: shader work is compared at a fixed moment.
- Any genuinely stateful behaviour must live in the actors layer; keep it out of here.
- Revisit if emergent history becomes a core requirement rather than an extension.