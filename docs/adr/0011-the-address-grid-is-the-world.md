# 0011 — The address grid is the world; the picture is a view of it

**Status:** accepted (2026-11-24, owner)
**Context:** The owner asked the question that Layer 4 had been avoiding: *can I fly to any
star I can see, and is every star we generate one I can visit?*

The answer at the time was no, and the reason was structural. Two universes existed side by
side:

- `generateSystem(seed, address)` (ADR-0005) gives **every** address a complete star system. The
  address space is unbounded — up to 64 levels, integers capped at 2³¹ — so there are infinitely
  many visitable places, and the app draws the one you are standing at.
- `generateGalaxy(seed, address, tier)` draws **45,000 lights** with positions, brightness and
  colour. None of them has an address, and the address grid has no positions.

Nothing connected them, so "that star, there" was not expressible. Three faults followed, all
measured in the code rather than suspected:

1. The galaxy was keyed on the **full address**, so every address was the centre of a private
   galaxy. Warp one star over and the arms were redrawn — the same place, twice, two skies.
2. The star count is per quality tier (45,000 / 22,500 / 13,600) and a frame-time watchdog drops
   tiers automatically. Stars are a stable prefix, so nothing moves when the tier falls, but a
   star past the cut stops existing. A world should lose detail, not residents.
3. Zooming in does not reveal more stars; all 45,000 are drawn at every zoom. Near the home star
   that is fine (5,000 inside 100 ly); in the disc, 40,000 spread over 50,000 ly means most of the
   view has nothing to click.

## Decision

**The address grid is the world. The picture is a view of the cells that are occupied.**

- **A place is an address**, and `f(seed, address)` decides what is there — a star, a system, a
  nebula, later a body. This is already true; the decision makes it the *only* truth.
- **A drawn light is a rendered address**, not an independent object. Every light the user can
  see is somewhere they can go, and going there and coming back shows the same thing.
- **Placement is `placement(seed, address)` → a position**, never the inverse. Asking "given this
  star, what is its address?" would make the picture authoritative, and then quality drops and
  nebula extents would have to be reconciled against a list that changes size.
- **Occupancy is one rule, shared.** The renderer and the resolver must answer "is this cell
  occupied?" with the same function, or the picture and the world drift — a light with nothing
  behind it, or an inhabited cell that draws nothing.
- **A tier change loses detail, not inhabitants.** Which cells exist is a property of the seed;
  how many are *drawn* is a property of the budget.
- **A galaxy is identified by its own level** (the immediate consequence, shipped with this
  record): `galaxyAddressOf(address)` and `GALAXY_DEPTH = 1` in `src/universe/galaxy.ts`, applied
  inside the generator so no call site can reintroduce the private-galaxy bug.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| **A. The picture is the world** | The 45,000 lights are the population; each gets an address | Rejected — the universe becomes finite, contradicting the unbounded address (ADR-0008); nebulae and regions do not fit a point list; a quality drop deletes places |
| **B. The world is the picture** | The grid is the universe; the picture shows occupied cells | **Chosen** |
| C. Keep both and reconcile later | System generator and star list stay independent | Rejected — this is the state that produced three faults, and every later layer would pay for it |
| D. Pre-generate every star | A real galaxy is ~10¹¹ stars | Rejected on cost alone, and unnecessary: emptiness is real in the spec's own thesis |

## Why

The owner's requirement is a *stability* property, not a count: anything you can see, you can
reach, and it is the same thing when you arrive. Option A can be made stable only by freezing the
population, which then cannot be a galaxy. Option B makes stability a consequence of the address
being the identity — the same mechanism ADR-0005 already relies on for shared links.

It is also the only option that scales to the next two layers. A nebula is a **region**, not a
point: the address names where it sits and the object carries a radius, so arriving means stopping
outside it. Other galaxies are simply deeper addresses. Neither needs a new mechanism, which is
the test this decision has to pass.

## Consequences

- **Placement is the next function**, and its signature is settled by this record:
  `placement(seed, address) → position in the parent frame`. Its inputs are the seed and the
  address only.
- **Placement is built** (`src/universe/placement.ts`), and the disc law it needs moved into
  `src/universe/disc.ts` so the generator and placement call **one** function rather than two
  drifting copies. The extraction was proved bit-identical before and after. It has no renderer
  consumer yet: the picture still draws its own stream sample, so placement and the population
  agree on the *law*, not on the *list*, and a drawn light does not carry an address. Closing that
  is a re-roll of the population (and a capture re-shoot), recorded in
  `docs/notes/placement-uses-a-second-stream.md` rather than pretended to be a refactor.
- **Real galactic coordinates for Sol** stop being "a separate question" (cf. ADR-0009): Sol is in
  galaxy `v1/0`, and placement is what will eventually let it sit at its real 26,000 ly. Until
  then the address stays opaque identity on purpose.
- **`GALAXY_DEPTH = 1` is a placeholder**, not a law. ADR-0008 keeps a level's *kind* out of the
  string, so "walk up until a level answers *galaxy*" is the real rule; it needs the per-depth
  kinds the address HUD will introduce. Because callers ask `galaxyAddressOf`, not the depth, that
  change stays internal.
- **`GALAXY_VERSION` 4 → 5.** Every link deeper than one level — including Sol at `v1/0.0.0` —
  now shows the galaxy it lives in rather than a private one. `v1/0` is unchanged, because it was
  already naming its galaxy.
- **The frame origin is still the galaxy's home star for every address in it.** Placement is what
  gives a visiting star its own place in the disc; until it exists, the picture is correctly *one
  galaxy*, from the home star's viewpoint, rather than a different galaxy from each.
- **The 45,000 count is a rendering budget, never a census.** The generator already says "a sample
  of a uniform density, not a census"; this record turns that comment into the architecture.
- **The capture set had to be re-shot: 14 of the 20 shots** draw a galaxy at an address more than one
  level deep, so their backdrop legitimately changed roll. The other six are unchanged on purpose —
  four boot-orrery shots at `v1/0` (whose key was already `v1/0`) and the two precision probes,
  which draw no galaxy at all. Recorded rather than quietly refreshed.