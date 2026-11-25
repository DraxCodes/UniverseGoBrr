---
date: 2026-11-25
verified_against: 349c64d
files: [index.html, package.json, public/status.html, capture/shots.json, .opencode/workflow.json]
status: active
---

# A product rename touches a dozen tracked files, but not the seeds

**Cause.** The working title `UniverseGoBrr` is still the shipped name. When the owner picks a real
one, the rename looks like a text replace, but three things in the repo must not move or the picture
changes with the branding.

**What a rename may change** (checked at `349c64d`):

| Surface | Where |
| --- | --- |
| App title, HUD brand, start-failure heading | `index.html` (`<title>`, `.hud__brand`, `<h1>`) |
| Package identity | `package.json`, `package-lock.json` (`name: universegobrr`) |
| Readme and dashboard | `README.md`, `public/status.html` (title, heading, working-title note) |
| Current-state docs | `docs/issues/spec.md`, `docs/issues/status.md` — **current-state lines only**; leave gate scorecards and iteration reports as historical records |
| Project key | `.opencode/workflow.json` — owner config; the rename decision includes it, it is not a silent edit |

**What a rename must not touch.**

1. **Seed strings** such as `ugb-0000` in `capture/shots.json`. A seed is data; changing the prefix
   re-rolls every appearance and invalidates all 20 captures and the gate evidence. Rename the
   product, not the seeds.
2. **The `window.__ugb` test hook** used by `capture/` and `tools/`. Renaming it is a code change
   that must move the harness in the same commit, or every probe and screenshot fails.
3. **Version constants** — `GALAXY_VERSION`, `GALAXY_STREAM_VERSION`, `PLACEMENT_VERSION`. A name is
   not a generator generation; bumping them re-rolls the sky.

**What to do instead.**

- Do the rename as one docs + branding commit: the five surfaces above, `docs/issues/status.md` and
  `public/status.html` together (the status-page test enforces the structure, not the word).
- Re-run `npm test` and `npm run capture` afterwards; the capture harness proves the picture did not
  move, which is the check that catches a seed or hook edit by accident.
- Record the chosen name and the alternatives considered as an ADR (next number 0016) before or with
  the rename, so the decision does not live only in the diff.

**Grep that finds the surface.**

```powershell
git grep -l "UniverseGoBrr\|universegobrr"
```

At `349c64d` it returns 29 tracked files: **8 live surfaces** (every row in the table above), 17
immutable `.scratch/runs/*` records (they describe the tree as scored — leave them), and 4
historical documents (the three Layer 3 gate briefs and `docs/notes/stale-dev-server-fakes-evidence.md`)
where the old title is prose, not branding.