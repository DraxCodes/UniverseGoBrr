# 0021 — Free flight is a speed the traveller sets, and it can leave a system

**Status:** accepted in direction (2026-11-25, owner). **Long term — not scheduled.** This is a
destination, not a ticket; the numbers it needs are open.
**Context:** ADR-0010 draws a hard line — *camera gestures are not travel; orbit, pan and zoom never
advance `t`* — and ADR-0019 §3 restricts free flight to sublight inside one system. Both were
written when free flight meant "a slight dolly while looking at something". The owner wants free
flight to be a **first-class way to move**: sublight near a star, but a settable speed that can be
warp, and crossing a quadrant by flying rather than by selecting a jump.

That is a real change to the model, not a camera tweak, so it is recorded before any of it is built.

## Decision

1. **Free flight has a user-selectable speed**, on the same ladder as the jump methods: sublight,
   warp, transwarp, hyperspace. The speed is a choice, not a property of where you are.
2. **Sublight remains the sensible default inside a system** — not because faster is forbidden there,
   but because sublight is enough and the faster ones are absurd at that range. This preserves ADR-0019
   §3 as *advice* rather than a wall, matching ADR-0019 §2's "no method is tied to a range".
3. **Flying at a speed advances `t` by `d / v` — the same law as a jump.** This is the important part:
   free flight is not a second time model. It is the same equation, integrated continuously instead of
   applied as one committed step.
4. **Therefore `t` advances at exactly wall-clock rate during free flight, at every speed.** A camera
   moving at `v` for one real second covers `v × 1s` and so costs `d / v = 1s` of universe time. The
   speed changes how much *space* you cover per real second, never the ratio of universe time to real
   time. Verified across all four speeds.
5. **Orbit, zoom and pan still do not advance `t`.** They change the viewpoint of a place; they do not
   travel through it. See the open question below for where that line sits.

## The consequence that matters, and it is not obvious

Free flight is **not** a shortcut past the time anchors. At warp (≈15,100 ly/day for a Milky-Way-sized
galaxy), free-flying across the diameter takes **7 real days**. Transwarp takes an hour;
hyperspace, a minute. So flying across a galaxy at warp is *the same journey a warp jump is* — the jump
just skips the intervening hour-by-hour by committing it in one step.

This means **free flight across large distances is only usable with time acceleration**:

| Time multiplier | Real time to fly the diameter at warp |
| --- | --- |
| ×1 | 7 days |
| ×10 | 16.8 hours |
| ×100 | 1.7 hours |
| ×1000 | 10 minutes |

So the owner's "maybe 2×/10×/20× time" idea (ticket 06 item 9) is **not optional decoration** if free
flight is to cross a galaxy. It becomes a **dependency of this feature** — and it is the same knob:
accelerating time is what makes a long flight watchable. Recorded as a dependency, not yet decided.

## Options considered for the time relationship

| Option | Shape | Verdict |
| --- | --- | --- |
| **Same law, integrated** | Free flight is `d/v` applied continuously; `t` tracks wall rate | **Chosen** — one model, no special case, and it makes a jump and a flight the same journey at different granularity |
| Free flight advances no time | Flying is free; only jumps cost | Rejected — crossing the universe by holding a key would make every jump price meaningless |
| Free flight has its own time scale | A separate clock rate for flying | Rejected — two time models is the failure mode ADR-0010 exists to prevent |

## Consequences

- **ADR-0010 is amended, not overridden.** Its rule becomes: a *travel displacement* advances `t` by
  `d/v` whether committed as one step or flown continuously. Its remaining claim — that a *reframing*
  gesture (orbit, zoom) advances nothing — stands.
- **Flying across a tier boundary needs the rebase to be continuous.** ADR-0011's tier change is
  currently a step at a committed crossing; at warp, a boundary is passed mid-flight. The approach
  probe measured rebasing at **5.3×10⁻⁵ px** of float32 displacement, so a visual pop is not the
  risk — the risk is the *address* changing continuously, which ADR-0012 deliberately avoided ("the
  address changes once"). Free flight has to decide when the address moves: on each boundary, or on
  landing. **Open.**
- **Free flight across a galaxy is a rendering problem as much as a travel one.** At warp you cross
  regions faster than a static galaxy pass can be re-populated, so lodding and streaming inherit a
  real budget rather than a theoretical one. This is the same streaming work ticket 06 item 8 needs.
- **It gives the compass a second consumer.** Warping to an arbitrary empty point (spec §3.2) is
  already supported in principle and needs the compass to be usable; free flight is the same problem
  with a continuous answer.

## Open questions

- **Where is the pan/free-flight line?** Pan is a translation that advances no time (ADR-0014); free
  flight is a translation that does. The clean rule proposed: **a gesture advances `t` when a speed
  is claimed; it does not when the user is merely repositioning the viewpoint.** The hole in that rule
  is a long pan at galaxy scale, which covers real distance while claiming no speed. Either pan is
  bounded to the current frame's scale, or a fast pan promotes itself to free flight. Not decided.
- **Does the address change on every boundary crossing, or only on landing?** ADR-0012 chose "once,
  silently, mid-effect" for jumps; continuous flight has no single moment.
- **Is free-flight speed a per-session setting or carried in the link?** Carrying it makes a shared
  view reproducible but puts a camera control in the URL.
- **Does time acceleration ship, and is it the same control as free-flight speed?** The table above
  argues they are coupled in practice.