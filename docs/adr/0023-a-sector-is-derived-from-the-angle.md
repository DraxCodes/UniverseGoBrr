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
- A **system** was already depth 3 before this decision, so it keeps its depth; what changes is that
  depth 2 now means *a sector* rather than *a star*. The star identity keeps its integer, so the
  honest new address is `v1/4.<sector>.-2.7` — the rung is **inserted**, not appended. See
  `docs/notes/address-ladder-depths.md`.
- `sectorCount` depends on galaxy size, so a small galaxy may have **one** sector — the degenerate
  case ADR-0018 names. Every angle maps to sector 0 and the level is transparent; `sectorIndexForAngle`
  is total for it.
- The angular **phase** (where slice 0 begins) is **derived from `homeAngle`, not drawn**: slice 0 is
  centred on the home star, so `v1/0.0.0` keeps meaning "sector 0, star 0" in every galaxy and the
  local neighbourhood is always sector 0. A free per-galaxy draw would have made Sol's reserved
  address mean a different slice in each galaxy. (This replaces the "sampled per galaxy" option
  first written here; the field still varies, because `homeAngle` does.)
- **A sector link shows the galaxy, face-on** (owner, 2026-11-25). A sector is a wedge, not a star,
  and `generateSystem` is total — so before this, a crafted `?addr=v1/4.0` drew a complete invented
  planetary system for a place that has none. `hasSystemScene` (in `levels.ts`) is the ladder's
  answer, and `main.ts` draws the disc the sector slices with the same camera `commitZoomOut` uses.
  The wedge itself stays undrawn until ticket 06 item 9. The **galaxy** rung (`v1/0`) deliberately
  keeps its system scene: its home star *is* the node, and the four `desktop-*` captures pin that
  boot frame.

## The mechanic that must change for this to hold

**This is load-bearing and easy to miss.** Before the insertion, `placementKey` hashed the **full
address string** (`src/universe/placement.ts`), so `v1/0.3` and `v1/0.3.1` produced different
placement streams. If the re-key had simply rewritten a star's address from `v1/0.3` to
`v1/0.3.1`, **every star would have moved** and the "keeps the drawn galaxy" half of this decision
would be false.

So the insertion must do *both*:

1. build the star's address as `galaxy.sector.starIndex`, where **`starIndex` is the level the old
   address used** (`v1/0.3` → `v1/0.<sector>.3`), keeping the star's identity number; and
2. make `placementKey` key on that **star level** — not the whole address — so the sector level is
   transparent to position.

Point 2 is the actual code change, and it must land **in the same commit** as point 1. Doing only
point 1 silently re-rolls the sky while claiming it did not, which is the failure mode this ADR
exists to prevent.

**Landed 2026-11-25** (`GALAXY_VERSION` 9, `PLACEMENT_VERSION` still 2). `withoutSectorRung` is the
mechanic for both position and appearance; `sector-rung.test.ts` pins the key strings and the
sector-from-angle invariant; the whole population was diffed against the pre-re-key tree (six
galaxy/tier dumps, three systems) with a worst delta of exactly zero.
