# 0019 — Travel method is a choice, and a wormhole costs a fixed time

**Status:** accepted (2026-11-25, owner) — semantics only. Absolute speeds remain open (ticket 06).
**Context:** ADR-0003 defined the travel tiers as frame rebases and ADR-0010 priced a crossing at
`Δt = d / v(method)`. `planTravel` then *derived* the method from the address pair, so the method was
a consequence of the destination rather than something the traveller chose. The owner's model is a
ladder of methods, each priced in time, with the faster one being **better, never required**.

It also contains one method the current model cannot express: a **wormhole** costs a fixed amount of
time whatever the distance, because the cost is walking into the mouth, not crossing the gap.

## Decision

1. **Method is an input.** A travel plan prices one destination in every method and the traveller
   picks. A coarser method is always allowed and is simply slower — that comparison is the whole
   trade-off the UI shows.
2. **The ladder is free flight → warp → transwarp → hyperspace → wormhole**, each with a natural
   rung. Anything faster than the natural rung also works for a shorter trip; it is just faster.
3. **A wormhole costs a fixed `Δt`**, then arrives instantly at any distance. This is the single
   carve-out to ADR-0010, stated here rather than buried as a branch in `planTravel`.
4. `subspace` is retired as a *method* name in favour of **hyperspace**; the word may survive as
   flavour copy. Renaming a method back is one constant and one table row, not a reversal.

| Method | Natural rung | Effect | Time |
| --- | --- | --- | --- |
| Free flight | inside one frame | none | real time; `t` follows the clock |
| **Warp** | system → system | star streaks | `Δt = d / v` |
| **Transwarp** | sector → sector | tunnel / slipstream | `Δt = d / v` |
| **Hyperspace** | galaxy → galaxy | aperture / hyperspace tunnel | `Δt = d / v` |
| **Wormhole** | any → any | a mouth, then arrival | **fixed `Δt`**, then instant |

## Consequences

- `planTravel(from, to)` becomes `planTravel(from, to, method?)`: with a method it prices that
  method; without one it reports the natural rung and the cost in each. ADR-0012's "one atomic state
  change" is unchanged — a choice still writes one arrival link and enters it.
- ADR-0010 gains an explicit exception. Its core claim — `t` advances by distance over speed in the
  parent frame, and a camera gesture never advances `t` — is untouched.
- **The galaxy-to-galaxy wall changes shape.** It was never a missing method; it is a missing
  *distance* (no root layout). Naming the method does not provide the distance, and ticket 06 owns it.
- **Tier and method are now separate words.** A *tier* is a rung crossed; a *method* is what you ride
  across it. Conflating them is what made the method look derivable in the first place.