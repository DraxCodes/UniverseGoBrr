# Spec — Cairn: a procedural universe explorer

**Status:** draft for review (2026-11-23)
**Directory:** `docs/issues/` (tracked: spec, tickets, gates)
**Decisions:** see `docs/adr/0001`-`0021` (index: `docs/adr/README.md`)

## 1. What this is

A **procedural universe explorer**: a real-time, GPU-accelerated, continuously navigable
cosmos generated from seeds rather than stored. There is no gameplay — no objectives, no
combat, no progression. The product is the *experience of looking*: flying from a galaxy's
spiral arms down to a single lit planet, and finding things worth sending to a friend.

Reference points, in order of usefulness:

- **SpaceEngine** — the closest existing thing, and the bar. Universe-to-surface continuous
  navigation, procedural extrapolation from real data, no gameplay.
- **Celestia** — real data, older, less beautiful.
- **Universe Sandbox** — physics toy; different goal, not a reference.
- **No Man's Sky** — the scale claim, but it cheats: warp between systems rather than
  continuous zoom, and generationally simple planets. Useful for *feel*, not architecture.

Working title: **Cairn** (decided 2026-11-25, ADR-0016; formerly `UniverseGoBrr`).

### Experience thesis

> The universe should feel **vast, legible and alive** — vast because the emptiness is real
> and traversable; legible because every scale has structure you can recognise and name;
> alive because things move, orbit, react and grow while you are not looking.

This thesis is what the `perception` rubric scores against. It outranks feature count.

### Non-goals

- Gameplay mechanics, objectives, economy, combat.
- A server, accounts, or a shared mutable world.
- Mobile and VR (revisit later).
- Full physics simulation (relativity, N-body chaos) — narrative plausibility, not accuracy.
- Landing and walking on planets: **declared slot, super-long-term, possibly never.**

## 2. Platform and performance envelope

| Item | Decision |
| --- | --- |
| Runtime | **Web, WebGPU + TypeScript** (ADR-0001) |
| Distribution | A URL. No install, no account, no assets to download. |
| GPU floor | **GTX 1650 / i5-class**, and AMD/Intel equivalents |
| Dev machine | AMD 7800 XT desktop — far above the floor. The NVIDIA laptop is the **floor proxy** if it is ~1650-class; verify its GPU and keep it in the loop. |
| Integrated GPUs | Must survive on low quality tiers; not required to look good |
| Cross-vendor | **Rendering may differ between AMD/NVIDIA/Intel. Simulation must not.** (ADR-0006) |
| Quality | Auto-probed at startup (GPU + `navigator.hardwareConcurrency`), user-overridable |

Quality tiers from day one, not bolted on: render scale, nebula raymarch steps, atmosphere
sample count, impostor budget. The known 1650-killer is **full-resolution volumetric
nebulae** — budget half-resolution raymarch + upsample + temporal accumulation from the
start.

**Optional deployment target: wallpaper.** Web wallpapers run in an embedded Chromium, so
WebGPU availability is uncertain and must be tested with `navigator.gpu` before it is
offered. Wallpaper Engine uses CEF; Lively Wallpaper uses WebView2 (usually a newer
Chromium). If it works, wallpaper mode is the same app with a different camera policy and a
lower tier — slow drift, capped fps, audio off, pause on maximise — not an architectural
feature. A zero-engineering fallback is a recorded video loop. **Not a design input.**

## 3. Architecture

Five layers, each with its own interface. The rule that keeps the project affordable is that
**emergence never leaks into the universe layer.**

| Layer | Responsibility | Purity |
| --- | --- | --- |
| **Frames** | Nested coordinate spaces; rebasing; camera-relative rendering | — |
| **Universe** | `f(seed, address)` → what exists at a node | Pure, cached |
| **Time** | `f(node, t)` → orbital, rotational and event state | Pure, cheap |
| **Actors** | Ships, civilisations, reactions, growth | Swappable; the only stateful layer |
| **Presentation** | Shaders, LOD, impostors, audio, HUD | Vendor-tolerant |

### 3.1 Frames and precision (ADR-0002, ADR-0008)

Universe span ~10²⁶ m; human detail ~10⁰ m. No single float representation covers both.

