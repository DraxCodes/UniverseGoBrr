# 0014 — The camera looks at a target, and right-drag pans it

**Status:** accepted (2026-11-24, owner)
**Context:** D5 deferred panning from Layer 3 to Layer 4 because it needs the same generalisation
travel does: a camera described by a point to look at, not just an eye and two angles. The owner
bound the gesture on 2026-11-24: **left-drag keeps orbiting, right-drag pans.** This records the
camera shape, the input, and what the URL carries.

## Decision

**1. The camera is a target, the angles that look at it, and a distance.** The eye is derived:
`eye = target − forward(yaw, pitch) · distance`. Every function in `src/input/orbit-controls.ts`
returns a camera that satisfies this, so "position is derived from angles and distance" survives —
what changes is only *which point* the angles and distance are relative to. Before, it was always
the frame origin; now it is `camera.target`, which is the origin until the view is panned.

**2. Right-drag pans; left-drag orbits.** A pan slides the target — and the eye with it — across the
view plane by the world distance the cursor covered **at the target's depth**. One pixel is
`2 · distance · tan(FOV/2) / viewportHeightPx` metres, so the point under the cursor stays under the
cursor at any zoom, and the drag feels grabbed rather than accelerated. Dragging right moves the
scene right (the camera moves left); dragging down moves the scene down (the camera moves up),
matching the orbit drag's "drag the scene" sign. The canvas suppresses `contextmenu` so a
right-drag does not open the browser menu.

**3. The target rides in the link as `tgt=x,y,z`.** It is a separate parameter, not appended to
`cam`: a link that never pans is **byte-identical** to the Layer 2/3 format, and a reader that does
not know about panning still parses the eye and the angles. A panned link writes `tgt` only when the
target is not the frame origin, so no link grows a coordinate it does not use. A `tgt` with no `cam`
is reported and ignored — a target with no eye to look from would put the default eye at the frame
origin staring past the star.

**4. A pan is a gesture, not a place.** It cannot change the address (ADR-0004), so the history rule
(ADR-0013) rewrites the current entry in place and Back never grows. It advances no universe time
(ADR-0010): framing is not travel.

**5. Orbit and wheel preserve the target; the zoom limits are measured eye-to-target.** If the wheel
measured the eye's distance from the frame origin, panning far away would look like zooming out and
the clamp would fire at the wrong moment. Measuring eye-to-target keeps the wheel's feel at every
pan.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Store target + angles + distance | Eye derived, one invariant, one writer | **Chosen** |
| B. Store eye + a separate look-at point | Two positions that can disagree; every control must keep both in sync | Rejected — the bug the current invariant prevents |
| C. Middle-drag pans | No conflict with the context menu | Rejected (owner) — right-drag is the binding |
| D. Pan at the frame's scale | One metre-per-pixel for the whole frame | Rejected — at galaxy distance a drag would move light-years per pixel and the grab would be lost |
| E. Fold the target into `cam` | One parameter | Rejected — breaks every existing link and reader for a value that is usually zero |

## Why

- **A target is what makes panning usable.** Moving the eye alone would pan the picture but leave
  the next orbit swinging around the old point, so the view would jump back. Moving the eye and the
  target together slides the picture and keeps the orbit honest.
- **The URL is the coordinate, so the view belongs in it.** A panned view that was not in the link
  would be lost on reload and would make two tabs of the same URL show different pictures.
- **A separate parameter keeps old links exact.** `cam` already means "the eye and the angles"; a
  fifth-number-plus-three extension would make every capture, probe and shared link from Lanes 2–3
  parse differently. An absent `tgt` is the frame origin, which is what it always was.

## Consequences

- **Boot is unchanged.** `defaultSystemCamera` targets the star at the frame origin, so no opening
  view moves and no existing capture changes.
- **The HUD says so.** The view row appends `· panned` and its tooltip names the target, because the
  eye coordinates changing is not by itself enough to explain why the star left the centre.
- **Touch has no right button.** A phone cannot pan yet. Two-finger drag is the obvious follow-up
  and is not attempted here.
- **`rebaseCamera` still has no production consumer.** Panning moves within one frame and never
  rebases, and the galaxy zoom-out is deliberately a reframe (ADR-0013): a translation-preserving
  zoom-out would show the disc from inside the plane it sits in, which reads as a band, not a
  galaxy. The target makes a view-preserving option *possible*; the chosen look is still the
  face-on reframe.
- **Precision is unaffected.** The eye and the target are both doubles in the frame's metres, and
  every upload still subtracts the camera in doubles before rounding (ADR-0008). The target is
  bounded by the same position cap as the eye.
- **What must be revisited:** a two-finger pan for touch; whether a pan should be clamped to some
  neighbourhood of the frame; and a translation-preserving zoom-out if it can be made legible.