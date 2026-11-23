# 0003 — Travel tiers are frame rebases

**Status:** accepted (2026-11-23)
**Context:** The universe must be navigable from many galaxies down to a single planet. One
continuous world space across 26 orders of magnitude is the classic hard problem of
space simulators, and fighting it costs years.

## Decision

Travel is **tiered**, and each tier is a **rebasing of the coordinate frame**. The visual
effect (star streaks, slipstream, wormhole) is the mask for the swap. Free flight remains
available inside every frame.

**Tiers:** impulse/free flight (within a frame) → warp (sector → system, same quadrant) →
transwarp/slipstream (system → different quadrant) → subspace/wormhole (galaxy → galaxy).

**Hierarchy** (which the tiers traverse): universe → quadrant → sector (~20 ly) → system →
body.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Tiered frame rebase | Discrete jumps between nested spaces, masked by VFX | Chosen |
| B. One continuous world space | Continuous zoom across all scales | Rejected — precision and LOD cost grow without bound; a decade-scale problem |
| C. Loading screens between levels | Discrete scenes, hard cuts | Rejected — no sense of scale, no free flight |

## Why

It converts the hardest engineering problem in the project into a visual-effects problem.
Continuous flight then only has to work inside a ~10¹³ m frame, where precision is trivial
(ADR-0002). The tier vocabulary is also already familiar (Star Trek quadrants and sectors),
so it costs no user education and maps one-to-one onto octree levels.

Trade-off accepted: warp is "faked" travel. That is not a weakness — it is what makes an
infinite universe affordable, and the effect is where the drama lives.

## Consequences

- Travel and precision share one mechanism: the warp *is* the rebase.
- Free flight out to arbitrary empty points requires a **navigation compass** (bearing and
  distance to anchors, origin pin, return breadcrumb) or the void is disorienting.
- Each tier's VFX is an independent art/rendering task, not an architectural one.
- Time jumps (scrubbing to another epoch) reuse the same visual language but must read as
  *the world rebuilding*, not motion through space — see ADR-0004.