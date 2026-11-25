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
   place inside one galaxy. A quadrant is an **angular slice of the disc**, and a galaxy has **1 to 6**
   of them by size — a very small galaxy gets 1 (nothing worth splitting), a Milky-Way-sized one 4,
   larger ones 5 or 6. Six is the ceiling. The count is content (`f(seed, address)`), not a link
   parameter, and changing it re-keys every link into that galaxy.
5. **Travel method is the user's choice, not a rule.** Warp can make any trip; a faster method is the
   better option, not the required one. Time is always `Δt = d / v(method)`, with one exception:
   **a wormhole costs a fixed amount of time** (the mouth traversal), then arrives instantly.
6. **You can see the galaxy from orbit**, as in a real sky, and hovering it shows its name in a clean
   popup — "Galaxy X", where **X is either drawn from a curated list of real galaxy names or
   procedurally generated**, deterministic from the seed and address. Both sources are legitimate;
   which one a given galaxy takes is part of the naming law, not a link parameter. Names are
   presentation and **never appear in the link** (ADR-0008).
7. **Free camera travel is not a jump.** With no method selected, `t` advances normally as real time
   passes (ADR-0010: camera gestures never advance the clock).
8. **Long term:** the camera drifts and scrolling carries you deeper into the universe, with
   generation streaming ahead — travel by looking, not by selecting. **ADR-0021** makes this concrete:
   free flight has a **user-selectable speed** (sublight / warp / transwarp / hyperspace) and obeys
   the same `d/v` law, so flying a quadrant at warp is the same journey a warp jump is. Its
   **dependency** is time acceleration: crossing a galaxy at warp takes 7 real days at ×1 and 10
   minutes at ×1000, so the acceleration idea in item 9 becomes a prerequisite rather than a garnish.
9. **Idea, not settled:** user-controlled time acceleration (2×, 10×, 20×). Recorded, not decided —
   but see item 8: free flight across a galaxy needs it, so it is coupled to a real feature.

## The ladder, and how methods map onto it

The methods line up with the rungs, which is why choice works cleanly — but the mapping is **advice,
not a gate**: any method works for any trip at or above the system rung.

| Method | Cheapest at (advice) | Effect | Time |
| --- | --- | --- | --- |
| impulse / free flight / sublight | inside one system | none | real time; `t` follows the clock |
| **warp** | system → system | star streaks | `Δt = d / v` |
| **transwarp** | sector → sector, inside a galaxy | tunnel / slipstream | `Δt = d / v` |
| **hyperspace** | galaxy → galaxy | aperture / hyperspace tunnel | `Δt = d / v` |
| **wormhole** | any → any | a mouth, then arrival | **fixed `Δt`**, then instant |

Because method is a choice, a coarser method may be used for a longer trip — it is simply slow — and a
faster method may be used for a shorter one, where it is simply extravagant. That is the whole
trade-off the UI should show: the same destination, priced in each method.

**The one hard rule is upward:** inside a single system, sublight is the norm; warp there is
permitted but effectively instant, so it is a convenience rather than a tier.

**Resolved — naming.** The ladder above is ADR-0019: `subspace` is retired as a method name in
favour of **hyperspace**, and "tier" (the rung crossed) is now separate from "method" (what you ride).

**Resolved — absolute speeds are reframed, not chosen (ADR-0020).** The owner's anchors are *time*
anchors, and the speed for each method is **derived**: `v = d / Δt_anchor`. Nobody picks a ly/day
number. The consequence is that **scale and speed are decoupled** — grow the galaxy and every speed
grows with it, leaving every crossing time identical. So raising speeds to stop things "feeling too
close together" is both unnecessary and counterproductive: raising speed alone shrinks the felt
universe. Full table in ADR-0020.

Priced at the shipped disc size (`GALAXY_RADIUS_M = 5e20 m` ≈ 52,850 ly, so ≈105,700 ly across), where
a quadrant crossing is the **diameter**:

| Anchor (owner, 2026-11-25) | Derived speed | Confirmed table (2026-11-24) | Gap |
| --- | --- | --- | --- |
| warp, diameter in ~1 week | ≈ 15,100 ly/day | warp **1 ly/day** | ≈ **15,000× too slow** |
| transwarp, same in ≤1 hour | ≈ 2,536,800 ly/day | transwarp **100 ly/day** | ≈ **25,000× too slow** |
| hyperspace, galaxy→galaxy in ~1 hour | ≈ 1.5×10⁸ ly/day | subspace **10,000 ly/day** | ≈ **15,000× too slow** |

The **ratios** in the anchors (warp : transwarp : hyperspace = 1 : 168 : 10,080) are internally
consistent and stable across every galaxy size, so the ladder's *shape* is settled and only the
absolute values move when the size law is. The 2026-11-24 table is **superseded, not extended**: it is
off by four orders of magnitude, not a factor of two.

**OPEN — the less obvious half: short trips.** Because the anchors are set by *diameter* crossings,
high speeds make a system hop absurdly cheap — a 5 ly warp at 15,100 ly/day takes about **7 seconds**
of universe time. That is probably right (ADR-0019 §3 makes inside-a-system sublight anyway), but it
means the anchor that matters most for feel is the *shortest* one, not the longest. Worth choosing with
the effect on screen rather than in a table.

**Resolved — wormhole and ADR-0010.** The fixed-cost wormhole is now the explicit carve-out in
ADR-0019, not a branch buried in `planTravel`.

**Resolved — wormhole is not galaxy-to-galaxy only.** ADR-0019 §2 now says **any method works for any
trip**, so hyperspace and wormhole are legal for a system-to-system hop. They differ in cost, not
permission. The only restriction is upward: inside one system, sublight is the norm.

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