- Absolute positions live on the **CPU** only, as a **frame origin + double-precision local
  offset**. A double resolves 10¹³ m to ~1.95 mm; the frame origin sets which floor applies.
- Every frame, the camera is subtracted in **double precision** and only **camera-relative
  float32** reaches the GPU. Rounding happens once, after subtracting; rounding first destroys
  any separation below the float32 step (~16 km at 1 AU, ~1,050 km at 10¹³ m).
- **WGSL has no f64.** Doubles are CPU-only by definition on this platform.
- **int64 cells and automatic rebasing are deferred to Layer 4** (travel between frames), behind
  the `Position` type. Measured: camera-relative rendering alone holds every tested case, so
  the cell API is not designed before it has a consumer.
- The **address is unbounded** — `v1/<i0>.<i1>…` with no fixed depth — so no region is the
  largest and the universe has no edge.
- Depth is a *separate* precision problem: **reverse-Z** with a float32 depth buffer, plus
  layered near/far ranges where needed. It arrives with the first geometry.

### 3.2 Travel (ADR-0003)

Travel tiers are **frame rebases**, and the visual is the mask for the swap. A **tier** is the rung
crossed; a **method** is what you ride across it, and it is **the traveller's choice** (ADR-0019).
**Any method works for any trip** at or above the system rung — the column below says where each is
the *sensible* choice, not where it is permitted:

| Method | Cheapest at (advice) | Effect | Time |
| --- | --- | --- | --- |
| Free flight / sublight | inside one system | continuous, no effect | real time; `t` follows the clock |
| Warp | system → system | star streaks | `Δt = d / v` |
| Transwarp / slipstream | sector → sector | tunnel / slipstream | `Δt = d / v` |
| Hyperspace | galaxy → different galaxy | aperture / hyperspace tunnel | `Δt = d / v` |
| Wormhole | any → any | a mouth, then arrival | **fixed `Δt`**, then instant |

The one hard range rule is **upward**: a trip between bodies of the same system is sublight. Warp is
permitted there but is effectively instant, so it is a convenience rather than a tier.

Vocabulary (and octree levels): **universe → galaxy → sector → system → body.** *Quadrant* is a
synonym for sector in copy, not a separate rung. A sector is an address level, so it is linkable
(ADR-0018); it is an **angular slice** of the disc, and a galaxy has **1–6** of them derived from its
size.
Free flight is preserved inside every frame — and, long term, **free flight is its own speed** (ADR-0021):
sublight inside a system, but a settable speed that can be warp, so a quadrant can be crossed by hand.
It obeys the same `d/v` law, so flying is never cheaper than jumping; it is the same journey played out
continuously. Warping to an arbitrary empty point is
supported, and requires a **navigation compass** (bearing + distance to nearest anchors, a
pin on where you came from, a return breadcrumb) or the void is simply disorienting.

Travel advances `t` by **`Δt = d / v(method)`** (ADR-0010): the distance actually travelled in the
parent frame, divided by the method's speed. Camera gestures are not travel and never advance the
clock; effect duration (screen time) and elapsed time (universe time) are different numbers. A
distance requires every node to have a position in its parent frame, so this also fixes
`placement(seed, address)` as content.

**Speeds are derived from times, never chosen** (ADR-0020). The anchor is how long a crossing should
take; `v = d / Δt_anchor` follows. Because `d` and `v` scale together, **making the universe bigger
changes no crossing time** — so scale is free, and raising speed alone would make the universe feel
*smaller*, not larger. The values in `travel.ts` today are superseded; the size law and the time
anchors must be settled before a new table is written.

**But time is a floor, not the whole of scale.** A universe whose only size cue is "that trip took a
while" reads as slow, not vast. Size must also be carried by evidence visible at rest — nested
structure at every scale, emptiness that is genuinely empty, parallax as you close on something, far
things that look far, and variety among distant things. A screenshot taken while standing still should
already read as big; if scale only shows up during a trip, it is being faked by duration.

**A wormhole is the one exception** (ADR-0019): it costs a fixed amount of universe time whatever the
distance, because the cost is entering the mouth, not crossing the gap. Galaxy-to-galaxy is the first
rung whose *distance* has no answer yet — galaxies are not placed in a root frame — so those trips are
refused with a reason until the universe layer lands (`tickets/06-universe-scale.md`).

