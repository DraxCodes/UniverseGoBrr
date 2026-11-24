# Two agents, one working tree

Written 2026-11-24, against base 0.7.1. Antigravity — or any second agent — may work in this same
checkout. Nothing isolates it: same filesystem, same Windows user, same `.git`.

## Rules

1. **One writer at a time.** There is no spatial separation, so serialise. Two agents in one tree is
   the failure mode: `.git/index` contention, a `dist/` rebuilt under a running capture, two Chromium
   runs against the same port.
2. **`opencode.json` is tracked and usually modified** (the owner's context-window and variant
   edits). A `git add -A` from a second agent commits it. Stage by path, or stash it before handover.
3. **`.opencode/` is generated** (`agents/`, `commands/`, `skills/`, `packs/`, `tools/`). Edits there
   are drift and the next `base update` erases them. Same for the managed block in `AGENTS.md`.
4. **Branches are per agent.** `wip/layer-3` is the owner's line. A second agent gets
   `agent/<tool>-<task>`, branched from the exact commit it was handed — never from `main` when the
   work belongs on top of an unmerged branch.
5. **Ports:** 5173 is dev (iterate), 4173 serves `dist` for `npm run capture` and needs a build
   first. A screenshot from 5173 is not the frame that capture records.
6. **It must reproduce its own claims.** A finding counts when `npm run capture`, `npm run probe:*`
   or `npm test` produces it; a statement about a screenshot nobody can re-take does not.

## What is tracked where

- `docs/` — the record: `issues/` (spec, tickets, gates), `security/`, `notes/`, `adr/`,
  `reference/`.
- `.scratch/` — local evidence: capture sets, probe frames, blindspot shots, throwaway diagnostics
  and the measurement scripts that produced them.
- `.scratch/runs/` — the exception: the run ledger is tracked, because it records what was scored.
  Its records are immutable: the `evidence` paths and `sha256` hashes describe the tree at scoring
  time, so a path that has since moved (or a document that has since been edited) looks stale on
  purpose. Do not rewrite a past record to match the current layout.

## Why it matters

The failure this prevents is a second agent editing a closed decision in the docs to match what it
built, then handing over a clean branch. Tracked docs make that a diff you can read; untracked ones
make it invisible. Since 2026-11-24 the docs are tracked, so `git diff` covers the record too.

The handover itself is a branch plus a prompt of the shape:

```
Branch:  agent/<tool>-<task>, based on <commit>
Commits: <range> — one line each
Claims:  <claim>  prove: <command> -> <expected>
Touched outside the branch: <docs paths, or "none">
Version/seed-visible changes: <GALAXY_VERSION, or "none">
Known broken / not attempted: <...>
```