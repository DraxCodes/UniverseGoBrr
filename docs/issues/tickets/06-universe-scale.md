# 06 — Universe scale: galaxies, sectors, and the travel ladder

**Status:** proposed, 2026-11-25. The owner's intent is recorded here so it cannot drift again.
Three decisions are committed: ADR-0018 (sectors are an address level), ADR-0019 (method is a choice,
a wormhole costs fixed time) and the roadmap row. Open questions are marked **OPEN**.

## Why this ticket exists

The universe step was never owned. Spec §3.2's vocabulary had no *galaxy* rung
(`universe → quadrant → sector → system → body`), while the code invented `GALAXY_DEPTH = 1` as a
convention. Galaxy-to-galaxy travel appeared only as a refusal reason (`"no root layout"`) in
`src/universe/travel.ts`, ADR-0010, ADR-0012 and ticket 05 — never as a deliverable. A refused
feature that reports a clean reason reads as a boundary, so nobody wrote the ticket.

This file is that ticket.

## The owner's intent (2026-11-25)

1. **The universe is effectively infinite**, in extent and in galaxy count. Only a couple thousand
   galaxies are ever rendered; the rest exist as addressable space.
2. **Galaxies are varied** — arm count, shape, density, size, colour, nucleus — not one law with a
   different seed. Variety is what makes a field of them read as a universe.
3. **`celestial-lab` is a reference studio only.** `C:\Users\joelp\code\celestial-lab` generates
   example galaxies, stars and planets with images and JSON. It is **not** an interface, a data
   source, or a schema for Cairn to import. It exists to show what the generator *could* look like;
   Cairn's own generator stays procedural from the address.
4. **A galaxy is divided into sectors (quadrants).** Quadrant A to Quadrant B is a real, nameable
   place inside one galaxy.
5. **Travel method is the user's choice, not a rule.** Warp can make any trip; a faster method is the
   better option, not the required one. Time is always `Δt = d / v(method)`, with one exception:
   **a wormhole costs a fixed amount of time** (the mouth traversal), then arrives instantly.
6. **You can see the galaxy from orbit**, as in a real sky, and hovering it shows a generated name
   ("Galaxy X"). Names are presentation: deterministic from the seed and address, never in the link
   (ADR-0008).
7. **Free camera travel is not a jump.** With no method selected, `t` advances normally as real time
   passes (ADR-0010: camera gestures never advance the clock).
8. **Long term:** the camera drifts and scrolling carries you deeper into the universe, with
   generation streaming ahead — travel by looking, not by selecting.
9. **Idea, not settled:** user-controlled time acceleration (2×, 10×, 20×). Recorded, not decided.

## The ladder, and how methods map onto it

The methods line up with the rungs, which is why choice works cleanly:

| Method | Natural rung | Effect | Time |
| --- | --- | --- | --- |
| impulse / free flight | inside one frame | none | real time; `t` follows the clock |
| **warp** | system → system | star streaks | `Δt = d / v` |
| **transwarp** | sector → sector, inside a galaxy | tunnel / slipstream | `Δt = d / v` |
| **hyperspace** | galaxy → galaxy | aperture / hyperspace tunnel | `Δt = d / v` |
| **wormhole** | any → any | a mouth, then arrival | **fixed `Δt`**, then instant |

Because method is a choice, a coarser method may be used for a longer trip — it is simply slow. That
is the whole trade-off the UI should show: the same destination, priced in each method.

**Resolved — naming.** The ladder above is ADR-0019: `subspace` is retired as a method name in
favour of **hyperspace**, and "tier" (the rung crossed) is now separate from "method" (what you ride).

**OPEN — absolute speeds, and a real conflict with the confirmed table.** The owner's anchors are
*ratio-shaped* and the existing table does not satisfy them. Derivation, using the shipped disc
constant (`GALAXY_RADIUS_M = 5e20 m` ≈ 52,850 ly, so a galaxy is ~105,700 ly across and a
quarter-galaxy crossing is ~35,000 ly):

