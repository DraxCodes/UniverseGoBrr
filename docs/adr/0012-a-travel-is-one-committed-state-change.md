# 0012 — A travel is one committed state change, and it lands on the destination

**Status:** accepted (2026-11-24, owner)
**Context:** ADR-0003 makes travel a tiered frame rebase and ADR-0010 fixes the time cost at
`Δt = d / v(method)`. The Layer 4 council left two things the owner had to feel rather than derive:
what the camera shows the instant a jump finishes, and whether travelling may change the clock's
mode. Both decide what the URL means, so they are recorded before the compass and the tier masks
build on them.

## Decision

A committed travel is **one atomic state change**. After it:

1. **The address is the destination.** The jump changes it once; there is no stored in-between.
2. **The clock has advanced by `Δt` and its mode is unchanged.**
   - A **pinned** clock (`t` set) moves `t` forward by `Δt`; the arrival link reproduces that
     instant exactly.
   - A **live** clock (`t` null) moves the **epoch** back by `Δt`; time has still advanced, and the
     orrery keeps running. Travel never freezes a live world.
3. **The camera is the destination's opening view** — exactly the framing a fresh shared link to
   that address would choose. The owner's answer: *see the destination.*
4. **The URL is written once, after the state is complete, as one history entry.** A travel is
   therefore *exactly* "write the arrival link and enter it", so reloading the link and arriving by
   travel are the same state rather than two paths that must agree.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. See the destination | The arrival camera is the destination's opening framing; the effect covers the change | **Chosen (owner)** |
| B. Keep your exact viewpoint | Rebase the camera by the origin shift; the picture never jumps | Rejected — after a long jump you can arrive light-years out, looking at a dot instead of the place you travelled to |
| C. Pin every arrival | `t` is pinned on arrival so the link is always exact | Rejected — it freezes the planets after every jump, which the live default exists to avoid |

The council's "rebase first, then composite a fading departure snapshot over the live destination at
arrival `t`" is kept: the destination *is* live at the final frame by construction. It is the departure
pose that is gone, not the destination.

## Why

- **Last effect frame ≡ first static frame** holds by construction: the static frame after the jump
  is the arrival state the effect was already showing.
- **A link and an arrival are the same state.** The evidence plan's round-trip (reload a mid-travel
  link and land where the jump would have) needs no separate "journey" parameter, which is what the
  risk seat required: journey state is **derived**, never stored.
- **Preserving the clock's mode** is the only rule that satisfies both sides of the council's `t`
  objection: a pinned coordinate stays reproducible, and a live world does not stop being live.

## Consequences

- **`rebaseCamera` still has no production consumer.** Under A the arrival camera is re-framed, not
  translated, so the rebase's first consumer is the address HUD's clickable zoom-out (lane 3), which
  changes the frame without travelling. This is a deliberate deviation from the council's lane-2
  note, recorded rather than hidden.
- **The jump is a hard cut until the tier masks land** (lane 4). Lane 2 ships the state change, the
  clock and the history entry; the mask is what makes it feel like a journey.
- **A live-clock arrival link drifts with the wall clock**, exactly like every live link the app
  already shares (ADR-0004). A pinned arrival link is exact. This is stated in the ticket rather
  than papered over.
- **Distance is real only inside one galaxy** (ADR-0010): galaxy-to-galaxy travel is refused with a
  reason until a root layout exists.
- **An arrival the URL cannot represent is refused** rather than written. The clock is part of the
  coordinate, so a jump that would push `t` past the reader's cap or the epoch past a four-digit ISO
  year cannot be shared, and `advanceClock` answers with a reason instead of the link. A live clock
  reaches this after roughly seven maximum jumps; a crafted link reaches it immediately.
- **What must be revisited:** if the arrival view becomes a setting, or an interrupted jump becomes
  a state the app can be in, this decision is the place to start.