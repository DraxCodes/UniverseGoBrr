# 0024 — A galaxy's size and shape are drawn, and its size is real

**Status:** accepted (2026-11-25, owner; ticket 06 work item 4, "Slice B")
**Context:** from the first discs until now, every galaxy in the universe was one fixed design at one
fixed size. `GALAXY_RADIUS_M = 5e20` was "the" radius, `ARM_WINDING` was "the" pitch, and one bulge,
one palette and no bar, halo or dust meant `v1/0`, `v1/7` and `v1/11` were the same object with a
different rotation. Ticket 06 item 2 named the defect plainly: *"Galaxies are varied — arm count,
shape, density, size, colour, nucleus — not one law with a different seed. Variety is what makes a
field of them read as a universe."*

The owner's answers fixed the scope rather than the implementation: **"shape, appearance and size"**;
size **"very wide, real spread"**; halo and dust **"honest minimal"**; and the home galaxy is **"one
sample of the law"** — `v1/0` is not pinned to the old design.

## Decision

**A galaxy's size and shape are content, drawn from `(seed, galaxyAddress)`, and its size is real in
every system that frames, measures or travels to it.**

- **The shape law** is `galaxyShape` in `src/universe/disc.ts`, on its own stream
  `seed|addr|shape|v1`: arms 2–4, arm sweep, scale length, bulge fraction/radius/flattening, bar,
  halo fraction, dust depth, colour age.
- **The size law** is `galaxyRadiusM`: radius 0.5e20..9.0e20 m (18×), linear on the size fraction
  the sector count already derives from. One draw therefore decides both how big a galaxy is and how
  many sectors slice it — a galaxy cannot be sized one way and sliced another.
- **`GALAXY_RADIUS_M` survives only as a reference**, for the two jobs that are deliberately
  population-level: the zoom-rate schedule's return to the Layer 2 rate, and the yardstick the size
  law is written against. Anything that frames or measures one galaxy uses **that galaxy's own**
  `radius`.
- **The arm's sweep is drawn and its pitch is derived** (`winding = sweep · scaleLengthFraction`),
  because the product of two independent draws is what shapes a spiral and a free product drew
  spokes.

## Consequences

- **Framing, zoom ceilings, legibility and exposure all become per-galaxy.** `galaxyFraming` takes
  the radius; the wheel's ceiling is `12 × radius`; the disc's "outside/overfilled" thresholds and
  the exposure correction divide by the galaxy's own radius. A small galaxy is a compact object much
  sooner than a large one, and one threshold for the population would call a 0.5e20 galaxy a wall
  while a 9e20 one is still a speck.
- **Size is only visible at a fixed absolute camera.** Because framing distance scales with radius,
  every galaxy fills the same fraction of frame when zoomed to it. The size law is observable in the
  boot/orrery band and in HUD distances, not in a per-galaxy shot. Any evidence of size must use a
  fixed-distance pair and say so.
- **The home galaxy changed.** `v1/0` is now a 6.68e20, three-arm barred galaxy. The boot frame, the
  galaxy-layer captures and the Sol backdrop were re-shot; this is the law working, not a regression.
- **Version bumps:** `GALAXY_VERSION` 9→10, `APPEARANCE_VERSION` 8→9 (appearance now depends on the
  same drawn law), `PLACEMENT_VERSION` 2→3 (positions really move), new `GALAXY_SHAPE_VERSION` 1.
  `GALAXY_STREAM_VERSION` 3 and `SCALE_VERSION` 1 are unchanged — neither stream's meaning moved.
- **A varied generator has to be judged as a law, not a sample.** The single framed manifest galaxy
  cannot show the tail of a draw range; `tools/galaxy-gallery.mjs` exists for that and is what caught
  the spoke defect. The trap is written up in `docs/notes/derived-shape-axes-and-their-products.md`.

## Options considered

| Option | Effect | Verdict |
| --- | --- | --- |
| **Draw size and shape; make size real** | Every galaxy is a different object at a different distance, and every framing follows it | **Chosen** |
| Draw a shape only; keep one radius | Visibly varied discs, but a 9e20 and a 0.5e20 galaxy would be indistinguishable in a field, and "size" in the ticket would be a lie | Rejected — the owner asked for a real spread |
| Draw shape and a display-only scale factor | Cheapest, but the wheel ceiling, legibility and travel distances would all be wrong for every non-reference galaxy | Rejected — a size that changes nothing is not a size |