| Anchor (owner, 2026-11-25) | Implied speed | Current table | Verdict |
| --- | --- | --- | --- |
| warp, quadrant crossing ≈ 1 week | ≈ 5,000 ly/day | warp **1 ly/day** | current is **~5,000× too slow** (a quadrant would take 96 years) |
| transwarp, same crossing ≤ 1 hour | ≈ 840,000 ly/day | transwarp **100 ly/day** | current is **~8,400× too slow** |
| hyperspace, galaxy → galaxy ≈ 1 hour | ≈ 6×10⁷ ly/day at Andromeda (2.5 Mly) | subspace **10,000 ly/day** | current is **~6,000× too slow** |

Two things follow. First, the **ratio** between the owner's warp and transwarp anchors is 168:1
(a week is 168 hours); the confirmed table's ratio is 100:1. That is close enough that the ladder's
*shape* is right and only the *scale* is wrong — but "close" is not "chosen", and a 2,000 ly/day warp
is a different product from a 5,000 ly/day one. Second, the table was **confirmed as proposed on
2026-11-24** (impulse 0.01 c, warp 1 ly/day, transwarp 100 ly/day, subspace 10,000 ly/day), so this is
not a gap to fill — it is a **superseding decision**. The owner's anchors are the newer statement and
should win, but the numbers must be re-confirmed rather than inferred from three rough phrases.

Also open: whether warp at ~5,000 ly/day makes a *system* hop (a few ly) read as trivial — at that
speed a 5 ly warp costs about 1½ minutes of universe time, where today it costs five days. That may
be exactly the "scifi" feel the owner wants, or it may be too fast for the effect to land. It is a
taste question, and it should be answered with the effect on screen, not in a table.

**Resolved — wormhole and ADR-0010.** The fixed-cost wormhole is now the explicit carve-out in
ADR-0019, not a branch buried in `planTravel`.

## Work breakdown

1. **Level model.** Settle what each address level *means* (ADR-0008 deliberately left levels
   scale-free). This is the first piece and everything else depends on it.
2. **Sectors as an address level** (decided, ADR-0018). Re-keys every address; nothing has shipped,
   so the break is free now and expensive later.
3. **Root layout.** Give galaxies a position in the root frame, procedurally — a population law that
   can produce neighbours around *any* position, not a fixed catalog, so "further out" always has
   something in it.
4. **Galaxy variation law.** A parameter space sampled from the address: arms, pitch, bar, bulge,
   halo, dust, colour. Informed by `celestial-lab` references, implemented independently.
5. **Galaxy naming.** A deterministic name per galaxy address, presentation-only, shown on hover.
6. **Multi-galaxy rendering.** Instanced galaxy impostors with LOD, selected by apparent brightness.
   Addressable density stays full; the *render* set is a selection — that is how "infinite feel,
   finite render" works.
7. **Other galaxies visible from orbit.** Same impostor population at very small angular size,
   respecting ADR-0015's per-pass ceiling so a distant galaxy cannot outshine the home star.
8. **Travel rework.** Method becomes an input (`planTravel(from, to, method)`), the plan returns the
   cost in each method, and wormhole gets its fixed-time path.
9. **Sectors as places.** Compass entries and address lines for a sector, not just a star.

## Open questions

- **V1 scope.** Does V1 include this layer, or does V1 stay "one galaxy, complete loop"? The owner's
  stated priority is base structure first, which argues for including it; that is a scope decision,
  not a technical one.
- **Sector geometry and count.** ADR-0018 settled that a sector is *a rung*; it did not settle how
  many a galaxy has or whether one is a wedge, a box or a shell. This is the first thing the level
  model must answer, because travel selection depends on it.
- Whether time acceleration ships, and whether it is a camera feature or a clock feature.
- Galaxy count and selection rule for the render set.
- How far "local cluster" reaches before the field is purely procedural shell-filling.

## Evidence this ticket will need

- A probe that walks the ladder: system → sector → galaxy, printing the address at each rung and the
  distance in the parent frame.
- A capture of the multi-galaxy field, and one of a galaxy seen from orbit.
- A `planTravel` table showing one destination priced in every method, including the wormhole's fixed
  time.
- `npm test`, `npm run build`, `npm run capture` green at every step.