### 3.3 Generation (ADR-0005)

`content = f(seed, address)` — pure, no storage, no save file, no database.

Consequences that shape everything:

- Each node must be **evaluable in any order from its address alone** — a planet may be
  visited before its galaxy was ever generated.
- **Determinism is what makes "keep it static" unnecessary**: warp away and look back, and
  the galaxy regenerates identically from its seed. There is no cache to pin.
- Split **structure** (what exists — `f(seed, address)`, cached) from **state** (where it is,
  what phase — `f(structure, t)`, cheap per frame).
- **The seed→content function is public API.** Changing it breaks every shared coordinate.
  Version it from day one.

### 3.4 Density

Truthful *structure*, legible *population*.

- **Stars: realistic.** Local density is ~1 star per 5 ly, which already reads as vast.
- **Rare things: inflated.** Black holes, rogue planets, anomalies, points of interest.
- **Emptiness is the feature.** The void between stars is what sells scale; do not fill it.

### 3.5 Time (ADR-0004)

`state = f(entity, t)`. **Closed form, evaluated at t — never simulated forward.**

- A ship's position is a lerp along a route at `t`. A year of elapsed time costs what a
  second costs.
- A supernova is `phaseAt(t)` plus an expanding remnant radius. Bright phase is days-scale;
  remnant expansion is millennia-scale. Both are useless at 1× and perfect under a
  **scrubber**.
- **Motion** evaluates `t` continuously (per frame, uncached).
- **Structural events** quantise to a **tick** (e.g. hourly) so views cache and shared links
  match exactly.
- Dust: do **not** model drifting dust as a moving object — at nebula scale a week of drift
  is sub-pixel. Model changing **illumination and filament structure** on long timescales.
- Orbit, rotation, axial tilt, ship transit and stellar events are all the **same**
  mechanism. `t` is not an extra feature; it is required for orbits anyway.

### 3.6 Authored overrides

A small registry of **hand-authored nodes keyed by address**, checked before the procedural
generator. One mechanism serves two wants: real nebulae (Orion, Carina, Eagle, Crab — real
positions, distances and shapes) and a correct Sol system. Everything not in the registry
stays procedural. The registry is data, versioned like any address, not a special code path.

### 3.7 Actors (ADR-0006, proposed — requires council)

Two tiers, one interface:

- **Tier 1 — event fold.** `state = f(route, eventsAlongRouteBefore(t))`. A scan over a
  finite, sparse event list, with causal depth capped (~8 hops). Looks emergent; remains
  deterministic, shareable and scrubbable; costs O(events). Ships swerve storms and arrive
  damaged; civilisations follow analytic growth curves modulated by discrete impacts.
- **Tier 2 — deterministic simulation.** Fixed timestep, seeded PRNG, replayable, periodic
  state checkpoints so `stateAt(t)` replays from the nearest snapshot. Genuine feedback
  loops. **CPU only** — GPU transcendentals are not bit-identical across vendors.

Build Tier 1 first, behind the interface. Tier 2 may never be needed.

## 4. Sharability

A coordinate is **`version/address`**, and optionally **`version/address/epoch`**.

- **Visit now** — the living universe; the thing may have moved on.
- **Visit as found** — scrub to the epoch and see exactly what the sharer saw.

These are two positions on one scrubber, not two features. A shareable **tour** is just a
list of `(address, epoch, dwell)` — a JSON array of strings, no server.

## 5. Extension slots (declared now, filled later)

The content record returned by the universe generator must have **named, typed slots**, even
when empty. This is the cheapest insurance in the project: adding a Dyson swarm later must be
a new slot filler, not a refactor.

