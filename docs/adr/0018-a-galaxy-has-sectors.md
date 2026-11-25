# 0018 — A galaxy has sectors, and a sector is an address level

**Status:** accepted (2026-11-25, owner)
**Context:** the address ladder in spec §3.2 was `universe → quadrant → sector (~20 ly) → system →
body` — it had no *galaxy* rung, while the code keyed a galaxy at `GALAXY_DEPTH = 1` and treated that
as the whole hierarchy. So the model carried a rung the code never built (quadrant) and the code
carried a rung the model never named (galaxy). The owner's model is concrete: a universe is made of
galaxies, a galaxy is divided into sectors, and a sector is a place worth *sending someone a link to*.

The fork was whether that division gets an address level of its own or is a grouping computed from
where a star sits inside the disc.

## Decision

**A sector is its own address level, between the galaxy and the system.**

The ladder is **universe → galaxy → sector → system → body**. *Quadrant* is a synonym in copy, not a
separate rung. A sector is addressable and linkable, exactly like a galaxy or a star.

## Options considered

| Option | Effect | Verdict |
| --- | --- | --- |
| **Own address level** | A sector has an address, so it can be linked, named in the HUD and flown to as a destination | **Chosen** |
| Derived grouping — partition the disc by angle and radius, consuming no level | No address break, ships sooner; but a sector is never a place, only a label on a star | Rejected — "send me the link to that sector" is the feature the owner wants |

## Consequences

- **Every address re-keys.** `v1/4.3` is the third child of galaxy 4 today; after this it is sector 3
  of galaxy 4, and everything that was a child of the galaxy moves one level deeper. All 20 captures,
  every Layer 3 and Layer 4 gate reference, and every existing link name the old keying.
  **Accepted by the owner on 2026-11-25**: nothing has shipped and no public link exists, so the break
  is free now and expensive the moment one does.
- **Sol's reservation moves.** ADR-0009 reserves `v1/0.0.0` for the authored node; it moves one level
  deeper. The authored-node rule itself is unchanged, and the registry entry moves with the address.
- **`GALAXY_DEPTH = 1` stops being the last word.** A `SECTOR_DEPTH` joins it, and travel-method
  selection becomes the hierarchy rule. The proxy `travel.ts` uses today — local field versus disc,
  because a level could not say what it was (ADR-0008) — is retired when this lands.
- **The unbounded property is unaffected.** ADR-0008's address stays unbounded and depth-free; this
  names one more rung, it does not impose a fixed depth.
- **Nothing here decides a sector's shape or count.** The sector is a rung, not a geometry. How many
  a galaxy has, and whether one is a wedge or a box, is the level model's work (ticket 06).