# Status — Layer 3: star field and galaxy

Updated: 2026-11-24
Branch: `wip/layer-3` — the Layer 3 line, now including Sol. `main` carries the docs reorg and is
still Layer 2. Tag `pin/layer-3-assessment` marks `566a303`, the code state the gate
scored 6/10, and stays there; the merge changed no source file.
Working tree: clean except `opencode.json` (user work — do not commit, do not revert).
Pushed: both `main` and `wip/layer-3` are on `origin`. The tag `pin/layer-3-assessment` is local
only — it is the gate's fixed point, not a release.
For exact commit ids, read `git log --oneline -5`; this file deliberately does not pin them.

**The owner's dashboard is `public/status.html`, linked from the HUD ("status ↗").** It is a
one-screen summary, not the record: edit it in the same commit as this file, and keep it short. Its
structure is checked by `src/status-page.test.ts`; its content is the owner's to read.

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
- **Iteration 2 deferred** with the four flaws fixed and measured: nucleus plateau 109 px → 12 px;
  home star peak 0.887 at frame centre with its `HOME_GAP_PX` ring; arms 10.67 ridge/trough at
  1080p vs 9.65 at 4K; a real dust band on the boot frame (axis ratio 1.25 → 4.17). `GALAXY_VERSION 4`,
  `GALAXY_STREAM_VERSION 3`, `GALACTIC_PLANE_TILT_RAD -30°`. Remaining debt and the brief for the
  visual pass: `iterations/layer-3-iteration-2-deferred.md`.
- **Sol, correct** (spec §3.6) shipped as the first **authored node**: reserved address `v1/0.0.0`,
  a frozen registry checked before the generator, eight real planets with real semi-major axes,
  radii, tilts and sidereal spins (Venus and Uranus retrograde), periods derived by Kepler from
  the axes rather than transcribed, J2000 mean longitudes as phases. `resolveSystem` is the one
  place precedence lives. Captured as `layer3-sol-1080p`. Decision: ADR-0009.
- The **cosmic address HUD moved to Layer 4** (recorded in spec §7 row 3 and §9): it is half of the
  navigation compass, and the other half is travel.
