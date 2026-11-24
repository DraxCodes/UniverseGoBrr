# 04 — Layer 3: star field and one galaxy

**Type:** brief (approval before code) — **approved 2026-11-23** in session from the council
**Status:** not started; this brief is the plan
**Blocks:** Layer 4 (travel tiers), which needs something worth leaving and a galaxy to leave it in
**Implements:** ADR-0002 (depth), ADR-0005 (pure, versioned content), ADR-0007 (one dark look),
ADR-0008 (`Position`, camera-relative upload)
**Council:** `../council-layer-3.md` — proposals, critiques, register, decision

## Deliverable (spec §7, row 3)

**Star field + one galaxy, so scale is made real.** Impostor stars, spiral structure, and a
continuous zoom from the Layer 2 orrery out to a galaxy whose arms you can read. The system is
still there, still findable, when the galaxy resolves.

Decided with the user: **galaxy only.** Sol (§3.6) and the cosmic-address HUD/breadcrumb are
*not* in this pass; they stay on the Layer 3 row of the spec and move to a later brief.

## What exists today

`src/universe/system.ts` generates one system in real metres and state from `t`;
`src/render/system-scene.ts` converts it to display units (1 unit = outermost orbit), subtracts
the camera in doubles, and hands float32 to `src/gpu/scene.wgsl`. There is one camera, one
scene pass, a reverse-Z depth buffer, a two-pass star billboard (opaque core + additive
corona), UV-sphere planets and orbit rings. The camera orbit/zoom controls are framing, not
travel, and are clamped at 0.08–14 × the frame scale. Nothing above the system exists.

## D1 — One frame, no rebase

The galaxy is **not** a second camera frame. Layer 3 stays in one frame, one camera, one
`Position` chain; ADR-0003's rebase remains Layer 4's decision and is not pre-empted. The
galaxy is a *level* in the address vocabulary (`universe → quadrant → sector → system → body`,
spec §3.2); the system is its child. **The display mapping is rendering, not address** — changing
it must never rewrite a link.

Why: a rebase needs a mask, and Layer 3 has no travel to mask with. Spending the slice on the
mechanism Layer 4 owns would buy precision nobody needs yet and lose the one-camera continuity
the illusion rests on. Recorded dissent: the shape seat would exercise a rebase here to
de-risk Layer 4.

## D2 — The map: identity locally, compression on emptiness

**Refined during planning (2026-11-23), before any code.** The council asked for a monotone
`displayRadiusM(realM)` that is identity below ~10¹³ m *and* near-identity across the galaxy
body. Those clauses cannot both hold with compression in between: a monotone map that is
identity at both ends has no room to compress, so "identity at the galaxy" has to mean
**slope 1**, not level, and a level-compressed map then makes the wheel crawl through the void
(the control variable and the observed distance disagree).

What the council actually wanted is preserved, and now specified as: **compress the traversal,
never the structure.** No position is warped; every object stays at its real position and every
upload stays camera-relative.

`src/render/scale.ts`, pure and GPU-free:

```ts
notchFactor(realDistanceM: number, base: number): number
```

Contract, each clause a test:

1. **Total and finite on [0, 1e30]** (`MAX_POSITION_M`); no NaN, no Infinity.
2. **Constant near the system**: `notchFactor(d) === base` for `d <= SYSTEM_EXTENT_M` (10¹³ m),
   so Layer 2's controls behave bit-identically and the orrery is untouched.
3. **Constant again before the galaxy**: `notchFactor(d) === base` for `d >= GALAXY_RADIUS_M`
   (5×10²⁰ m), so the wheel rate is identical on both sides of the crossfade — the "one wheel
   rate across the joint" clause.
4. **Bounded and continuous** in between: a smooth bump, never a step, with a declared maximum
   (the compression ratio). Continuity is asserted by a log-sweep test, not by eye.
5. **Compression is real**: the number of notches from the system's outer clamp to the galaxy
   radius is bounded (asserted), where the constant-rate path would take ~150.
6. Runs **CPU-side**; the wheel is the only consumer. No shader sees it.
7. **Versioned** like `SYSTEM_VERSION`.

Positions are never remapped, so the risk seat's totality and hostile-camera concerns are
answered by construction: `d` is only ever a distance, and a crafted `cam` at 1e30 m reads a
finite factor. The distortion is reported in the existing `×N real` HUD row — not a second
disclaimer.

