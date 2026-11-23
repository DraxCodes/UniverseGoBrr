# 0002 — Precision: int64 cell + offset on CPU, camera-relative float32 on GPU

**Status:** accepted (2026-11-23)
**Amended by 0008:** the camera-relative float32 half ships now; the int64 cell and automatic
rebasing half is deferred to Layer 4, behind the `Position` type. The invariant below — no
absolute coordinate reaches the GPU — is unchanged and is now enforced in code.
**Context:** The universe spans ~10²⁶ m and detail must resolve at ~10⁰ m — 26 orders of
magnitude. A 32-bit float holds ~7 significant digits. Positions and depth both break if a
large coordinate ever reaches the GPU.

## Decision

Absolute positions live **only on the CPU**, as an **int64 cell index + float32 local
offset**. Each frame the camera is subtracted in double precision; the GPU receives
**camera-relative float32** only. Depth uses **reverse-Z** with a float32 depth buffer, with
layered near/far ranges where a single range is insufficient.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Cell + offset, camera-relative f32 | Exact integer cells; tiny local floats | Chosen |
| B. Global float64 coordinates | Doubles everywhere, rebase rarely | Rejected — only 15 digits (still fails at 10²⁶), no f64 in WGSL, and consumer GPUs run f64 at ~1/32–1/64 |
| C. Global float32 + floating origin | Rebase the world periodically | Rejected — insufficient range at universe scale; cell indices are needed for deterministic addressing anyway |

## Why

Integers do not lose precision when they grow, and they are the natural hash input for
procedural addressing. Camera-relative float32 is precise where it matters — near the eye —
and is the only thing GPUs are fast at. The work is a few thousand double subtractions per
frame: microseconds against a 16.7 ms budget.

Trade-off accepted: two coordinate representations and a rebasing step. Because travel is
tiered (ADR-0003), each frame is small. That is a bound on what one frame has to *draw*, not a
cap on the coordinate: a double resolves 10¹³ m to ~1.95 mm and 10²⁶ m to ~1.5×10⁷ m, and the
frame-local origin decides which floor applies. ADR-0008 records the measured consequence.

## Consequences

- **Two precision problems, two cures:** position (cell + offset) and depth (reverse-Z).
  They are independent; solving one does not solve the other.
- Rebasing is coupled to travel tiers, so the frame swap and the warp effect are one event.
- CPU bookkeeping is cheap but must avoid allocation churn and `BigInt` in hot loops.
- Revisit only if a single frame ever needs to span more than ~10¹⁵ m.