# `git reset --hard` silently reverts the tracked `opencode.json` edits

Written 2026-11-24 against git 2.49.0.windows.1, while collapsing two local commits on `main`.

## Symptom

After a history rewrite that used `git reset --hard <ref>`, `git status` still shows
`M opencode.json` — so nothing looks wrong — but the file now holds the *committed* values. The
owner's context-window and variant edits are gone. No error is printed; `--hard` is quiet.

Concretely, the committed file has `"context": 600000` and `"context": 300000`; the working copy
this project is supposed to carry has `256000` in both places. After a hard reset the diff becomes
empty.

## Cause

`opencode.json` is **tracked**, and this project keeps a permanent uncommitted edit in it (the
owner's own context and variant tuning; see the seat notes in `AGENTS.md`). `git reset --hard`
resets HEAD, the index **and the working tree**, so any tracked file's uncommitted changes are
discarded. Untracked and ignored files survive, which makes it feel like only "git stuff" was
affected — but `opencode.json` is git stuff.

The reflog recovers *commits*; it does not recover uncommitted working-tree text. There is no undo.

## What to do instead

1. Prefer `git reset --soft <ref>` (moves HEAD, keeps index and worktree) or `git reset --mixed`
   (moves HEAD, unstages, keeps worktree). Those are what reshaping history usually means.
2. Reserve `--hard` for "discard everything", and before using it copy the file aside:

   ```powershell
   Copy-Item opencode.json "$env:TEMP\opencode.json.bak"
   ```

3. Verify after any history rewrite — the diff should still be the owner's edit:

   ```powershell
   git diff -U0 -- opencode.json | Select-String '"context"'
   ```

   It should show `-600000` / `+256000` and `-300000` / `+256000`. An empty diff means the edit was
   lost; restore it from the backup and confirm with `Get-FileHash` before moving on.

4. `git stash push -- opencode.json` also works, but a plain file copy is easier to reason about:
   a stash can be popped onto the wrong branch, and stashing a file that is *permanently* modified
   invites forgetting to pop it.

## Why this repo is exposed

The tracked-but-always-modified pattern is deliberate — the seat/context settings belong with the
project so a clone behaves the same — so every branch switch, merge and reset touches a file with
live local edits. Treat `opencode.json` as "the owner's work in progress" in every destructive git
command, alongside the untracked `.scratch/` evidence.