- **Layer 4 council convened** (2026-11-24, owner's instruction) at fixed point `014c312`, three
  seats across two model lineages. Recommendation: **A, address-origin frames, rebasing on tier
  crossings only**, with the approach probe before any code and the focus rebase out of v1. The
  seats' shared weak point — a focus rebase that would have to be stored to survive a shared link —
  is why the chair dropped it. Record: `council-layer-4.md`; dissent is in §8.
- **Lane P, the approach probe: PASSES.** `src/render/approach-probe.ts` (+ 13 assertions in its
  test). Worst float32 body displacement is **5.3×10⁻⁵ px** against a half-pixel
  bar, at every approach radius, direction and resolution tested (1920/2560/3840). So v1 is
  **address-only**: no focus rebase, and the council's open question is closed with a number. The
  counterweight is recorded too — at **true scale** the near plane sits 1,412 real Earth radii out,
  which makes landing a Layer 6 depth-range problem, not a rebase one. Note:
  `docs/notes/metres-to-pixels-needs-the-projection.md`.
- **Lane 1, the rebase module: done.** `src/frame/rebase.ts` — translation only, a shift rather than
  two absolutes, orientation untouched, pure. `npm test` **184/184** (19 files). Two findings along
  the way: the dead band has no consumer under A (recorded, not built), and the risk seat's
  "`cam=1e30` renders a wrong image" is **false** — it renders a correct but empty one, because the
  scene normalises before rounding. That second finding exposes something bigger: **one address
  spans system→galaxy across twelve orders of magnitude** (the `layer3-galaxy-*` shots sit at
  1.3×10²¹ m under a system address), so "which frame is this camera in" is the address HUD's
  problem, not a parser check.

## Doing

**Layer 4 lane 1 (the rebase module) is done; lane 2 is next.** `src/frame/rebase.ts` is
`rebaseCamera(camera, originShiftM)` — translation only, shift never absolute, pure — plus the
offset bound. 14 assertions, including "a 10 ly rebase moves a body under 0.001 px". The council's
dead-band rider was **dropped deliberately**: under A nothing continuously changes the address, so a
hysteresis constant would have asserted a literal. It has no production consumer yet, by design.
Still unbuilt: **`placement(seed, address)`** (ADR-0010's prerequisite for `d`), lane 2's history
and journey rules, the compass, and the tier masks.

Two new environment notes landed with this commit, both traps this session paid for:
`docs/notes/powershell-writes-cp1252.md` and `docs/notes/git-reset-hard-and-opencode-json.md`, plus
`docs/notes/inverted-smoothstep-erases-field.md` for the two regressions fixed while wrapping up.

## Next

1. **Layer 4 (travel tiers) is decided and has started.** `council-layer-4.md` §10 records the
   owner's answers: **A**, address-origin frames, rebasing on tier crossings only; a tier crossing
   is a **journey**; **time advances by `d / v(method)`** (ADR-0010), which entails
   `placement(seed, address)`; tiers + panning first, compass second. **Lane P is done and passes**
   (§8), so the rebase is address-only. Lane 1 (`src/frame/rebase.ts`) is next.
2. The deferred visual pass: read `iterations/layer-3-iteration-2-deferred.md` before touching tone,
   grading, density balance or reference claims. Re-gate here when it returns.
3. **Antigravity guidelines are defined** (owner, 2026-11-24): `AGENTS.md` → *Antigravity / Neon
   handoffs*, working detail in `docs/notes/two-agent-workflow.md`. The chair asks before any
   handoff; gate scoring never leaves this workflow.
4. Open owner question: when to add left-click X/Y camera panning (with zoom, pitch and yaw
   relative to the new centre). It couples to `src/input/orbit-controls.ts`'s "position is derived
   from angles and distance" invariant and to ADR-0003's framing-vs-travel split, so it belongs
   with Layer 4's camera work rather than as a standalone change. **D5 already answers the ordering
   (with the tier work); what is unanswered is whether it is a drag or a modifier-click.**


## Blocked

- **Nothing wanted from the owner to start.** Two small constants are open and both can be answered
  at the first build step: the speed table in ADR-0010 (proposed, unconfirmed) and the placement
  choice (hash-to-position vs a deterministic star from the galaxy's population).
- Nothing technical. The 1650-class proxy is unavailable, so floor performance stays an argument,
  never a measurement.
- Nothing technical. The 1650-class proxy is unavailable, so floor performance stays an argument,
  never a measurement.

## Decisions

- **Layer 4 shape (owner, 2026-11-24):** A (address-origin frames), rebasing on tier crossings only;
  a tier crossing is a journey; tiers + panning first, compass second. The focus rebase is out of v1
  and gated on the approach probe. Council record: `council-layer-4.md` §10; dissent in §8.
- **Travel time is distance over speed** (ADR-0010): `Δt = d / v(method)`, measured in the parent
  frame. Camera gestures never advance `t`. This entails `placement(seed, address)`, which also
  serves the compass. The speed table is proposed, not confirmed.
- **Authored nodes reserve a new address and ignore the seed** (ADR-0009). Sol is `v1/0.0.0`; a
  hand-authored node that keeps varying with the seed cannot be an anchor, and overwriting a
  procedural address rewrites somebody's shared link.
- **The star's presentation constants were left alone** after Sol's capture was judged on a 1:1
  crop: the glare quad's *bounding* radius is wider than Mercury's drawn orbit, but only
  `STAR_CORE_RADIUS` writes depth and occludes, and every body is visible. Do not "fix" a
  presentation constant from bounding-radius arithmetic alone.

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

- `src/universe/authored/index.ts` (new) — the registry: frozen data, `authoredSystemFor`,
  `resolveSystem` (the one precedence point), `authoredAddresses`.
- `src/universe/authored/sol.ts` (new) — Sol as data: real axes, radii, tilts, sidereal spins,
  J2000 phases; periods from Kepler. `SOL_VERSION`, `SOL_ADDRESS = 'v1/0.0.0'`.
- `src/universe/authored/sol.test.ts` (new) — reserved-address round-trip, seed independence,
  procedural fallback equality, real astronomy invariants.
- `src/universe/system.ts` — `starProfile` and `SIZE_FRACTION` exported so authored content reuses
  the generator's definitions instead of a drifting copy.

- `src/render/galaxy-scene.ts` (new) — packing, legibility, watchdog, convergence fade.
- `src/gpu/galaxy.wgsl` (new) — instanced camera-facing quad, softened profile, `frame_info`.
- `src/universe/galaxy.ts` — arms, bulge, `GALAXY_VERSION 4`, `GALAXY_STREAM_VERSION 3`, the -30°
  galactic-plane tilt (`GALACTIC_PLANE_NORMAL`, `toDiscFrame`).
- `src/gpu/scene.wgsl` — `lod_meta`, ring/planet/core fades, corona handoff.
- `src/gpu/renderer.ts` — galaxy pipeline, tier watchdog, `galaxyFrame()`, `forceSlowFrames`.
- `src/main.ts` — HUD scene row keys off `GalaxyFrame.identity` (`fit × resolved`), not `lod`.
- `tools/capture.mjs`, `tools/live-probe.mjs`, `tools/watchdog-probe.mjs`, `capture/shots.json`.
- `docs/notes/blindspot-reviewer-image-size.md` — rewritten: the empty response is the token
  budget, not image size; pass `--max-tokens 6000`.
- `docs/notes/check-captures-at-1-to-1.md` — the trap this session paid for: a downscaled capture
  makes a 10 px planet and a washed-out one look the same; crop at 1:1 before calling it a defect.
- `docs/adr/0009-authored-nodes-reserve-an-address.md` — why Sol could not overwrite a link.
- `docs/reference/arm-legibility-eight-arm-pointcloud.png` — the one reference kept out of ten
  (652×366, tracked; the owner's own image). Its three claims, four prohibitions and arm-count
  caveat are in `docs/reference/README.md` and spec §9 — do not use it as a target, and do not take
  its density, point size or palette.

## Verification

- `npm test` — pass, 17 files, **157 tests** (11 of them cover the authored registry and Sol: seed
  independence, byte-identical procedural fallback, a per-node version that does not move
  `SYSTEM_VERSION`, real axes and Kepler-derived periods).
- `npm run build` — pass, `tsc --noEmit && vite build`, clean; **80.67 kB JS / 29.13 kB gzip**.
- `base doctor` — no errors; `docs.issues: docs/issues`, the doc tree and the ADR index check clean.
- Doc path check — backticked refs that look like paths (one or more slashes plus a file extension),
  resolved against the repo root or the file's own directory, over the project markdown files (`docs/`
  plus `AGENTS.md`, `README.md`, `GLOSSARY.md`). On `main`: 177 refs across 46 files, 10 unresolved
  and all accounted for — 6 name Layer 3 files that exist only on `wip/layer-3`, 2 are `AGENTS.md`
  skill references rather than repo paths, 2 are version strings in a ticket that the pattern mistakes
  for paths. On `wip/layer-3`: 181 refs across 47 files, and the same 4 remain — the two skill
  references and the two version strings.
- `npm run capture` — **20/20 shots pass**; the new shot is `layer3-sol-1080p`.
- Sol visual check — `layer3-sol-1080p` shows all eight bodies, the HUD reads
  `v1/0.0.0 · 3 levels` and `G-type · 8 planets · ×1930–18438 real`. Judged on a 1:1 crop after the
  downscaled image suggested the corona hid Mercury and Venus; it does not, which is why the
  presentation constants were left alone (`docs/notes/check-captures-at-1-to-1.md`).
- `npm run probe:live` — `{steps:81, decreases:0, firstRampAt:"step-64", firstFullAt:"step-69",
  handoffSteps:5, maxCount:45000, sceneRows:8}`; the far clamp reads `one galaxy · ×1 real`.
  The handoff leg now starts on the inclined camera (the edge-on boot yaw keeps `lod` at 0 by design).
- `npm run probe:watchdog` — rich 45000 → medium 22500, status `ready` (on `566a303`).
- `perception` gate — 6/10 (below target 8); iteration 2 deferred, see above.
- **Not run:** the 1650-class proxy; any mobile or 2560/3840 live loop.
- All of the above were re-run after the iteration-2 fixes on `wip/layer-3`; the earlier
  "not re-run since the docs reorg" caveat no longer applies.

## Open questions

- Should the galaxy shot go into the README now (captioned "in progress") or wait for the Layer 3
  commit?
- Root `LICENSE`: the repo is public and unlicensed, so it is all-rights-reserved by default.