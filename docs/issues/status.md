# Status — Layer 3: star field and galaxy

Updated: 2026-11-25
Name: **Cairn** (ADR-0016). Licence: MIT (ADR-0017). GitHub: `DraxCodes/cairn`.
Update 12: the universe step is owned (`tickets/06-universe-scale.md`); a **sector is an address
level** and a 1–6 slice (ADR-0018); **any travel method works for any trip** (ADR-0019); and
**scale and speed are decoupled** (ADR-0020). Roadmap row **4b** (many galaxies) sits before nebulae.
Branch: `main` — the Layer 3 line, now including Sol, the shipped visual pass and the Layer 4 lanes
so far. The `wip/layer-3` line, the two Neon handoff branches and the five review worktrees were
merged and removed on 2026-11-25; `main` is the only branch on `origin`. Tag
`pin/layer-3-assessment` marks `566a303`, the code state the first gate scored 6/10, and stays there;
the merge changed no source file. The visual pass is `87ddcc1` and scored 8/10.
Working tree: clean except `opencode.json` (user work — do not commit, do not revert).
Pushed: `main` only. The tag `pin/layer-3-assessment` is local only — it is the gate's fixed point,
not a release.
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
  hard white disc at frame centre is gone. See `docs/notes/galaxy-local-field-collapse.md` (the
  behaviour it describes is on `main` since the 2026-11-25 merge).
- Corona handoff: `STAR_MIN_PX 3.4`, `fs_star` boost `mix(1.0, 1.9)` over `smoothstep(0.45, 0.85,
  lod)`, exactly 1.0 at orrery scale so Layer 2 is untouched.
- Evidence: 19/19 captures, 81-step live handoff (`decreases 0`, 2 notches, one scene-row swap),
  watchdog tier drop `rich → medium` with status still `ready`.
- Public repo pushed: `https://github.com/DraxCodes/cairn`, default branch `main`, README
  now carries two captures from `main`'s own build (`docs/media/`, commit `1066994`).
- **Gate iteration 1: 6/10, KEEP and iterate.** Scorecard: `gates/gate-layer-3-iteration-1.md`.
- **Gate iteration 2: 7/10, KEEP and iterate.** The four iteration-1 flaws were fixed and measured
  (nucleus plateau 0 px, home star 0.887, arms ridge/trough 4.56–14.43, boot dust band present), but
  one main-path flaw remained: the disc read as a pointillist scatter (arm window 38.0% across 332
  components). Scorecard: `gates/gate-layer-3-iteration-2.md`.
- **Gate iteration 3: 8/10, SHIP - the visual pass is merged** as `87ddcc1`. Density came back
  without clipping: rich disc 40,000 → 55,000 (tier budget exactly 60,000), disc emission
  `0.73base^0.42`, impostor footprint 3.0–5.0 → **4.65–5.05 px**, `GALAXY_GAIN` 0.56 → 0.194,
  tone ceiling `ceil_lum` 0.90 → 0.79 (below the home star), exposure floor 0.68 → 0.80 with
  exponent −1.25 → −0.40, `GALAXY_VERSION 7 → 8`. The arm window that read 38.0% / 332 components
  now reads **55.0% / 135**; 4K 1:1 coverage 21.6% → 31.1%; lit px mean 132,523 → 194,635 over 12
  seeds; nucleus 0 px above 0.90/0.93/0.97 and below the star on all 12 seeds; the boot band is
  smoother and no brighter (planet contrast byte-identical). Decision: **ADR-0015** (galaxy HDR
  buffer and tone curve). Scorecard: `gates/gate-layer-3-iteration-3.md`. The security LOW from
  iteration 2 (`sampleFrame` resources above the `try`) is fixed in the follow-up commit.
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
- **Galaxy identity: fixed (ADR-0011).** `generateGalaxy` used to key on the *full* address, so every
  address was the centre of a private galaxy — warp one star over, look back, and the arms had been
  redrawn. It now keys on the galaxy's own level (`galaxyAddressOf`, `GALAXY_DEPTH = 1`), applied
  inside the generator so no call site can reintroduce it. `GALAXY_VERSION` 4 → 5; `v1/0` is
  unchanged (it already named its galaxy), every deeper link — Sol included — now shows the galaxy
  it lives in. All 20 captures re-shot: 14 draw a galaxy at a deeper address, so their backdrop is a
  different roll of the same law, and the arm acceptance still passes (measured m=2 0.429 for
  `v1/4`, bar 0.25). The four boot-orrery shots at `v1/0` and the two precision probes are unchanged
  by construction. **The layer-3 gate was scored against the old roll**, so the first visual pass saw
  a different galaxy than the one that scored 6/10; the pass then re-scored 7, then 8, on its own
  fixed points (see *Gate iteration 2/3* above).

