# 0005 — The universe is a pure function of a versioned address

**Status:** accepted (2026-11-23)
**Context:** A No Man's Sky-sized universe cannot be stored, transmitted or loaded. It must
also be shareable as a string, and stable across generator changes so that shared
discoveries do not rot.

## Decision

`content = f(seed, address)` — pure, deterministic, storing nothing. A **coordinate** is
`version/address`, optionally `version/address/epoch`. Node contents are returned as a
record of **named, typed slots** so new content kinds are added as slot fillers.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Pure function, **versioned** address | `f(seed, version/address)`, no storage | Chosen |
| B. Stored world / database | Persist generated content | Rejected — cannot store 10¹¹ stars; breaks the "URL" property |
| C. Pure function, unversioned | `f(seed, address)` only | Rejected — any generator change silently breaks every shared coordinate |

## Why

Zero storage makes "infinite" affordable: the universe is a function, not a dataset. Every
node is evaluable **from its address alone, in any order** — a planet can be visited before
its galaxy has ever been generated. Versioning turns the generator into a **permanent public
API**: an `v1` pin keeps resolving to the `v1` cosmos even when `v3` is current.

Trade-off accepted: the generation function can never change shape without a new version,
and every node pays the price of being derivable without context. That is the discipline
that buys infinite scale and permanent sharing.

Determinism also removes a whole imagined subsystem: there is **nothing to keep static**.
Warp away, look back, and the galaxy regenerates identically from its seed.

## Consequences

- The seed→content function is API. Version it from day one; never mutate a released version.
- Layers above must not depend on generation order.
- Slots must be declared before they are filled; adding a slot to a released version is a
  breaking change, so the slot list is deliberately generous.
- Revisit if a feature genuinely cannot be expressed procedurally (none identified yet).