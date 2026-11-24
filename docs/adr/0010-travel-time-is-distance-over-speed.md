# 0010 — Travel advances time by distance over speed

**Status:** accepted (2026-11-24, decided by the owner)
**Context:** ADR-0003 makes travel a tiered rebase, and the Layer 4 council recommended advancing
`t` by a fixed duration per tier (impulse 0, warp hours, transwarp years). The owner rejected that
shape: *"time should move ahead based on distance we're travelling and the speed we associate with
the method of travel"* - so a short hop at warp and a much longer transwarp can cost the same time,
because the methods differ by orders of magnitude.

## Decision

For a committed travel action using method `m`:

```
Δt = d / v(m)
```

- **`d`** is the metric distance actually travelled, measured in the **parent frame** of the
  crossing: two systems are measured in their sector, two sectors in their quadrant, two galaxies in
  the universe.
- **`v(m)`** is one speed constant per method: impulse, warp, transwarp/slipstream and
  subspace/wormhole - the four tiers of ADR-0003. If another method was discussed at project start,
  it takes a row in the table and nothing else in this decision changes.
- **Camera gestures are not travel.** Orbit, pan and zoom never advance `t`. Only a travel action
  the user commits does; otherwise a mouse drag would age the universe.
- **Effect duration and elapsed time are different numbers.** The effect is screen time, a constant
  per method. `Δt` is universe time, computed above. A warp that looks like a minute may advance the
  clock five days.

## Why

The fixed-duration model makes every warp equal, which is wrong the moment travel has a length: a
hop to the neighbouring star and a crossing of the quadrant are not the same journey. Distance over
speed is the only model where the **tier's speed is the design knob** and the trip length is what the
traveller actually chose.

It also makes the tiers commensurable. At warp 1 ly/day and transwarp 100 ly/day, a 5 ly warp and a
500 ly transwarp both take five days. The longer trip is not "more time" because it is a bigger tier.

## Entailed: addresses need a position in their parent

`d` does not exist today. The address is opaque identity (ADR-0008) and a system has no coordinate
inside its sector, so the distance between `v1/a.b.c` and `v1/a.b.d` cannot be computed from the two
addresses.

D3 therefore entails a **placement** function: `placement(seed, address)` returns a deterministic
`Position` in the parent frame, versioned like any content. This amends the Layer 4 brief's "no new
content" rule deliberately, and narrowly: it is one pure function, not a population. It also supplies
the navigation compass's bearings and distances (spec §3.2), which the same layer needs, and it is
what lets a rebase prove its swap is continuous.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Fixed duration per tier | `Δt` is a constant table | Rejected by the owner: the trip length is invisible |
| B. Nominal tier distance over speed | `d` = the tier's scale | Rejected: A in disguise - constant per tier again |
| C. Camera displacement, no placement | `d` = the camera's own delta | Rejected: `d` becomes whatever the animation says, so the model is circular |
| D. Placement + distance over speed | `d` from the parent frame, `v` per method | **Chosen** |

## Consequences

- Speed constants are **content**, versioned with the generator. Changing one changes the arrival `t`
  of every link that crosses it, exactly like a generator change.
- A journey's arrival `t` is **derived** (`departure + d/v`) and pinned in the link; the journey
  itself is never stored, so the council's rule survives.
- Advancing a **live** clock moves `epoch`; advancing a **pinned** clock moves `t`. Either way the URL
  is what changes, and the HUD shows the arrival epoch during the effect.
- Arrival `t` quantises to the structural tick (spec §3.5), so two links to the same arrival agree to
  the tick.
- Placement serves three consumers at once: travel distance, the compass's bearings and distances,
  and the rebase's continuity check. That is why it is one function and not three.
- Impulse/free flight inside a frame does not advance `t` yet: the camera is not a ship, and there is
  no ship speed to apply until a later layer.

## Proposed speed table (one confirmation outstanding)

| Method | Speed | Anchor trip |
| --- | --- | --- |
| impulse / free flight | 0.01 c ≈ 3.0×10⁶ m/s | 1 AU in ~14 hours |
| warp | 1 ly/day ≈ 1.1×10¹¹ m/s ≈ 365 c | 5 ly in 5 days |
| transwarp / slipstream | 100 ly/day ≈ 1.1×10¹³ m/s ≈ 3.65×10⁴ c | 500 ly in 5 days |
| subspace / wormhole | 10,000 ly/day ≈ 1.1×10¹⁵ m/s ≈ 3.65×10⁶ c | 100,000 ly (a galaxy) in 10 days |

These are fiction numbers, not physics; the property that matters is the ratio. The FTL tiers are
100× apart on purpose, so "one tier up" is "two orders of magnitude faster" and the only thing that
decides a journey's length is how far it goes. The table is proposed, not yet confirmed - the owner
can move any row without touching the model.

## What would change this decision

If placement cannot be made cheap enough to run at the compass's cadence, there is **no silent
fallback**: option B is the rejected shape, and reverting to it means the owner accepting that every
trip in a tier takes the same time. Return the measurement, not a substitute model.

Placement has one open choice of its own: a hash-to-position function, or selecting a deterministic
star from the galaxy's own population. The second is coherent with what the player sees; the first
is cheaper and more uniform. That choice belongs with the compass, not here.