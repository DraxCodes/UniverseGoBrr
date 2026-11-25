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

**A sector is an angular slice of the disc**, and a galaxy has **between 1 and 6** of them, derived
from its generated size rather than chosen per link: a very small galaxy gets 1 (there is nothing
meaningful to split), a Milky-Way-sized one gets 4, and larger ones 5 or 6. Six is the ceiling, so the
rung never needs more than one digit.

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
- **The sector count is content, not a setting.** It is `f(seed, address)` like everything else, and
  it must be **stable for a given galaxy**: if a generator change altered how many sectors a galaxy
  has, every link into it would re-key. That makes it a `GALAXY_VERSION` event, not a free tweak.
- **A one-sector galaxy is the degenerate case, and it must work.** The slice law has to be total at
  `n = 1` — the sector *is* the disc — or small galaxies will be the thing that crashes the level
  model.
- **A sector spans the whole disc radially**, so the longest intra-galactic trip is roughly the
  diameter, not a fraction of it. That is what the travel anchors are measured against.
- **Nothing here decides the angular offset.** Where slice zero begins is part of the size law, not
  of the rung, and it has to be deterministic or the same sector would have two names.