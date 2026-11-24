# Issue record

The decision record, tracked so a clone on any machine can resume the work.

- `spec.md` — the spec, the layer roadmap (§7) and the idea backlog (§9).
- `council-layer-3.md` — the Layer 3 council, including the experience thesis the gate scores.
- `tickets/` — one file per layer: requirements, what shipped, and where the plan met the pixels.
- `gates/` — one scorecard per hillclimb gate, each with the brief it answered.
- `status.md` — the working checkpoint: which branch, what is next, what is blocked.

Some of these describe work that is not merged yet. `status.md` names the branch a checkpoint
belongs to, so a Layer 3 source path that does not resolve on `main` is expected, not a broken
link.

Evidence that is only looked at — capture sets, probe frames, blindspot shots — stays in the
gitignored `.scratch/` on the machine that produced it.