- **Placement: done, both halves (ADR-0011).** `src/universe/placement.ts` — `placement(seed, address)`
  returns a position in the parent frame, from the seed and the address only, never the inverse.
  The galaxy node is its own frame origin; the root returns `null` — a normal state, like
  `parentAddress` — because it contains everything and sits nowhere; a deeper address is a star
  placed by the disc law. The law lives in `src/universe/disc.ts` and is **one function** both the
  generator and placement call, so a placed star lands in the same bulge, the same exponential disc
  and on the same arms the picture draws. **The picture now draws by address**
  (`GALAXY_VERSION` 5 → 6): `generateGalaxy` walks the galaxy's children, asks `placedStarIn` for
  each, and every `GalaxyStar` carries its `address`, so a drawn light is exactly the light
  `placement(seed, star.address)` returns. `PLACEMENT_VERSION 2` (one child in nine is a local-field
  star, `starKind`). `GALAXY_STREAM_VERSION` stays 3 because it now governs only the frame (centre
  and arm phase), which did not change; the arm-acceptance measurement therefore stays comparable.
  Captures re-shot 20/20; arm m=2 **0.428** (bar 0.25) and rendered pixel m2 **0.395**. Mechanism
  and versioning: `docs/notes/population-draws-by-address.md`. **Security lens:** one High, fixed
  before push — a crafted `?addr=v1/` hung the child walk forever; the root is not a galaxy, so it
  is now guarded (home star only), `starKind` throws on a shallow address, and the loop has a bound
  derived from the counts. F1's collision exposure is now *drawn*: a rich galaxy hashes 45,000
  sibling keys, so ~1 galaxy in 4 has a coincident pair — widen the hash before any arrival check.

## Doing

**Lane 4 is down to the tier masks.** The repo is one line now: the Layer 3 line and the Layer 4
travel lanes are on `main`, and the handoff branches plus review worktrees were removed on
2026-11-25. Lane 2 shipped a committed travel as one atomic state change
(ADR-0012): `planTravel` in `src/universe/travel.ts` returns the method, the distance in the shared
galaxy frame and `Δt = d / v(method)` — or a plain reason it refuses, never an invented number. The
arrival camera is the destination's opening view, the clock's mode is preserved (pinned `t` moves; a
live epoch shifts back, so the orrery does not freeze), and the URL is written once as one history
entry. `popstate` re-enters the coordinate, so Back and Forward change the picture instead of only
the address bar.

Lane 3 gave that a control: the address is clickable lines, following one is a **free zoom-out**
(ADR-0013), and the compass lists the three nearest **drawn** stars plus a `from=` pin.

Lane 4's panning is now built (ADR-0014). The camera is `target + yaw/pitch/distance` with the eye
**derived**, so a right-drag slides the target and the eye together at the target's depth — the point
under the cursor stays grabbed at any zoom — and the next orbit turns around the point you panned
to instead of snapping back to the frame origin. The target rides in the link as `tgt=` only when it
is not the origin, so an unpanned link is byte-identical to lane 3's. A pan is a gesture, not a
place: it replaces the current history entry and costs no universe time. The wheel and the zoom
clamps measure eye-to-target, not eye-to-origin, or a panned view would look like a zoom-out.

Still not built: the **tier masks**. The owner's 2026-11-24 call is **not this round** — the effect
is WGSL work, and it goes to Neon with a state machine and a first pass from here; when it is gated,
a 6 or 7 on `perception` is a pass with work routed, not a failure (the Layer 3 precedent).