## D3 — Two populations, both deterministic

`src/universe/galaxy.ts`, structure only, no GPU:

- **Local field** (~5k at the rich tier, within ~100 ly): keyed to the **address's cell**, not
  the camera. A camera at 1e30 m must not ask for a neighbourhood the generator has never
  heard of; keying on `cam` is a crafted-URL bug. True density, so parallax is real and the
  local field can be checked against the spec's ~1 star / 5 ly.
- **Disc field** (~40k at the rich tier): bulge + 2–4 arms as **density modulation**, log-normal
  scatter, real galactic metres. Not drawn curves: the arm is where the generator puts more
  stars.
- Both from one seeded PRNG keyed `fnv1a(seed | address | "galaxy" | GALAXY_VERSION)`, in any
  evaluation order (ADR-0005).
- **Counts are compile-time constants per tier** (rich/medium/low), never a function of seed,
  address or URL. A link must not be able to ask for a billion stars.
- The void stays empty. "Emptiness is the feature" is a constraint, not a taste.

## D4 — Crossfade: the order is the experience

The handoff is the deliverable, so it is specified, not left to the renderer:

**rings fade → the system collapses to one point → that point sits in an arm → the disc
resolves.** Galaxy-legible-before-system-is-a-dot is the failure.

- `buildSceneFrame` emits one **`lod`** value per system; every pipeline consumes it. No CPU
  mode switch and no per-pipeline threshold.
- The ramp is triggered by **galaxy legibility (arm contrast crosses the readable threshold)**,
  not by the system's on-screen radius. The pixel-radius trigger is system-first and produces
  the astrolabe frame the council named.
- The system's geometry fades inside the band with the existing `detail` ramp; the star's glare
  quad continues as the impostor.
