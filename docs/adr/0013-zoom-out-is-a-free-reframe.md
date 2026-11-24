# 0013 — Zoom-out is a free reframe, anchors are drawn stars, and the trail is a coordinate

**Status:** accepted (2026-11-24, owner)
**Context:** ADR-0003 puts travel in Layer 4 and ADR-0012 makes a committed travel one atomic state
change. Lane 3 adds the two user-facing ways to *choose* a destination — the address lines and the
compass — and both raise the same question the council left open: what is navigation made of when
nothing is moving? The owner answered the three product questions on 2026-11-24; this records them
and the two limits that follow from the architecture.

## Decision

**1. Following an address line is a reframe, not a travel.** The address becomes the ancestor the
line stands for, the camera re-frames to show it, and **no universe time passes** — the clock's
value and mode are untouched. It still gets its own history entry, because Back retraces *places*
and this is one.

**2. The "came from" pin is carried in the link** as a `from=` parameter and is a **coordinate, not
journey state**. It names the address a committed travel started from. The compass computes a
bearing and distance to it exactly as it does for any anchor. Nothing about a jump's progress is
stored, so ADR-0012's "a link and an arrival are the same state" still holds: reloading an arrival
link reproduces the trail.

**3. Anchors are content, not a trail.** The compass lists the nearest stars of the galaxy the
picture is already drawing — the same `currentGalaxy.stars` the renderer consumes, each with the
address that produced it (ADR-0011). It never lists "places you have been" and never generates a
population of its own. The search is one pass over the drawn array, bounded by its size, so a
crafted address cannot make the compass enumerate an address space.

**4. Only the galaxy line zooms out in v1.** Levels do not carry a scale yet (ADR-0008), so dropping
one level from a deep address would re-render a *different system at zero motion* — a visible change
with no movement. The galaxy is the only target where the picture really is a different scale. The
root is refused with a reason: nothing outside a galaxy is placed, so there is nowhere to stand.

**5. The galaxy zoom-out is face-on and fits the whole disc.** The camera is placed on the disc's own
axis, from its `+normal` side, at the distance that puts the farthest disc point on the vertical
field of view. It is *not* the star's yaw carried over, and *not* the distance that would fit a disc
centred on the camera: the orbit camera looks at the **home star**, which is `0.55 × R` from the
galactic centre, so both the orientation and the distance have to account for that.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Free reframe | Address changes; clock untouched; history entry | **Chosen (owner)** |
| B. Charge `d / v` to zoom out | A zoom-out is a (very short) journey, so it advances time | Rejected — looking at the neighbourhood from farther away is not moving through it; charging time would also make the address line a travel trigger with no method |
| C. Keep the star's viewpoint | Translate the eye out by a rebase, preserving the picture | Not possible yet — see the limit below |
| D. Compass from visited places | Cheap: the places you went to are already known | Rejected — a list of your own footprints is a lie about the neighbourhood, and it cannot name a place you have not been |
| E. Compass by searching the address space | Enumerate candidate addresses and keep the nearest | Rejected — unbounded levels make an unbounded loop, and it could name a star the picture does not draw |
| F. Zoom out one level at a time | Every line drops exactly one level | Rejected for v1 — with no level scale that swaps the scene without moving |

## Why

- **The address decides history, and only the address.** The previous history rule took a
  caller-supplied `arrival`/`framing` label. That put the invariant in the caller's hands: a zoom-out
  labelled `framing` would have overwritten the entry for the star it left, and Back would have
  skipped it. `historyWrite(current, next)` now pushes iff the address changed, so a camera gesture
  (which cannot change the address, ADR-0004) always replaces and a place always pushes.
- **Distance is from the place; bearing is from the eye.** A distance that changed on every drag
  frame would make the list flicker, and it is the `d` the jump is charged for (ADR-0010). A bearing
  measured from the node would be a bearing nobody could act on. The split is deliberate, not an
  accident to tidy up.
- **Face-on is the only honest "see the galaxy".** World `+y` is not the disc normal after
  `GALACTIC_PLANE_TILT_RAD`; the first implementation kept the star's yaw and landed almost exactly
  in the plane, so the galaxy arrived as a band and the arm-legibility test called it illegible.
- **The pin is a place, so it belongs in the link.** A session variable would reproduce a trail for
  one tab and lose it on reload — and a shared arrival link would show a different compass than the
  one the arrival had. The council's "the journey is derived, never stored" is about in-between
  motion; a previous place is not in-between anything.

## Consequences

- **`rebaseCamera` is still without a production consumer.** A view-preserving zoom-out would need a
  camera **target**, because after a pure translation the eye is no longer on the ray its angles
  describe and the next drag snaps back to the frame origin. The orbit camera's "position is derived
  from the angles and distance" invariant is what makes the current reframe safe; the target
  generalisation arrives with right-drag panning (lane 4), which is also what allows the zoom-out to
  preserve the picture.
- **An anchor click is a travel**, so it costs `d / v(method)` and lands on the destination's
  opening camera (ADR-0012). The row shows the distance that will be charged, because it is
  `distanceM` from the place, not from the eye.
- **The compass is nearly useless at galaxy scale by construction.** Its anchors are the nearest
  drawn stars to the *place*, and from a galaxy address the place is the home star — so the three
  rows are local-field stars a few light-years away inside a 175,000-ly view. It is honest; a
  camera-relative compass belongs with panning.
- **A pin in another galaxy is not offered.** Distance across galaxies is unmodelled (ADR-0010), so
  a row for it would print a made-up number. The pin is dropped silently, like any other anchor that
  cannot be measured.
- **What must be revisited:** when levels carry a scale, every address line becomes a real zoom-out
  target and `planZoomOut`'s depth check becomes the level's own answer. When the camera gains a
  target, the reframe should become a translation-preserving one if that looks better; this ADR
  records the current limit rather than pretending it away.