Mechanism notes: `docs/notes/reentering-a-coordinate.md` (why every address change rebuilds the
scene), `docs/notes/powershell-writes-cp1252.md` and
`docs/notes/git-reset-hard-and-opencode-json.md` (environment traps).

## Next

1. **Layer 4's tier masks** are the last piece of the base loop. `council-layer-4.md` §10 records the
   owner's answers: **A**, address-origin frames, rebasing on tier crossings only; a tier crossing is a
   **journey**; **time advances by `d / v(method)`** (ADR-0010). **Lane P passes** (§8), so the
   rebase is address-only. **Lane 1** (`src/frame/rebase.ts`), **both halves of placement**,
   **lane 2** (travel state + URL history, ADR-0012), **lane 3** (compass + clickable address HUD,
   ADR-0013) and **panning** (camera target, ADR-0014) are done. Only `warp` and `transwarp` are
   reachable — `impulse` is no travel action and `subspace` is refused for lack of a root layout.
   **ADR-0019 changes the words, not the reachability:** method becomes a choice, `subspace` is
   renamed `hyperspace`, and a wormhole costs a fixed `Δt`. The mask work Neon holds is unchanged by
   it, because a mask draws warp and transwarp only.
   The security lens has run on the placement consumer, the root-guard fix, lane 2
   (`.scratch/runs/layer4-travel-state-audit.json`), lane 3
   (`.scratch/runs/layer4-compass-navigation-audit.json`) and lane 4 panning
   (`.scratch/runs/layer4-pan-audit.json`) — the last three are clean PASSes. Lane 4's lens raised
   one LOW coverage finding: `parseTarget`'s overflow/non-finite/empty-part rejections were correct
   but unpinned. Two tests now cover every rejection form and a `-0` round-trip (265 → 267 tests);
   no production code changed. Lane 2's lens raised two low findings — a crafted `?t=` or `?epoch=`
   at the edge of the reader's range could make an arrival link reload as a *different* state — both
   fixed by making `advanceClock` refuse an unrepresentable arrival.
2. **Universe scale (row 4b) is the next structural step, and it is now owned** —
   `tickets/06-universe-scale.md`. Sectors become an address level (ADR-0018), galaxies get a root
   layout, a variation law and a render set selected by apparent brightness. It is **not** a beauty
   pass and it does not wait behind nebulae. **Open for the owner:** whether it lands inside V1.
3. The visual pass shipped: read `iterations/layer-3-iteration-2-deferred.md` and
   `gates/gate-layer-3-iteration-3.md` before touching tone, grading, density balance or reference
   claims. **ADR-0015** records the HDR buffer, the per-pass ceiling and the exposure floor; the
   level-9 rough edges (4K 1:1 footprint uniformity, boot-band texture, outer-edge mottle, the
   home-star ring caveat, "the arm containing this star") are routed there, not open defects.
4. **Antigravity guidelines are defined** (owner, 2026-11-24): `AGENTS.md` → *Antigravity / Neon
   handoffs*, working detail in `docs/notes/two-agent-workflow.md`. The chair asks before any
   handoff; gate scoring never leaves this workflow.
5. **Panning is done** (owner binding 2026-11-24: left-drag orbits, right-drag pans; the context
   menu is suppressed on the canvas). What is *not* done is touch: a phone has no right button, so
   two-finger pan waits with the mobile layout (spec §1).


## Blocked

- **Nothing wanted from the owner to start.** The Layer 4 questions are answered: the speed table,
  the panning binding, and the arrival view. The V1 name and licence are decided too: **Cairn**,
  **MIT** (ADR-0016, ADR-0017).
- Nothing technical. The 1650-class proxy is unavailable, so floor performance stays an argument,
  never a measurement.

## Decisions

- **The product is Cairn and the repo is MIT-licensed** (owner, 2026-11-25; ADR-0016, ADR-0017).
  A cairn is a marker a traveller leaves for the next one — the same act as sending a coordinate.
  The obvious vocabulary was searched and nearly every candidate was taken, several by direct
  competitors (Perihelion, Farspan, Orrery, Old Light); `Cairn` collides with a 2026 climbing game
  and that is accepted. The rename touches the live surfaces only — the `ugb-` seeds, the
  `window.__ugb` hook and the `*_VERSION` constants do not move
  (`docs/notes/renaming-surface.md`). The GitHub repo was renamed to `DraxCodes/cairn` on
  2026-11-25; GitHub redirects the old `UniverseGoBrr` links.

