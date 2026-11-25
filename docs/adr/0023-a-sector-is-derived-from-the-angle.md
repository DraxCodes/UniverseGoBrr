# 0023 — A sector is derived from a star's angle, not chosen before it

**Status:** accepted (2026-11-25, owner)
**Context:** ADR-0018 makes a sector a real address level between the galaxy and the system, and the
ladder in `src/universe/levels.ts` now names it at depth 2. Inserting it re-keys depth 2 and deeper,
and there are two ways to do that:

- **assign a sector first**, then draw the star inside that sector's angular wedge; or
- **draw the star where it already goes**, then compute which sector that angle falls in.

The difference is not cosmetic. The first option re-rolls every star in every galaxy, because the
drawn position would now depend on the sector assignment. The galaxy's arms, its m=2 contrast and
the whole Layer 3 visual pass — the one the `perception` gate scored **8/10** — were calibrated
against specific drawn positions. Re-rolling them replaces a passed artifact with a new, unmeasured
one, and every capture would have to be re-shot and re-scored.

## Decision

**A star's sector is derived from the angle it is already drawn at.**

`sectorIndexForAngle(angleFromGalacticCentre, sectorCount(seed, galaxy), phase)` (in `levels.ts`)
answers which sector a star belongs to, and its address becomes `galaxy.sector.star`. Position is
still keyed on the **star** index, so no star moves and the gated galaxy is preserved.

A sector therefore **owns a wedge of the disc** — every star whose drawn angle falls in that slice —
rather than *generating* the stars inside it. It is a real address level in every way that matters:

- it is linkable (`v1/0.2` names a place);
- it is a travel destination (its position is the wedge's centre, at the disc's mid-radius);
- every star inside it carries it as its parent, so a link to the star and a link to the sector agree.

## What this keeps, and what it costs

**Keeps:** the drawn galaxy is identical before and after the re-key. The Layer 3 captures hold. The
8/10 gate score still describes the picture on `main`.

**Costs:** `GALAXY_VERSION` must bump, because every star's **address** changes from `v1/0.3` to
`v1/0.3.<sector>`, and an address is identity (ADR-0005). Old links break loudly rather than silently
resolving to a different star — which is the correct failure. A sector's star population is not a
contiguous prefix of the child order, so the tier cut has to select by "angle in this wedge" rather
than "first N children"; that selection is a pure filter over the same drawn stars, so it still
cannot redraw one.

## Rejected

**Sector assigned first, star drawn in the wedge.** Literal "a sector owns the generation", and
slightly simpler to reason about, but it throws away a passed visual artifact to buy a modelling
purity with no user-visible benefit. If the generator is ever rebuilt from scratch, this is the
cleaner law; until then it is not worth re-rolling the sky.

## Consequences

- The re-key is **additive in meaning, not in position**: no star moves, every star's address gains
  one level.
- A **system** was already depth 3 before this decision, so an address like `v1/4.-2.7` keeps its
  rung; what changes is that depth 2 now means *a sector* rather than *a star*. See
  `docs/notes/address-ladder-depths.md`.
- `sectorCount` depends on galaxy size, so a small galaxy may have **one** sector — the degenerate
  case ADR-0018 names. Every angle maps to sector 0 and the level is transparent; `sectorIndexForAngle`
  is total for it.
- The angular **phase** (where slice 0 begins) is sampled per galaxy, so sector boundaries are not
  identical across galaxies. It is a frame-level draw like the arm phase, and follows the same rule:
  a `GALAXY_STREAM_VERSION` change, not an address re-key.
