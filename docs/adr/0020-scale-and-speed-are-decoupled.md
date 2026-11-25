# 0020 — Scale and speed are decoupled; crossing *time* is the invariant

**Status:** accepted (2026-11-25, owner intent; numbers remain open under ticket 06)
**Context:** the owner asked for a bigger universe and offered to raise speeds so that galaxies "don't
start to feel too close together or small." That offer rests on an intuition worth correcting before
it gets encoded, because raising speed does not make a universe feel larger — it makes it feel
*smaller*. Raising speed and scale together in proportion changes nothing at all in time, which is the
only thing a traveller actually experiences.

`Δt = d / v`. If `d` and `v` grow by the same factor, `Δt` is unchanged. So a "bigger" universe with
proportionally faster ships is *exactly the same product*. The scale is free; the feel is set by how
long a crossing takes.

## Decision

1. **The time anchors are the design surface.** Choose how long a crossing *should* take, and the
   speed for each method is **derived**: `v = d / Δt_anchor`. Nobody picks a ly/day number directly.
2. **Scale may grow arbitrarily without touching the anchors.** Growing the galaxy multiplies every
   speed by the same factor and leaves every crossing time identical. Verified: at 3,000 ly through
   400,000 ly across, `Δt` holds to `1.000000000`.
3. **What makes the universe feel big is distance per unit of screen**, not speed: how small a galaxy
   looks from orbit, how much emptiness sits between systems, and how much of the sky a step covers.
   Those are camera, LOD and selection questions — Layer 4b's problem, not the speed table's.
4. **Therefore the speed table is downstream of two decisions that come first:** the size law (how
   big is a galaxy, 1–6 sectors) and the time anchors (a week, an hour, a minute).

## The table this implies

Anchors as the owner stated them, priced at each galaxy size — a quadrant crossing is diametrically
opposite slices, so it is the **diameter**:

| Galaxy size | Diameter (ly) | Warp (week) | Transwarp (hour) | Hyperspace (minute) |
| --- | --- | --- | --- | --- |
| dwarf, 1 sector | 3,000 | 429 ly/day | 72,000 ly/day | 4.3×10⁶ ly/day |
| small, 2 | 20,000 | 2,857 | 480,000 | 2.9×10⁷ |
| **Milky Way-ish, 4** | 105,700 | **15,100** | **2,536,800** | **1.5×10⁸** |
| large, 5 | 200,000 | 28,571 | 4,800,000 | 2.9×10⁸ |
| huge, 6 | 400,000 | 57,143 | 9,600,000 | 5.8×10⁸ |

Row three supersedes the confirmed 2026-11-24 table by ~15,000× (warp), which is why this is a
decision and not a tweak. The *ratios* are stable across every row — warp : transwarp : hyperspace is
1 : 168 : 10,080 — so only the absolute values move when the size law is settled.

## Consequences

- **A speed is never a constant; it is a function of the galaxy you are in.** A dwarf's warp is slower
  in ly/day than a giant's, and that is correct: the anchor is the crossing time, not the speed.
  `TRAVEL_SPEED_M_PER_S` therefore cannot stay a flat table keyed only by method.
- **The one measurement that must be checked on a real screen** is the *ratio of crossing time to
  effect duration*. A warp lasting seven days of universe time cannot play for seven days; the effect
  is seconds. ADR-0010 already separates screen time from universe time — this ADR is why that
  separation is load-bearing rather than pedantic.
- **Precision is unaffected at these scales.** Doubles hold Mpc (≈9.5×10²¹ m) with room to spare.
  The int64 cell model (ADR-0002) is still deferred (ADR-0008) and its resolution is a
  *reachability* question for the level model, not a travel question.
- **This does not license an unbounded speed.** Very high speeds make a *system* hop cross in
  milliseconds, so short-range trips need their own answer (sublight). That is ADR-0019 §3.

## Scale must not rest on travel time alone

The invariance above is a fact about *time*, not a claim that time is the only source of scale. The
owner's correction, recorded here because it is easy to over-read the decoupling argument:

> speed and crossing time are a floor, not the whole effect. A universe whose only size cue is "the
> trip took a while" reads as *slow*, not as *vast*.

So "big" has to be carried by **evidence you can see**, independently of any clock:

| Cue | What it does | Where it lives |
| --- | --- | --- |
| **Nested structure at every scale** | a system inside a sector inside a galaxy inside a field: each level is legible as a shape, so zooming reveals structure rather than just smaller dots | 4b, level model |
| **Genuine emptiness between things** | most of the volume is nothing. Compression of *emptiness* is already the `displayRadiusM` decision; it must not compress the *structure* | shipped (Layer 3), extended by 4b |
| **Parallax and approach** | things visibly grow, shift and resolve as you close on them — the strongest scale cue available, and it costs no travel time at all | camera + LOD |
| **Seeing far things that are far** | the galaxy from orbit; other galaxies as smudges; the local cluster as a field | 4b |
| **Variety in what is far** | ten identical galaxies read as wallpaper. Difference is what makes distance believable | 4b, variation law |
| **Frame of reference changing hands** | the HUD's address and the compass re-anchoring as you cross a rung | ADR-0013, extended |

The consequence for design: **a screenshot at rest should already communicate scale.** If size is only
apparent while a trip is in progress, the universe is not big — it is just slow, and the fix is
composition and structure, not a longer trip.