- **A galaxy has sectors, and a sector is an address level** (ADR-0018, owner 2026-11-25). The
  ladder is **universe → galaxy → sector → system → body**; *quadrant* is a synonym in copy. A sector
  is an **angular slice** of the disc, and a galaxy has **1 to 6** of them by size — 1 for a very
  small galaxy, 4 for a Milky-Way-sized one, 6 for the largest. A sector is linkable, which is the
  feature: "send me the link to that sector". Every address re-keys and Sol moves one level deeper —
  accepted because nothing has shipped, expensive the moment a public link exists.
- **Travel method is the traveller's choice, and any method works for any trip** (ADR-0019, owner
  2026-11-25). Warp, transwarp, hyperspace and wormhole can all take you star-to-star, sector-to-sector
  or galaxy-to-galaxy; they differ in cost, not permission. The only range rule is **upward**: inside
  one system, sublight is the norm and warp there is effectively instant. `subspace` is retired as a
  method name in favour of **hyperspace**. **A wormhole costs a fixed `Δt`** whatever the distance —
  the one carve-out to ADR-0010.
- **Scale and speed are decoupled; crossing *time* is the invariant** (ADR-0020, owner 2026-11-25).
  Speeds are **derived** from time anchors (`v = d / Δt`), never chosen directly, so growing the
  universe changes no experience. Corollary the owner asked for: raising speed does **not** stop a
  universe feeling small — it makes it feel smaller. The 2026-11-24 speed table is **superseded**;
  warp needs to be ~15,000× faster for "a diameter in a week". What remains open is the short-trip
  anchor.
- **The universe step was never owned; it is now** (owner 2026-11-25, `tickets/06-universe-scale.md`).
  Spec §3.2's vocabulary had no galaxy rung while `GALAXY_DEPTH = 1` invented one, so galaxy-to-galaxy
  travel existed only as a refusal reason ("no root layout") and never as a deliverable. A refused
  feature that reports a clean reason reads as a boundary, and nobody wrote the ticket. The step is
  now roadmap row **4b**, before nebulae, because it is structural and nebulae are beauty.
- **Layer 4 shape (owner, 2026-11-24):** A (address-origin frames), rebasing on tier crossings only;
  a tier crossing is a journey; tiers + panning first, compass second. The focus rebase is out of v1
  and gated on the approach probe. Council record: `council-layer-4.md` §10; dissent in §8.
- **Travel time is distance over speed** (ADR-0010): `Δt = d / v(method)`, measured in the parent
  frame. Camera gestures never advance `t`. This entails `placement(seed, address)`, which also
  serves the compass. **The speed table is confirmed as proposed** (owner, 2026-11-24): impulse
  0.01 c, warp 1 ly/day, transwarp 100 ly/day, wormhole 10,000 ly/day. `d` is real within one galaxy
  today; between galaxies it waits for a root layout.
- **A travel is one committed state change, landing on the destination** (ADR-0012, owner
  2026-11-24). The arrival camera is the destination's opening view ("see the destination"), not the
  rebased departure offset. The clock's mode is preserved: a pinned `t` moves forward, a live epoch
  shifts back, so a live orrery never freezes. The URL is written once, as one history entry, so a
  travel is exactly "write the arrival link and enter it" and a mid-travel link is the arrival link.
- **Zoom-out is a free reframe; anchors are drawn stars; the trail is a coordinate** (ADR-0013,
  owner 2026-11-24). Following an address line changes the address and camera but spends no universe
  time, and still pushes a history entry. The compass lists the three nearest *drawn* stars plus the
  `from=` pin; the pin is a place carried in the link, not stored journey state. Only the galaxy line
  zooms out in v1 (levels carry no scale), face-on and framing the whole disc. Consequence:
  `rebaseCamera` still has no production consumer; the camera `target` now exists (ADR-0014), but the
  translation path would look along the disc plane, so the reframe is kept.