| Slot | Contents |
| --- | --- |
| `bodies` | single / **dual / triple** star systems; **artificial many-star systems** (e.g. ten stars held in a deliberate configuration by a civilisation — see below); rocky, gas and ice planets; moons; **asteroid belts** where the system supports them; **rogue planets** and free-floating asteroids in interstellar space; comets; systems deliberately configured to **mirror Sol** |
| `anomalies` | nebulae (emission, reflection, planetary, dark); **black holes** at galactic centres plus a sparser halo population; wormholes; gas and dust storms |
| `stellarLifecycle` | main sequence → collapse → supernova → white dwarf / neutron star / black hole; remnant shells that **expand with `t`** |
| `actors` | alien ships in transit, probes, traffic; **course corrections** and **storm damage** |
| `civilisations` | species, tech level, growth and expansion state; **tech-worlds** whose entire surface is computational substrate |
| `megastructures` | Dyson swarms, Dyson spheres, ringworlds, orbital habitats |
| `artefacts` | Voyager 1/2-style probes deep in solar systems, derelicts, ruins; satellite constellations around Earth-like worlds |
| `surface` | terrain generator — **unfilled until landing** |

Named longer-term goals captured here so they are not lost: tech-worlds whose entire surface
is computational substrate; alien megastructures; ships transiting systems; human probes deep
in solar systems; civilisations that grow and expand; course corrections and damage from
storms and supernovae; stars caught mid-collapse, and the same star a week later when it has
become a remnant.

**Artificial systems.** A system may be flagged `artificial`, which overrides the natural
stellar distribution. A ten-star system is the flagship case. Note that it is *dynamically
unstable* under real orbital mechanics — which is the point: the configuration only holds
because a civilisation is actively maintaining it. The instability *is* the story, and the
physics gives the fiction its teeth. Implementation is not a special code path: it is
`bodies` with many stars plus the `megastructures` and `civilisations` slots filled in.

## 6. Evaluation

- Rubric: **`perception`** (the seam default). The product is a perception problem.
- The gate needs evidence: a **capture harness** with fixed seed + epoch + camera, at the
  seam's desktop widths — **1920, 2560 and 3840** CSS px (1080p, 1440p, 4K), plus one
  1920 CSS px shot at DPR 2 for a 4K display at 200% OS scaling. Mobile is a non-goal
  (§1); the app is full-bleed and has a fullscreen toggle, not a mobile layout.
  **One look, dark** (ADR-0007): there is no theme switch and no light variant. Light in a
  frame is emissive — suns, nebulae, supernovae — and reads only against darkness. The
  harness captures with the OS preference set to light to prove the page ignores it. Build
  the harness early — it doubles as the dev loop.
- Floor checks (`npm run build`, `npm test`) must exist before the first gate.
- **Layer 3 adds a required live-loop evidence leg.** The still set is pinned frames and cannot
  show a transition, so the system→galaxy handoff is evidenced by a continuous wheel run
  (`npm run probe:live`) reporting one dominant read per step, no double-exposure and no pop.
  The slice's experience thesis (three-second read, no-input path, the good moment, the friction
  to avoid) is in `tickets/04-layer-3-star-field-and-galaxy.md`, and the gate scores against it
  plus the rubric.

### Lineage policy for the experience gate

The model that scores perception must be a **different lineage from the seat writing the
code**. Uncorrelated error is the value, not superiority. This is accepted as policy now;
the *binding* is deliberately deferred until a **critic probe** on real renders (after
Layer 2) can pick a model by whether it names the flaws a human eye sees.

- `hillclimb.blindspot` is bound via the seam's `visualReview.model`; rebinding is one line.
- `council.experience` is bound to an agent in `opencode.json`; also project-owned.
- Known trap: the probe's `image` case sends a 1×1 PNG and fails regardless of model
  capability (`docs/notes/probe-image-case.md`). Fix it in the base repo — `.opencode/tools`
  is generated and must not be edited here.

## 7. Roadmap

