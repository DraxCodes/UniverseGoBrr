# Status — Layer 3: star field and galaxy

Updated: 2026-11-24
Branch: `wip/layer-3`, which is the Layer 3 WIP commit `566a303` with `main`'s docs reorg merged in.
`main` carries the reorg. Tag `pin/layer-3-assessment` marks `566a303`, the code state the gate
scored 6/10, and stays there; the merge changed no source file.
Working tree: clean except `opencode.json` (user work — do not commit, do not revert).
Pushed: `origin/main` matches `main`, so the record is public. `wip/layer-3` and the tag stay local.
The record is tracked and present on both branches; there is no staged-index hazard any more.
For exact commit ids, read `git log --oneline -5`; this file deliberately does not pin them.

## Done

- Layer 3 implemented: instanced impostor galaxy, arm-contrast crossfade, one camera frame, static
  galaxy, ≤60k tiered with a frame-time watchdog. `src/render/galaxy-scene.ts`,
  `src/gpu/galaxy.wgsl`, `src/gpu/renderer.ts`, `src/main.ts`, `src/input/orbit-controls.ts`.
- Arms fixed **in the generator** (Lane 2/3 boundary crossed with the user's approval):
  rejection sampling into the arm, `INTER_ARM_FRACTION 0.08`, `ARM_FLOOR 0.05`, `GALAXY_VERSION 2`.
  Rendered m=2 is 0.334 / 0.313 / 0.302 at 2.6 / 3.0 / 3.4 R.
- Local field now collapses into the home star (`LOCAL_CONVERGENCE_MIN_PX 1.5 → FULL_PX 8`); the
  hard white disc at frame centre is gone. See `docs/notes/galaxy-local-field-collapse.md` (on
`wip/layer-3`; the behaviour it describes is not on `main` yet).
- Corona handoff: `STAR_MIN_PX 3.4`, `fs_star` boost `mix(1.0, 1.9)` over `smoothstep(0.45, 0.85,
  lod)`, exactly 1.0 at orrery scale so Layer 2 is untouched.
- Evidence: 19/19 captures, 81-step live handoff (`decreases 0`, 2 notches, one scene-row swap),
  watchdog tier drop `rich → medium` with status still `ready`.
- Public repo pushed: `https://github.com/DraxCodes/UniverseGoBrr`, default branch `main`, README
  now carries two captures from `main`'s own build (`docs/media/`, commit `1066994`).
- **Gate iteration 1: 6/10, KEEP and iterate.** Scorecard: `gates/gate-layer-3-iteration-1.md`.

## Doing

Nothing in flight in the code. The tree is pinned so the user can run an assessment phase; Layer 3
iteration 2 has not started.

Two new environment notes landed with this commit, both traps this session paid for:
`docs/notes/powershell-writes-cp1252.md` and `docs/notes/git-reset-hard-and-opencode-json.md`.

## Next

1. **Antigravity guidelines are defined** (owner, 2026-11-24): `AGENTS.md` → *Antigravity / Neon
   handoffs*, working detail in `docs/notes/two-agent-workflow.md`. The chair asks before any
   handoff; gate scoring never leaves this workflow.
2. Read `gates/gate-layer-3-iteration-1.md`, then work the four flaws in its order: home-star identity
   (0.56 → above the field's 0.99, distinct hue, 2–3 px clear gap), grade the nucleus, make the
   arms read at 1080p, then the boot-frame dust band.
3. Fix the false "at native size" label in the crop manifests (`.scratch/visual-review/layer3/manifest.json`).
4. Re-capture, re-run `probe:live` and `probe:watchdog`, re-run the blindspot pass at
   `--max-tokens 6000`, re-gate.
5. On a score ≥ 8: `/code-review` scoped to the Layer 3 diff, then one commit on `main`.

## Blocked

- Nothing technical. The 1650-class proxy is unavailable, so floor performance stays an argument,
  never a measurement.

## Decisions

- Effect shape (instanced impostors, arm-contrast crossfade, one frame, static galaxy) — council
  §10 + issue 04, **closed**; do not re-open.
- Arm contrast lives in the generator, not the shader — the first population put 0% of stars
  inter-arm and measured m=2 0.11; user-approved. Issue 04, "Implemented" section.
- Findability is measured from the galactic centre, not the home star — home sits at 0.55 R.
- A missing home star on an arm for some seed is accepted.
- The README shows Layer 2 only while `main` is Layer 2; the galaxy shot joins it with the Layer 3
  commit (or under an "in progress" caption, the user's call).
- **Arm count: the implementation is m=2** (`armOffsets = [firstArm, firstArm + π]`), while council
  §10 and issue 04 allow **2–4**. The saved reference is confirmed **8-armed** and is therefore
  mechanism evidence only, never a target: `armModulation` measures `cos(2·azimuth)`, so an 8-arm
  population would report `contrast ≈ 0`. Four arms is the in-envelope step; eight is a spec change.
  Both are captured in spec §9 — "seed-varied arm count (2–4)" in the backlog table, and
  "captured, but not cheap: eight-armed galaxies" with the metric, budget and envelope constraints.

## Where things live

The decision record is tracked, so a clone on another machine is enough to resume work:

- `docs/issues/` — `spec.md`, `council-layer-3.md`, this `status.md`, `tickets/` (one file per
  layer) and `gates/` (each scorecard plus the brief it answered). The seam points here:
  `.opencode/workflow.json` → `docs.issues`.
- `docs/security/` — audit findings. `docs/notes/` — environment traps. `docs/adr/` — decisions.
- `docs/reference/` — visual references, each with its stated limits; see `docs/reference/README.md`.
- `.scratch/` — local evidence only: capture sets, probe frames, blindspot shots, diagnostics and
  the measurement scripts that produced them. `.scratch/*` is ignored except `.scratch/runs/`, the
  run ledger (small text, and the record of what was scored).

## Files

- `src/render/galaxy-scene.ts` (new) — packing, legibility, watchdog, convergence fade.
- `src/gpu/galaxy.wgsl` (new) — instanced camera-facing quad, softened profile, `frame_info`.
- `src/universe/galaxy.ts` — arms, bulge, `GALAXY_VERSION 2`.
- `src/gpu/scene.wgsl` — `lod_meta`, ring/planet/core fades, corona handoff.
- `src/gpu/renderer.ts` — galaxy pipeline, tier watchdog, `galaxyFrame()`, `forceSlowFrames`.
- `tools/capture.mjs`, `tools/live-probe.mjs`, `tools/watchdog-probe.mjs`, `capture/shots.json`.
- `docs/notes/blindspot-reviewer-image-size.md` — rewritten: the empty response is the token
  budget, not image size; pass `--max-tokens 6000`.
- `docs/reference/arm-legibility-eight-arm-pointcloud.png` — the one reference kept out of ten
  (652×366, tracked; the owner's own image). Its three claims, four prohibitions and arm-count
  caveat are in `docs/reference/README.md` and spec §9 — do not use it as a target, and do not take
  its density, point size or palette.

## Verification

- `npm test` — pass, 16 files, 141 tests, on the merged `wip/layer-3` (the gatekeeper also ran them
  on the unmerged `566a303`).
- `npm run build` — pass, `tsc --noEmit && vite build`, clean; 76.98 kB JS / 27.55 kB gzip.
- `base doctor` — no errors; `docs.issues: docs/issues`, 45 markdown files under `docs/` on `main`
  (46 on `wip/layer-3`, which adds `galaxy-local-field-collapse.md`), 8 ADRs.
- Doc path check — backticked refs that look like paths (one or more slashes plus a file extension),
  resolved against the repo root or the file's own directory, over the project markdown files (`docs/`
  plus `AGENTS.md`, `README.md`, `GLOSSARY.md`). On `main`: 177 refs across 46 files, 10 unresolved
  and all accounted for — 6 name Layer 3 files that exist only on `wip/layer-3`, 2 are `AGENTS.md`
  skill references rather than repo paths, 2 are version strings in a ticket that the pattern mistakes
  for paths. On `wip/layer-3`: 181 refs across 47 files, and the same 4 remain — the two skill
  references and the two version strings.
- `npm run capture` — 19/19 shots pass (on `566a303`; not re-run after the docs-only merge).
- `npm run probe:live` — `{steps:81, decreases:0, handoffSteps:2, maxCount:45000}` (on `566a303`).
- `npm run probe:watchdog` — rich 45000 → medium 22500, status `ready` (on `566a303`).
- `perception` gate — 6/10 (below target 8).
- **Not run:** the 1650-class proxy; any mobile or 2560/3840 live loop.
- **Not re-run since the docs reorg:** the captures and probes. The merge touched no source file
  (`git diff --stat 566a303 HEAD -- src tools capture package.json` is empty), so their evidence
  still describes this tree.

## Open questions

- Should the galaxy shot go into the README now (captioned "in progress") or wait for the Layer 3
  commit?
- Root `LICENSE`: the repo is public and unlicensed, so it is all-rights-reserved by default.