- **Panning is right-drag; left-drag keeps yaw/pitch** (ADR-0014, owner 2026-11-24). The camera now
  carries a **target**; the eye is derived as `target − forward · distance`, so panning moves the
  target and the eye together and the next orbit turns around the panned point. The canvas
  suppresses the context menu. The target rides in the link as `tgt=` only when it is not the frame
  origin. Touch/pen panning waits with the mobile layout (spec §1).
- **The zoom-out stays a face-on reframe, even now that a target exists** (ADR-0013 unchanged). A
  translation-preserving zoom-out would look along the disc's own plane, which reads as a band; the
  target made the option available, not correct.
- **Free flight is a speed the traveller sets, and it may leave a system** (ADR-0021, owner
  2026-11-25 — **deferred indefinitely**). Sublight stays the sensible in-system default, but a user
  can set free flight to warp and fly a quadrant by hand. The law is unchanged — flying at `v` advances
  `t` by `d/v`, so `t` tracks wall rate at every speed and free flight is not a shortcut past the
  anchors. Consequence: crossing a galaxy at warp takes **7 real days** at ×1, so time acceleration is
  a dependency of the feature. The owner has parked it and accepted that a later implementation may be
  heavy to change; the reason it is recorded anyway is so nobody designs *against* it by accident.
- **A light you can resolve is a place you can go** (ADR-0022, owner 2026-11-25). Distant galaxies and
  stars share one appearance continuum — **resolved** (arms, a bar: unmistakably a galaxy), **smudge**,
  and **point** (a dot, indistinguishable from a star). The point tier is deliberately ambiguous and is
  the largest: many of those dots are galaxies, as in Earth's sky. What must *not* exist is a discrete,
  noticeable dot with no address, because tapping it and getting nothing teaches the user the sky is
  fake. The diffuse infinity backdrop stays diffuse texture; everything resolvable is an addressed
  object at a real distance.
- **The first three seconds carry the scale** (owner, 2026-11-25; spec §1 thesis, ADR-0020). Standing
  still anywhere, the scale must already be obvious — arriving in a system should show neighbouring
  galaxies the way Earth's sky shows Andromeda, a few recognisable smudges rather than a wallpaper.
  This is scored directly by the `perception` gate on a **stationary capture**, and it is why the
  universe layer (4b) is structural rather than cosmetic.
- **Coverage: every address is reachable, every trip is priced in every method** (owner, 2026-11-25).
  Slow if you want the journey, wormhole if you want to arrive now. Nothing is refused for want of a
  distance — so the current galaxy-to-galaxy refusal is a **defect**, not a boundary, and the coverage
  check is what proves 4b done.
- **Scale must not rest on travel time alone** (owner correction to ADR-0020). Crossing time is a
  *floor*, not the whole effect: a universe whose only size cue is "the trip was long" reads as slow,
  not vast. Size is carried by nested structure, genuine emptiness, parallax and approach, far things
  visibly far, variety at distance, and the HUD re-anchoring as you cross rungs. **A screenshot at rest
  should already read as big.**
- **The address grid is the world; the picture is a view of it** (ADR-0011, owner 2026-11-24). Every
  drawn light is a rendered address that resolves to the same thing when you arrive; placement is
  `placement(seed, address)`, never the inverse; occupancy is one rule shared by the renderer and
  the resolver; a tier change loses detail, not inhabitants. Immediate consequence shipped: a
  galaxy is keyed on its own level (`galaxyAddressOf`, `GALAXY_DEPTH = 1`), so walking to a
  neighbouring star no longer redraws the sky. `GALAXY_VERSION` 4 → 5.
- **Authored nodes reserve a new address and ignore the seed** (ADR-0009). Sol is `v1/0.0.0`; a
  hand-authored node that keeps varying with the seed cannot be an anchor, and overwriting a
  procedural address rewrites somebody's shared link.
- **Clarity stays in the base; beauty defers to Layer 5** (staging rule, 2026-11-25). A ticket may not
  be blocked on visual polish, and a routed rough edge is not a regression. *Clarity* — can you tell
  where you are, what you can do, what just happened — is structural and belongs beside the feature
  that creates the ambiguity (the address HUD and compass moved into Layer 4 for exactly this reason).
  *Beauty* — tone, grading, density texture, glow, surface detail — is deferrable, and is safe to
  defer because appearance sits behind versioned constants: a later pass is a deliberate re-roll
  (bump the version, re-run the captures, re-gate), not a rewrite. ADR-0015's rough edges are routed
  under this rule, not open defects.
