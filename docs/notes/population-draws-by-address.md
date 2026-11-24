# The population draws by address, and appearance has its own stream

**Written 2026-11-24**, against `src/universe/galaxy.ts`, `src/universe/placement.ts` and
`src/universe/disc.ts` (commit after the address population landed).
**Demonstrated by:** `npx vitest run src/universe/placement.test.ts` → *"draws exactly what
placement places, for every star in the population"*.

**What changed, and why the old shape could not survive.** `generateGalaxy` used to draw its stars
from two sequential mulberry32 streams (`|local`, `|disc`). The position of the *k*-th star depended
on every draw before it, including the brightness and colour draws between positions, so
`placement(seed, v1/4.k)` could not reproduce the *k*-th drawn star in O(1) — it would have had to
replay the stream up to *k*, which is O(k) per lookup and O(n²) to place the population.

That is no longer the shape. The generator now **walks child addresses** and asks placement for each
one:

- position comes from `placedStarIn(frame, seed, child)` — the same function `placement()` calls;
- brightness and colour come from a **separate** stream keyed on the child's address
  (`appearanceKey` in `galaxy.ts`);
- every `GalaxyStar` carries its `address`.

So the picture and the world agree on the **list**, not only on the law: a drawn light is exactly
the light placement returns for the address it carries. If you need to change one, change the other
with it.

**Why appearance is a second stream, not a continuation of placement's.** Position and appearance
are both content, but they version independently: `PLACEMENT_VERSION` guards "where a star is",
`GALAXY_VERSION` guards "what a star looks like and which stars exist". Folding appearance into the
placement stream would make a tint change re-roll every position and vice versa. The two keys differ
by their `|appearance|` / `|placement|` segment, and both are keyed on the address, so a tier cut
still keeps a prefix: lower tiers take the first N children of each kind, and those children are
byte-identical in the richer tier.

**The counter-intuitive bit worth remembering.** `starKind` (one child in nine is a local-field star)
is a placeholder for per-level kinds (ADR-0008). It must stay a property of the **address**, not of
the iterator, or the generator's idea of "which law places this child" and placement's would drift.
The day a level answers "local field" for itself, `starKind` becomes that answer and nothing else in
this walk changes.

**When this re-rolls.** Switching from a sequential stream to an address walk changes every star, so
it is a real re-roll: bump `GALAXY_VERSION` and re-shoot the capture set. It does **not** bump
`GALAXY_STREAM_VERSION`, because that constant now governs only the frame (centre and arm phase),
and the frame law did not change — keeping it at 3 preserves the arm phase the layer-3 captures were
tuned against, so the arm-acceptance measurement stays comparable. Re-measure arm acceptance anyway:
the exact stars move even when the phase does not. Do **not** attach an `address` field to a
stream-placed star in the meantime — that names a position placement disagrees with, which is worse
than no address at all.