- **One wheel rate across the joint.** A rate change at the handoff reads as a cut.
- The crossfade must complete **well above** the f32 camera-subtraction floor (once a star's
  separation falls below the f32 quantum it locks to screen centre — the naive collapse coming
  back as the galaxy pass's zoom floor). A test pins the bound.

## D5 — The home star has identity

A statistical field of 40k additive points does not let the viewer find *their* star. The
system's star keeps a **brightness floor and its own hue** through the crossfade, so it is one
point the eye can still find at 1:1. Acceptance: a person can put a finger on it, unaided —
the experience seat's findability test.

## D6 — Budget and recovery

- ≤60k impostors total at the rich tier (5k local + 40k disc + margin); tier counts compile-time.
- Additive fill ≤1.5× at 4K; **halo radius is the first knob**, then count.
- **Frame-time watchdog drops a tier** when frames run long, instead of stalling into a TDR.
- `ugb:device-lost` keeps its fatal panel; an automatic full rebuild is recorded as a follow-up,
  not built here.
- **The 1650-class proxy is not available this session.** The budget is argued, not measured.
  The gate must not claim floor performance; the laptop handoff run is the next verification
  step and is named in the evidence table.

## D7 — Static this layer

`t` does not rotate the galaxy: a truthful rate (≈10⁻⁵ °/s at galactic scale) is invisible, and a
visible rate is a lie; vendor-divergent transcendentals at `t` up to 10²⁰ s are an extra hazard
(spec §3.7). Orbits already carry "alive". Recorded dissent: one CPU-reduced mod-2π phase
uniform was offered by the shape seat; deferred with the galaxy's motion to Layer 4.

## D8 — No new HUD surface

The existing `×N real` row carries the galaxy factor. No address HUD, no breadcrumb, no theme,
no new panel. The only new DOM is none.

## Evidence plan

1. **Pure tests** (no GPU): determinism for identical inputs; difference for a different
   address; monotonicity and totality of `displayRadiusM` at 0, 1e30 and across both seams; the
   bounded-slope clause; count constants independent of seed/address/camera; local-field
   density within a stated band; the crossfade/quantum bound.
2. **Stills** in `capture/shots.json` at the seam's 1920/2560/3840 + DPR 2: `layer3-galaxy`
   with the disc inclined, arm/inter-arm contrast visible, no stipple mush and no visible
   population boundary; a 4K arm-edge crop; the home star findable at 1:1.
3. **Live handoff loop** (`tools/live-probe.mjs`, extended): one continuous wheel run across the
   handoff at 1080p, reporting one dominant read per step, no double-exposure and no pop. This
   is the deciding evidence; the still set cannot show a transition.
4. **Watchdog evidence**: force a long frame and show the tier drop, not a stall.
5. **`perception` gate** at 8/10 against the thesis in spec §7, after the first frame renders.
6. **Not run / not available**: the 1650-class proxy pass; any mobile or 2560/3840 live loop.

## Non-goals

Sol and authored overrides; the address HUD/breadcrumb/Home; travel tiers, warp or tunnel
effects, the navigation compass; a second galaxy or the Local Group; nebulae; planet surfaces;
atlas sprites (option C) unless A aliases at 4K; galactic rotation; any new dependency.

## Risks, stated plainly

- **The galaxy can read as a diagram**, exactly as the orrery could: compression, a flat-on
  camera, symmetric arms or uniform sprites each push it there. The fix is presentation and the
  order, not more stars.
- **The compressed map is a documented lie** and must stay monotone under a hostile URL; the
  bounded-slope clause exists because "compress the void" naively means "flatten the slope to
  zero", which is non-monotone and can put NaN or a lock-to-centre on screen.
- **The handoff is the only place the illusion can break**, and stills cannot prove it. If the
  live loop shows a pop, the answer is the order and the rate, then a masked rebase before
  Layer 4 — in that order.
- **The floor is unmeasured.** Do not let a green dev-machine gate become a claim about a 1650.

## Implemented — and where the plan met the pixels

Recorded 2026-11-23, after the first frames and three blindspot passes. These are the decisions
the plan did not fix, with the measurement or the failure that forced each one.

- **The arms needed the generator, not the shader** (D3 boundary crossed with the user's approval).
  The first population put 0% of stars in the inter-arm region, so the rendered m=2 amplitude was
  0.11 and the disc read as an oval. `generateGalaxy` now does bounded rejection sampling **into**
  the arm with an explicit `INTER_ARM_FRACTION = 0.08` and `ARM_FLOOR = 0.05`; rendered m=2 is
  0.30–0.35 at the shipped framing (measured 0.334 / 0.313 / 0.302 at 2.6 / 3.0 / 3.4 R).
  `GALAXY_VERSION` is 2. Counts, determinism and the tier-prefix
  layout are unchanged.
- **Footprint, not count, controls stipple** (D6). `GALAXY_STAR_MIN_PX 3.0`, `MAX 5.0`,
  `GALAXY_GAIN 0.3`, all scaled by `viewportHeightPx / 1080` so 4K keeps 1080p density. Mean
  impostor coverage is ≈1.1× the frame, inside the 1.5× budget; grain fell from 0.41–0.44 at
  footprint 2.4/4.0 px to 0.33 at the hero camera when the footprint widened. The shader's softened profile (`0.7·(1−d)^2.2 + 0.3·(1−d)`)
  is what lets the wide sprites merge into bands.
- **The local field must collapse into the home star** (D4/D5, found by the blindspot pass).
  5 000 local stars inside 100 ly project within a single pixel from galaxy distances; at their full
  footprint they stacked into a hard-edged 16 px white disc *larger* than the home star's own glare,
  and two independent reviews called it out. `writeGalaxyFrame` now fades the local block by the
  field's projected size (`LOCAL_CONVERGENCE_MIN_PX 1.5 → FULL_PX 8`), so the orrery's star is the
  point that survives. The disc block is untouched.
- **The home star keeps its identity by handoff, not by size** (D5). `STAR_MIN_PX` is 3.4 px and
  `fs_star` multiplies the corona by up to 1.9× over `smoothstep(0.45, 0.85, lod)` as the opaque
  core fades — at lod 0 the factor is exactly 1, so Layer 2's star is bit-identical. Measured at
  1:1, the star is a warm amber point (luminance ≈0.55, hue 172,136,95) against a field of
  0.2–0.37, and it is the brightest single point in its neighbourhood.
- **The legibility window is narrow in notches, wide in distance.** `lod` crosses 0.02→0.98 in two
  120 px wheel notches because the void schedule covers ~40% of the distance per notch; a trackpad
  delivers many smaller deltas. The probe reports `decreases: 0`, no double exposure and one scene-row
  swap. The trigger remains arm contrast, not pixel radius.
- **Composition is what it is.** The camera always looks at the home star, so the disc centre
  projects ~150 px above frame centre and the lower third stays empty. Chosen deliberately in
  preference to a face-on (diagram-like) framing; recorded here so the next layer's authored
  camera does not rediscover it.