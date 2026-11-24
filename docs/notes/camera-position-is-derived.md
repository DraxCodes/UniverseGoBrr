---
date: 2026-11-24
verified_against: 667aa43 (wip/layer-3) + lane-4 panning working tree
files:
  - src/input/orbit-controls.ts
  - src/state/url-state.ts
  - tools/pan-probe.mjs
status: active
---

# The camera position is derived, and panning is where that pays

**Cause.** The orbit camera is stored as `target + yaw/pitch/distance`, and the eye
(`x`/`y`/`z`) is *derived*: `target − forward(yaw, pitch) · distance`. Every function in
`src/input/orbit-controls.ts` returns a camera satisfying that identity. Break it — set the
eye without the target, or the target without the eye — and nothing throws: the next drag
recomputes the angles and distance **from the eye around the target**, so the view snaps.
Before panning existed the target was always the frame origin and the invariant held by
accident. It is now load-bearing.

**What to do instead.**

1. Build cameras with `orbitTo(yaw, pitch, distance, target)`. Never write `x`/`y`/`z`
   directly; `dragOrbit`, `zoomBy` and `panBy` already route through it.
2. Measure zoom by `orbitDistance(camera)` (eye to *target*), not `Math.hypot(x, y, z)`
   (eye to origin). A panned view is far from the origin, so the origin distance reads as a
   giant zoom-out and `zoomEdge` fires at the wrong moment. `main.ts`'s HUD scene row had to
   change for this too.
3. Keep `rebaseCamera` shifting the target with the eye; it takes an optional `target` and
   rejects nothing, so a caller that forgets the target gets a rotated view, not an error.
4. In tests, compare the **offset**, not the absolute position: at 10¹² m an absolute
   `toBeCloseTo(x, 6)` fails by one double ulp (≈0.001 m). This cost three red tests that
   looked like a panning bug and were not.

**Evidence.** `src/input/orbit-controls.test.ts` ("keeps the point it panned to dead centre",
"orbits around the panned target afterwards"); `tools/pan-probe.mjs` drives real mouse buttons:
the target moves, the eye moves by the same vector, and the next left-drag turns around the
panned point.

**Probe trap.** A right-drag needs both `page.mouse.down({ button: 'right' })` and the canvas
`contextmenu` handler; without the handler a headed browser opens its menu mid-gesture and the
`pointerup` never reaches the canvas. Use `page.mouse.move` in `steps` so the drag produces
incremental `pointermove`s — one jump move is a single 180 px step, which the controls apply in
one frame and is fine, but it will not show you a per-pixel bug.

**Not a trap.** `tgt` is written only when the target is not the frame origin, so an unpanned
link is byte-identical to the lane 2/3 format. Do not "tidy" that into always writing the
target: it makes every capture and every old link differ for a value that is zero.
