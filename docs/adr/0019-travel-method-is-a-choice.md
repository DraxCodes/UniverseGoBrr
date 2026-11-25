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
2. **Any method works for any trip.** No method is tied to a range. Warp, transwarp, hyperspace and
   wormhole can all take you star-to-star, sector-to-sector or galaxy-to-galaxy; they differ only in
   speed and cost. The "cheapest at" column below is **advice about which is worth picking**, never a
   restriction. Using hyperspace for a system hop is allowed and simply wasteful.
3. **The one hard rule: inside a solar system, sublight.** A trip between two bodies of the same
   system is impulse / free flight. Warp is permitted but is effectively instant at those distances,
   so it is a convenience rather than a tier. Every jump method is legal for every trip **at or above
   the system rung**.
4. **A wormhole costs a fixed `Δt`**, then arrives instantly at any distance. This is the single
   carve-out to ADR-0010, stated here rather than buried as a branch in `planTravel`.
5. `subspace` is retired as a *method* name in favour of **hyperspace**; the word may survive as
   flavour copy. Renaming a method back is one constant and one table row, not a reversal.

| Method | Cheapest at (advice, not a gate) | Effect | Time |
| --- | --- | --- | --- |
| Free flight / sublight | inside one system | none | real time; `t` follows the clock |
| **Warp** | system → system | star streaks | `Δt = d / v` |
| **Transwarp** | sector → sector | tunnel / slipstream | `Δt = d / v` |
| **Hyperspace** | galaxy → galaxy | aperture / hyperspace tunnel | `Δt = d / v` |
| **Wormhole** | any → any | a mouth, then arrival | **fixed `Δt`**, then instant |

Every row from Warp down is legal for **every** trip at or above the system rung. The column says
where each method is the sensible choice — it does not say where it is permitted.

## Consequences

- `planTravel(from, to)` becomes `planTravel(from, to, method?)`: with a method it prices that
  method; without one it recommends the cheapest and reports the cost in each. ADR-0012's "one atomic
  state change" is unchanged — a choice still writes one arrival link and enters it.
- **"Natural rung" stops being a concept in code.** It survives only as a recommendation the UI
  makes. A validator that rejected hyperspace for a short hop would be wrong, so no such check is
  written.
- **Sublight is a range rule, not a tier.** The system boundary is the one place a method is
  restricted, and it is restricted *upward* (no jump method needed) rather than downward (no method
  forbidden). That keeps the rule one sentence instead of a matrix of method × range.
- ADR-0010 gains an explicit exception. Its core claim — `t` advances by distance over speed in the
  parent frame, and a camera gesture never advances `t` — is untouched.
- **The galaxy-to-galaxy wall changes shape.** It was never a missing method; it is a missing
  *distance* (no root layout). Naming the method does not provide the distance, and ticket 06 owns it.
- **Tier and method are now separate words.** A *tier* is a rung crossed; a *method* is what you ride
  across it. Conflating them is what made the method look derivable in the first place.