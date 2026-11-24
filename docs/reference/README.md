# Reference images

Visual evidence that a future session needs in order to *decide*, not to look at. Each entry
states what the image supports and what it must not be used for — a reference with no stated
limits becomes a target, and a target silently overrides a decision that was already made.

The full-resolution capture sets and probe frames live in the gitignored `.scratch/` and stay on
the machine that produced them. Files here are small, purposeful, and rights-confirmed.

## `arm-legibility-eight-arm-pointcloud.png`

652×366 PNG, 92 KB. Made by the project owner (2026-11-24) and supplied as a Layer 3 arm-legibility
reference; kept for one claim: **arms made of dots can read at a small on-screen size**, so the
8/10 perception target is not a Layer 5 dream. It is assessed in
`docs/issues/tickets/04-layer-3-star-field-and-galaxy.md` and
`docs/issues/gates/gate-layer-3-iteration-1.md`.

**Supports three claims, no more:**

1. Arm legibility in dots is achievable at small size.
2. The lane is the signal — the inter-arm region is nearly empty and as wide as the arm.
3. Hue separates arm from inter-arm at no pixel cost, since we already upload per-impostor colour.

**Must not be used for:**

- **Density.** It carries 10⁵–10⁶ points; the budget is 45 000 with 3–5 px footprints.
- **Point size.** Its dots are 1–2 px. Reading that as "use smaller dots" lands in the stipple
  regime the budget exists to prevent — the lesson is contrast, not size.
- **Palette.** The magenta is almost certainly velocity or age coding from the simulation that
  produced it. Take the principle, not the colour.
- **Arm count.** It is an **eight-armed** spiral; our disc has two, and `armModulation` measures
  m=2, so an eight-armed population would report `contrast ≈ 0`. See spec §9, "Captured, but not
  cheap: eight-armed galaxies".
- **As a target to match.** It is a claim about mechanism, not an image to reproduce.