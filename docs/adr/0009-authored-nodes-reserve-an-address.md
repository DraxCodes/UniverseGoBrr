# 0009 — Authored nodes reserve an address and ignore the seed

**Status:** accepted (2026-11-24)
**Context:** Spec §3.6 wants a small registry of hand-authored nodes (a correct Sol, later real
nebulae) checked before the procedural generator. ADR-0005 makes `f(seed, address)` public API:
an address that resolves to a procedurally generated system today is a shared link somebody may
have kept. Writing Sol over one of those addresses would silently rewrite that link's system.

## Decision

An authored node **reserves its own address** and is looked up **before** the generator:

- the registry is data (one frozen array), keyed by the canonical `formatAddress` string;
- a reserved address must not be one that already resolves procedurally — it is a new coordinate,
  not a replacement;
- an authored node **ignores the seed**; a shared link to it means the same system for everyone;
- each node carries its own version (`SOL_VERSION`), so editing authored data never bumps
  `SYSTEM_VERSION` and never breaks a procedural link;
- one function, `resolveSystem(seed, address)`, owns the precedence.

Sol reserves **`v1/0.0.0`**: three levels, a system like every other link, and distinct from the
shipped defaults (`v1/0` in the capture manifest, `v1/4.-2.7` for the scored system).

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Reserved address + registry, checked first | New coordinate, data not code | Chosen |
| B. Overwrite an existing procedural address | Same link, different system | Rejected — rewrites a shared coordinate (ADR-0005) |
| C. Authored node that still varies with the seed | `f(seed, "sol")` | Rejected — "Sol" would be a different solar system per user |
| D. A special case inside the generator | `if (address === SOL)` | Rejected — §3.6 says registry data, not a code path; it also makes the generator impure in shape |

## Why

The universe's only durable identity is the address (ADR-0008 makes it opaque). Reserving a new
one is the only move that adds a node **without** changing what any existing link means. Ignoring
the seed is the second half: an anchor you can compare against reality is only useful if it is the
*same* anchor for the person you send it to.

Keeping the version separate is the same lesson as `GALAXY_VERSION` vs `GALAXY_STREAM_VERSION`:
a fix to one authored system must not invalidate every procedural coordinate.

## Consequences

- Reserved addresses are content: moving Sol's is a breaking change to links that point at it.
- `v1/0.0.0` is a coordinate a traveller can reach by ordinary navigation; landing on it shows the
  authored system. That is the feature, not a leak.
- The registry stays small. An entry that grows logic is a sign it belongs in the generator.
- The address HUD (moved to Layer 4) should mark authored nodes, so a reserved address does not
  masquerade as procedural content.
- Real galactic coordinates for Sol are a separate question: the galaxy is procedural, so the
  address stays opaque identity until a layer defines a mapping.