- **Not in V1, stated once so it stops being re-asked:** planet surfaces (L6, "possibly never"),
  touch/two-finger pan (waits with the mobile layout), and — until the owner says otherwise — many
  galaxies (4b).
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
- `src/universe/disc.ts` (new) — the disc law: `galaxyFrame`, `sampleDiscStar`, `armStrength`, the
  tilt and its constants. One function both the generator and placement call, so a placed star and
  a drawn star cannot drift apart.
- `src/universe/placement.ts` (new) — `placement(seed, address)` → position in the parent frame,
  `PLACEMENT_VERSION`, `placementKey`. The root returns `null`; a galaxy node is its own origin; a
  deeper address is a placed star. Never the inverse.
- `src/universe/placement.test.ts` (new) — determinism, containment in the galaxy's disc, exclusion
  from the local sphere, distinct addresses, root refusal, and the stream replay that proves the
  generator and placement share one law.
- `src/input/orbit-controls.ts` — the camera is target + yaw/pitch/distance, the eye is derived;
  `panBy` is right-drag, `dragOrbit` is left-drag, both preserve the target.
- `src/state/url-state.ts` — `Camera.target` and the `tgt=` parameter (absent = frame origin).
- `src/main.ts` — `__ugb.state.target`, the HUD says `· panned`.
- `tools/pan-probe.mjs` (new) — the end-to-end pan evidence (`npm run probe:pan`).
- `docs/adr/0014-camera-target-and-panning.md` — the decision and its limits.
- `src/universe/system.ts` — `starProfile` and `SIZE_FRACTION` exported so authored content reuses
  the generator's definitions instead of a drifting copy.

- `src/render/galaxy-scene.ts` (new) — packing, legibility, watchdog, convergence fade.
- `src/gpu/galaxy.wgsl` (new) — instanced camera-facing quad, softened profile, `frame_info`.
- `src/universe/galaxy.ts` — arms, bulge, `GALAXY_VERSION 5`, `GALAXY_STREAM_VERSION 3` (now
  re-exported from `disc.ts`), the -30° galactic-plane tilt (`GALACTIC_PLANE_NORMAL`,
  `toDiscFrame`), and the population's brightness and colour laws.
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

- **Rename re-run (2026-11-25, `Cairn`):** `npm test` 269/269 (23 files), `npm run build` clean
  (96.92 kB / 34.57 kB gzip, unchanged), `npm run capture` **20/20** with `capture/shots.json`
  untouched — no seed, `window.__ugb` hook or `*_VERSION` moved — and `base doctor` no errors.
- `npm test` - pass, 23 files, **269 tests** (re-run on the merged tree and by the gate).
- `npm run build` - pass, `tsc --noEmit && vite build`, clean; **96.92 kB JS / 34.57 kB gzip** on
  the merged tree (the density branch alone built 97.35 kB / 34.49 kB gzip).
- `npm run probe:travel` — **12/12 checks** (arrival-link reload, Back, Forward, framing write).
- `npm run probe:compass` — **20/20 checks**: the address renders as lines with only the current
  one inert; the compass rows name a place, a bearing and a distance; a drag turns a bearing; a row
  travels to exactly its address and pins the departure; the arrival link reproduces the pin; the
  zoom-out keeps `t` and `epoch`, gains one history entry, and Back returns to the star; the root
  line is refused without moving the page. Screenshots: `.scratch/compass-probe/`.
- `npm run probe:pan` — **15/15 checks**: the opening view targets the origin and the link carries no
  `tgt`; a real right-drag moves the target and the eye by the same vector with the angle unchanged;
  the panned link carries `tgt`; history does not grow; the HUD says `panned`; a left-drag keeps the
  target and changes the angle; the wheel keeps it; the reloaded link reproduces target and eye; `R`
  clears it. Screenshot: `.scratch/pan-probe/pan-system.png`.