| Layer | Deliverable | Why this order |
| --- | --- | --- |
| 0 | **Dev loop** — Vite, HMR, shader hot reload, seed+epoch in URL, pinned `t`, capture harness; `open: false`, `strictPort: true`, no module-scope side effects (`docs/notes/vite-multiple-tabs.md`) | Multiplies everything after it |
| 1 | **Camera-relative precision + unbounded address** — double subtraction before float32, `Position` type, versioned address; cells and rebasing deferred to Layer 4 (ADR-0008) | Skip it and every later layer inherits a broken coordinate system |
| 2 | **One procedural star system** — star shader, orbits, lit planets, atmospheres, rotation | First screenshot; proves the foundation |
| 3 | **Star field + one galaxy** - instanced impostors; a cell-keyed local field plus a disc/bulge/arm population; `displayRadiusM` compresses emptiness, not structure; the crossfade order is rings → point → arm → disc, with the home star findable at 1:1. Council: `council-layer-3.md`; brief: `tickets/04-layer-3-star-field-and-galaxy.md`. **Sol (§3.6) is built** as the first authored node, at `v1/0.0.0` (ADR-0009), captured as `layer3-sol-1080p`. The address HUD **moved to Layer 4** - it is half of the navigation compass. | Scale made real |
| 4 | **Travel tiers** - frame rebases, warp effects, navigation compass. Council **convened and decided 2026-11-24** at `014c312`: **A, address-origin frames, rebasing on tier crossings only**; a tier crossing is a **journey**; **time advances by `d / v(method)`** (ADR-0010), which entails `placement(seed, address)`; the focus rebase is gated on the approach probe. **The address grid is the world and the picture is a view of its occupied cells** (ADR-0011), so every drawn star is visitable and a galaxy is keyed on its own level. Thesis and dissent: `council-layer-4.md`; brief: `tickets/05-layer-4-travel.md`. | The core loop |
| **4b** | **Universe scale** - the missing rung. Sectors become an address level (ADR-0018), galaxies get a **root layout** so a galaxy-to-galaxy distance exists, a **galaxy variation law** (arms, pitch, bar, bulge, halo, dust, colour) so a field of galaxies does not read as one law ten times, galaxy naming, and a multi-galaxy render set **selected by apparent brightness** while addressable density stays full. Travel becomes a choice priced per method (ADR-0019). Brief: `tickets/06-universe-scale.md`. | **The expansive-universe step, and the owner's stated priority.** It was never owned - see the ticket's opening section |
| 5 | **Nebulae** - volumetric beauty pass, real + procedural populations | Where `perception` earns its keep |
| 6 | **Planet surfaces** - cube-sphere, terrain LOD, ground atmosphere | Hardest; possibly never |

**Why `4b` and not a renumber.** The row is inserted rather than shifting nebulae to 5 and surfaces to
6, because "Layer 5" means *the beauty pass* in ADR-0015, several gate documents and `status.md`.
Renumbering would make every one of those references quietly wrong, which is the same silent-drift
failure that lost the universe step in the first place.

**`4b` is structural, not cosmetic.** Its sequencing reason is not taste: the tier masks (the last L4
piece) hide a frame swap inside one galaxy, and the universe layer is what makes a swap *between*
galaxies exist. Nebulae are beauty and can wait indefinitely; this cannot, because without it the
product's own V1 statement ("a universe", not "a galaxy") is unmet.

Nebulae get both treatments: **hand-placed real ones** (Orion, Carina, Eagle, Crab — real
positions and distances, procedural volumetric shells) for recognition, plus a **procedural
population** by class (emission, reflection, planetary, dark) for abundance.

## 8. Open questions

1. **Actors layer** — Tier 1 only, or commit to Tier 2 simulation? *Expensive to reverse.
   Requires a council before implementation.* (ADR-0006 is `proposed`.)
2. **Real astronomy scope** - does our own solar system exist, correct, alongside the
   procedural population? **Answered: yes.** Sol is the first authored node, reserved at
   `v1/0.0.0` (ADR-0009); everything not in the registry stays procedural.
3. **Time base** — wall clock is assumed. Confirm that shared `epoch` coordinates are
   acceptable as the stability mechanism, rather than a frozen universe.
4. **Landing** — confirmed super-long-term. Revisit only after Layer 5.
5. **Naming** - **Answered: "Cairn"** (ADR-0016). The working title `UniverseGoBrr` is retired.
6. **Universe scale** - does V1 include many galaxies (roadmap row 4b), or stay "one galaxy, complete
   loop"? The owner's stated priority is base structure first, which argues for including it. What a
   *sector* is geometrically, and how many a galaxy has, is also still open (ADR-0018 fixed the rung,
   not the shape). Brief: `tickets/06-universe-scale.md`.
7. **Absolute travel speeds** - **Answered in shape (ADR-0020): speeds are derived from time anchors,
   not chosen**, so scale is free and the current `travel.ts` table is superseded. What remains open
   is the **short-trip anchor**: at a week-per-diameter, a 5 ly hop costs seconds. Derivation in
   `tickets/06-universe-scale.md`.