- Placement check — the disc-law extraction was **bit-identical**, proved locally with an
  exact-double digest of the 45,001 / 22,501 / 13,601-star cases before and after (a scratch
  comparison, not checked in: the last bits of transcendentals are engine-dependent, so a
  checked-in golden would fail on another engine). The permanent evidence is the replay test:
  placement is deterministic, stays inside the galaxy's disc and outside the 120 ly local sphere,
  and replays the generator's `|disc` stream exactly.
- `npm run capture` - **20/20** on the density pass, re-shot after the visual-pass merge. Every
  shot is bit-checkable against `capture/shots.json`; the two native crops
  (`layer3-arm-edge-2160p` at (2061,736), `layer3-home-star-1080p` at (764,375)) were verified
  pixel-exact by the gate.
- `base doctor` — no errors; `docs.issues: docs/issues`, the doc tree and the ADR index check clean.
- Doc path check — backticked refs that look like paths (one or more slashes plus a file extension),
  resolved against the repo root or the file's own directory, over the project markdown files (`docs/`
  plus `AGENTS.md`, `README.md`, `GLOSSARY.md`). Checked **before the 2026-11-25 merge**, when the
  branch names below were still current. On `main`: 177 refs across 46 files, 10 unresolved
  and all accounted for — 6 name Layer 3 files that exist only on `wip/layer-3`, 2 are `AGENTS.md`
  skill references rather than repo paths, 2 are version strings in a ticket that the pattern mistakes
  for paths. On `wip/layer-3`: 181 refs across 47 files, and the same 4 remain — the two skill
  references and the two version strings.
- `npm run capture` — **20/20 shots pass**, unchanged by panning: every shot sets its camera
  explicitly, and a shot that never pans writes no `tgt`. The last new shot was `layer3-sol-1080p`.
- Sol visual check — `layer3-sol-1080p` shows all eight bodies, the HUD reads
  `v1/0.0.0 · 3 levels` and `G-type · 8 planets · ×1930–18438 real`. Judged on a 1:1 crop after the
  downscaled image suggested the corona hid Mercury and Venus; it does not, which is why the
  presentation constants were left alone (`docs/notes/check-captures-at-1-to-1.md`).
- `npm run probe:live` — `{steps:81, decreases:0, firstRampAt:"step-64", firstFullAt:"step-68",
  handoffSteps:4, maxCount:60000, sceneRows:8}` on isolated port 5201, listener command line proven
  to be the density worktree; the far clamp reads `one galaxy · ×1 real`. Build fingerprint:
  step-80 has 0 px above 0.97 outside the HUD, max 0.8871 at the home star, next 0.7828 at the
  nucleus.
- `npm run probe:watchdog` — rich 45000 → medium 22500, status `ready` (on `566a303`).
- `perception` gate - 6/10 (iteration 1), 7/10 (iteration 2), **8/10 (iteration 3, SHIP)**. The
  density pass is merged as `87ddcc1`; scorecard `gates/gate-layer-3-iteration-3.md`, ledger
  `20261125T021249-a62f2277`. The 12-seed suite and both coverage numbers were reproduced by the
  chair and again by the gate's own flood fill; the two native crop offsets were verified pixel-exact.
- **Not run:** the 1650-class proxy; any mobile or 2560/3840 live loop.
- All of the above were re-run after the iteration-2 fixes on `wip/layer-3`; the earlier
  "not re-run since the docs reorg" caveat no longer applies.

## Open questions

- **Does V1 include many galaxies (4b)?** The owner's stated priority is base structure first; the
  V1 statement still describes one galaxy. Owner's call, not a technical one.
- **Sector angular offset** — the count is settled at 1–6 by size; where slice zero begins is not.
- **Absolute travel speeds** — superseded in shape by ADR-0020 (speeds derive from time anchors), so
  the open question is the **short-trip anchor**, not the long one. A 5 ly hop is seconds at
  week-per-diameter.
- **Galaxy names** — curated real names, generated names, or a mix.
- Should the galaxy shot go into the README now (captioned "in progress") or wait for the Layer 3
  commit? **Answered: shipped**, the README carries the previews.
- Root `LICENSE`: **Answered** - MIT, `LICENSE` at the root (ADR-0017).