8. **Galaxy names** - a curated real-name list, procedurally generated names, or a mix? Deterministic
   either way, and never in the link (ADR-0008).
9. **Free flight and time acceleration** - ADR-0021 makes free flight a settable speed. It is **long
   term and unscheduled**, and it needs time acceleration to be usable across a galaxy (7 real days at
   ×1). Open: whether the address changes per boundary crossed or only on landing, and whether
   free-flight speed rides in the link.

## 9. Idea backlog (captured, not committed)

All of these are **architecturally cheap** — each falls out of a decision already accepted —
but cheap is not free: each costs integration time and taste time. None forces a
rearchitecture. Sequenced, not simultaneous.

| Idea | Why it's cheap | Lands at | Effort |
| --- | --- | --- | --- |
| **Trail ribbons** — an entity's past *and future* path drawn as a faint ribbon | Closed-form `t` gives any point on the path | Layer 2+ | 1–2 d |
| **Ghost of the future** — preview where something will be | Same | Layer 4 | 1 d |
| **Long-exposure photo mode** — integrate over a `t` window | Frame accumulation; no new state | Layer 2+ | 2 d |
| **Tours and films** — `(address, epoch, dwell, rate)` lists | Coordinates are strings | Layer 4 | 1–2 d |
| **Your own constellation** — visited places, named, connected | Local storage only | Layer 4 | 1–2 d |
| **Postcards** — link with camera orientation preserved | URL state | Layer 4 | 0.5 d |
| **Multi-wavelength views** — radio / IR / X-ray renderings | Rendering variant of existing structure | Layer 5 | 3–5 d |
| **Gravitational lensing** around black holes | Post-process using known positions | Layer 5 | 2–3 d |
| **Sol, correct** - real solar system as an anchor | Authored override (§3.6) | **shipped** | 2-3 d |
| **Procedural audio** - hum driven by density and proximity | Web Audio, no assets | Layer 4 | 2-3 d |
| **Cosmic address HUD** - postal address, each line clickable to zoom out | Reads the frame hierarchy; it is half the navigation compass, so it ships with travel | Layer 4 (moved from Layer 3) | 1 d |
| **Breadcrumb + Home** — local trail, one-button return | Local storage only | Layer 3 | 1 d |
| **Seed-varied arm count** - 2-4 arms instead of a fixed two | `armStrength` already takes an offsets list; only the legibility metric needs to measure the same `m` | **4b** (folded into the galaxy variation law) | 0.5-1 d |
| **Scale silhouettes** — human-height reference objects | Presentation only | Layer 2 | 0.5 d |

Priority when the choice arises: **gravitational lensing**, **procedural audio**, **trail
ribbons** — highest wonder per unit of effort. Nothing here starts before Layer 2 looks
beautiful.

### Captured, but not cheap: eight-armed galaxies

Recorded 2026-11-24 because it was discussed and would otherwise be lost. It breaks the
"architecturally cheap" premise above, so it is not in the table.

The Layer 3 reference image
(`docs/reference/arm-legibility-eight-arm-pointcloud.png`, confirmed
8-armed by the user) shows that arm legibility in *dots* is achievable — but at a star count orders
of magnitude above our 45 000. Three things stand between us and eight arms, and they have to move
together:

1. **The metric.** `armModulation` measures `cos(2·azimuth)`. An eight-armed population reports
   `contrast ≈ 0`, so the reported contrast and the "trigger on arm contrast" property both go
   false. The DFT must measure the generated `m`, and `ARM_CONTRAST_FULL` must be re-baselined.
2. **The budget.** 45 000 disc stars over 8 arms is ~5 600 per arm, against ~22 500 at m=2. At that
   density the lanes stop reading as gaps between chains of dots and start reading as gaps between
   nothing. A larger footprint or a higher count would be needed, and the 1.5× fill budget is
   already argued, not measured.
3. **The envelope.** §7 and issue 04 say 2–4 arms. Eight is a change to this spec, not a parameter.

If the appetite is real, do the in-envelope step first — seed-varied 2–4 arms above — because it
exercises the same metric generalisation on a population the budget can carry.