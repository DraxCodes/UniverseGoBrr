# Council — Layer 3: star field + one galaxy

**Date:** 2026-11-23
**Fixed point:** `396e834` (master; the four Layer 2 gate nits are closed)
**Runs once for this decision.** The hillclimb gate answers "is it built well enough?" later.

## 1. Question

**How does Layer 3 render a star field and one galaxy, and how does the camera reach the
galaxy — as a compressed zoom inside the existing frame, or as the first frame rebase?**

Decided with the user before this council:

- **Slice is galaxy-only.** A correct Sol (§3.6) and the cosmic-address HUD/breadcrumb are
  *out* of this pass. The deliverable is the one spec §7 calls "scale made real".
- The four Layer 2 nits are fixed and committed separately (`396e834`), not folded in.

## 2. Constraints (cannot move)

| Constraint | Source |
| --- | --- |
| Web + WebGPU + TypeScript; **GTX 1650 / i5-class floor**, AMD/Intel equivalents | ADR-0001, spec §2 |
| **No assets to download.** A URL, procedural only; the seed→content function is public API and versioned | ADR-0005, spec §3.3 |
| Absolute positions are CPU doubles; camera-relative float32 only reaches the GPU; **WGSL has no f64** | ADR-0008, spec §3.1 |
| **One look, dark.** Light in a frame is emissive | ADR-0007 |
| **Layer 4 owns travel tiers, frame rebases and the compass** | ADR-0003, spec §3.2 |
| Layer 2 explicitly deferred the **LOD/impostor handoff to Layer 3** | issue 03, Non-goals |
| Quality tiers exist from day one (render scale, impostor budget) | spec §2 |
| Perception is the rubric; the gate scores at 1920/2560/3840 | spec §6 |

## 3. Non-goals

Sol; the address HUD, breadcrumb and Home; warp/tunnel effects and the compass; a second
galaxy or the Local Group; nebulae; planet surfaces; mobile/VR; any new runtime dependency.

## 4. What would settle it

1. A stated coordinate mapping from system metres (10¹¹–10¹² m) to galaxy scale (~10²¹ m)
   that is monotone, testable in doubles, and does not pre-empt Layer 4's rebase decision.
2. A `perception` gate at 8/10 on new stills at the seam's three widths **plus** live-loop
   evidence that the system→galaxy zoom has no pop (the still set cannot show a transition).
3. A determinism test: the same `(seed, address)` yields the same star population, in any
   order, with no storage.
4. A budget argument for the 1650 floor: how many impostors, at what overdraw, at what tier.

## 5. Options brief

The project has no rendering dependency and should keep it that way: everything is
hand-written WebGPU + WGSL, and Layer 0–2 already share `src/gpu/noise.wgsl`. **Portfolio
check:** repeating that choice is deliberate — a third-party galaxy library would be the only
asset-shaped thing in the project and would break the URL-only promise. No new dependency is
proposed by any option, so supply-chain/licence risk is N/A for all four.

| # | Option | Shape | Cost | Risk |
| --- | --- | --- | --- | --- |
| **A** | **Boring default — instanced billboard impostors** | CPU population from `f(seed,address)`; one instanced camera-facing quad per star, additive, reusing the Layer 2 glare field | Lowest; one draw call; proven shader | Stars are decals; needs a population budget and LOD cull |
| **B** | **Minimal — point-list cloud** | Raw point primitives, thousands | Lowest still | 1 px locked, aliases, reads as static noise — weakest on `perception` |
| **C** | **Modern default — instanced quad + procedural atlas** | One instanced pass, sprite shapes (glow/spike) in a procedurally generated, mipmapped atlas | Medium; more art direction | Memory + mip cost; risk of looking like stickers |
| **D** | **Wildcard — raymarched emissive galaxy volume** | Spiral arms as a volume you fly into | Highest; a Layer 5-scale subsystem | The 1650 floor is the stated GPU risk; overdraw is unbounded |

Dated sources: **unverified by this council.** No external claim is needed to choose between
these — they are local implementation shapes, and the only numbers used (local stellar
density ~1 star / 5 ly; galaxy diameter ~10⁵ ly) come from the project spec §3.4, not a live
source. If a seat relies on an external benchmark it must mark it `unverified`.

## 6. Trade-off rows (each seat takes a position, not "it depends")

| Trade | What it buys | What it costs |
| --- | --- | --- |
| Impostor vs point vs atlas vs volume | visual quality per draw call | fill-rate, memory, art time, floor risk |
| Same frame + compressed mapping vs first rebase | Layer 4 stays free; one camera | the mapping is a documented lie that must be monotone and reported |
| Truthful local density vs stylised spiral | the spec's "emptiness is the feature" | a stylised spiral is prettier sooner and a lie later |
| One galaxy vs galaxy + Local Group hint | focus; one surface to gate | loses the "there are others" read |
| `t` drives galactic rotation vs static | "alive" (thesis) | another moving thing to verify |
| Star budget | floor safety | richness at galaxy scale |

## 7. Chair's own proposal (written before the seats, so the chair is a participant)

**Option A, in the existing frame, with a monotone compressed radial mapping.**

- **Population:** generate ~40–60k stars (tier-scaled) in a bounded neighbourhood from
  `fnv1a(seed | address | "galaxy" | version)`, in the galactic disk with a bulge, 2–4 arms
  and log-normal scatter, so structure is truthful and the void stays empty. Stars are
  camera-facing quads with an additive core+halo reusing the Layer 2 star field; no atlas.
- **Mapping:** one pure function `displayRadius(realM)` — monotone, piecewise-smooth, built
  on the same `a^0.55`-style compression the orrery already uses for orbit spacing, extended
  to a log segment between 10¹³ m and 10²¹ m. The HUD prints the factor, as it already does
  for bodies (`×N real`). No rebase, so ADR-0003 and Layer 4 stay undecided.
- **Continuity:** the system's bodies and the galaxy's stars are all submitted as
  camera-relative display units in one scene pass; the handoff is a crossfade over ~0.6 of a
  decade of zoom, not a cut.
- **Why:** cheapest at the floor, reuses the only proven shader, keeps the public API small,
  and is reversible: if the mapping proves wrong, the population and the atlas/volume swap
  in behind the same generator.
- **What would change my mind:** a demonstration that the compressed mapping makes the
  galaxy read as a diagram (the orrery's own stated risk) or aliases at 4K, or a measured
  floor failure — then option C or a second frame wins.

## 8. Seat proposals (round 1, unedited summaries)

### Shape — `plan-architect`

Option A, one camera, one new pure map `displayRadiusM(realM)`: monotone, C1, radial only,
angle preserved. Identity below ~10¹³ m (Layer 2 bit-identical), compression across the
interstellar void, near-identity across the galaxy body (10²⁰–10²¹ m). **Compression is spent
on emptiness, not structure**, so pitch and disc geometry stay truthful and the population is
generated in real galactic metres. Camera-independent, so display positions bake once per
`(seed, address)` into a galaxy-centred f32 buffer (~10⁶ units). Two populations: ~5k local
stars within ~100 ly (true density, parallax) and ~40k disc/bulge/arm stars from a density
model. The map lives in rendering, not the address, so changing it never rewrites a link.
LOD: rings already fade; planets fade to a disc over ~0.5 decade using the existing `detail`
ramp; the star's glare quad *is* the impostor and never fades. The crossfade lives in one
field: `buildSceneFrame` emits a per-system `lod` consumed by each pipeline, no CPU mode
switch. ≤60k impostors, fill ≤1.5× at 4K, counts 20k/12k/6k by tier. **Static** galaxy.

### Experience — `quality-gatekeeper`

Option A, not narrowly. B fails legibility exactly as Layer 2's inner planets did; D is
Layer 5-scale with unbounded overdraw; C is a later swap behind the same population. The
chair's A is right in shape and under-specified in the deciding place: **the order of the
handoff.** Rings fade → star collapses to one point → that point sits in an arm → disc
resolves. *Galaxy-legible-before-system-is-a-dot is the failure.* So is a flat-on camera,
symmetric arm pitch, uniform sprite brightness, a visible population boundary, and any wheel
rate that changes at the handoff. Three-second read: **"there is something above the orrery and
I am inside it."** Truthful structure with a presentational floor: seed picks arms/pitch/bulge,
brightness range and arm contrast are art. `t` drives bounded **pattern rotation**, not
per-star Keplerian shear. Evidence that earns an 8: a live zoom-loop capture across the
handoff, one dominant read per step, no double-exposure, no pop; stills at three widths + DPR 2
with the disc inclined; a 4K arm-edge crop; **a findability test** — a viewer can point at the
system's star inside the galaxy at 1:1, unaided.

### Risk — `security-auditor`

Top failure mode: additive impostor overdraw on the floor GPU with no recovery path. (It
claimed no `device.lost` listener; **withdrawn** in round 2 — `device.ts` dispatches
`ugb:device-lost` and `main.ts` shows the fatal panel. The gap is recovery, not detection.)
The day-one "impostor budget" must be a real code path, not a tier constant. A, C as named
fallback, D vetoed. Same frame, no rebase, but the map is a precision hazard: it must be
**total, finite and monotone on [0, 1e30]**, CPU doubles, versioned like `SYSTEM_VERSION`.
Counts must be compile-time constants per tier, never a function of seed/address/URL, or a
crafted link is a denial of service. Add a frame-time watchdog that drops tier. Bounds already
hold (`MAX_POSITION_M = 1e30`, `MAX_TIME_S = 1e20`, address ≤900 chars / 64 levels); new bounds
are the count constant and totality tests at 0 and 1e30. **Static**, not `t`-rotated: sin/cos
at t up to 10²⁰ s is meaningless and vendor-divergent in WGSL unless the phase is CPU-reduced
mod 2π.

## 9. Critiques (round 2)

- **Shape → experience:** their order inverts my `lod` ramp, which fires on the system's pixel
  radius — system-first, the exact failure they name. Their fix lands in my code: trigger the
  ramp on **arm contrast**, not pixel radius. Their minimum-pixel-footprint demand *is* the
  overdraw driver on the floor.
- **Shape → risk:** totality is compatible, not conflicting — identity segments are the splice.
  But "camera-local population" is withdrawn: a `cam` at 1e30 asks for a neighbourhood that has
  no population, so the local field must key to the **address's cell**, not the camera. Also
  withdrawn: "near-identity across the galaxy body" becomes a **bounded minimum slope**, or a
  hostile camera makes the segment non-monotone.
- **Experience → shape:** inner-disc inflation gives the bulge angular size while the rings are
  still readable — the astrolabe frame. And "the glare quad is already the impostor" buys
  continuity, not **findability**: as one additive point among 40k, the home star dissolves.
  *Continuity without identity is a texture.*
- **Experience → risk:** the overdraw argument is right and says nothing about the three-second
  read; static is cheaper than allowed.
- **Risk → shape:** parallax-correct local stars cannot live in the f32 bake — AU-scale motion
  is ~10⁻⁴ units against a 0.06-unit quantum. The 5k must ride the double-subtracted CPU path or
  the parallax claim is false. The genuine hazard is the **f32 camera subtraction** at the
  handoff: below ~0.06 units a star locks to screen centre, and the crossfade must complete well
  above it.
- **Risk → experience:** bounded rotation is imperceptible at a truthful rate and a lie at a
  visible one; drop it this layer.

## 10. Experience thesis (final)

> **Three seconds:** the orrery stays composed; a faint dust band crosses the sky behind it;
> the viewer can point at the rest of the universe. *I am inside something.*
>
> **No input:** no auto-tour. Boot on the Layer 2 framing with a slow parallax drift, so the
> band's motion against the bodies proves it is an object, not paint.
>
> **The good moment:** the zoom-out reinterprets that band as the arm containing this star, and
> the star becomes **one point the eye can still find** — not the first frame that looks like a
> map. Findability is the acceptance test: a person can put a finger on it at 1:1, unaided.
>
> **Friction to avoid:** the galaxy legible before the system is a single point; the system
> released before the galaxy resolves; a visible disc edge; a zoom rate that changes at the
> handoff; the `×N` factor growing from a disclaimer into an apology.

The thesis travels into the spec (§7 Layer 3 row and §6 evidence), so the gate scores against
intent plus the rubric.

## 11. Value trade-off register

| Trade | What it buys | What it costs | Who feels it | Reversible? | Position | Strongest counter |
| --- | --- | --- | --- | --- | --- | --- |
| Impostor vs point vs atlas vs volume | Quality per draw call; one shader family | Decals; fill-rate | Viewer, floor GPU | Yes (generator is separable) | **A**; C is the named swap if A aliases at 4K; B rejected, D vetoed | Atlas spikes are real identity; A's sprites may repeat at 4K |
| Same frame + compressed mapping vs first rebase | One camera, continuous illusion, Layer 4 stays free | A documented lie that must stay monotone and be printed | Viewer (scale claim), later layers | Yes — map is rendering-only, links survive | **Same frame**, map in `scale.ts`, not the address | Layer 4 will owe a rebase anyway; exercising one here would de-risk it |
| Compression on emptiness vs on structure | Truthful arm pitch and disc geometry | The void stretches; travel through it feels compressed | Viewer | Yes | **On emptiness**, bounded minimum slope at the galaxy seam | A hostile camera can expose the slope if unbounded — hence the bound |
| Truthful density vs stylised spiral | "Emptiness is the feature" | Prettiness comes later and from contrast, not count | Viewer | Yes | **Truthful structure, legible population**, boost printed as `×N real` | Inflation is quantitatively false exactly where the scale claim is made |
| One galaxy vs Local Group hint | Focus; one gated surface | Loses "there are others" | Viewer | Yes | **One**, hint deferred to Layer 4's compass | Two dim smudges cost nearly nothing |
| `t` rotation vs static | "Alive" | Another moving thing to verify; vendor-divergent trig | Viewer, floor | Yes | **Static this layer**; orbits already carry alive | Shape would accept one CPU-clamped phase uniform; record as dissent |
| Home-star identity vs uniform field | Findability; the good moment | One brightness floor/hue exception in an otherwise statistical field | Viewer | Yes | **Identity: brightness floor + own hue** | An exception is a lie about the population — but the good moment depends on it |
| Star budget | Floor safety | Richness at galaxy scale | Floor GPU | Yes (tier knob) | **≤60k, compile-time per tier**, 5k local + 40k disc/bulge/arm at rich | Most of the 60k is texture; spend it on the local field |
| Recovery: tier drop vs full rebuild | Survive a fill spike | Rebuild is more code; a drop is a visible quality change | User | Yes | **Frame-time watchdog drops tier in this slice**; rebuild recorded, not built | A TDR ends the page either way until the drop is fast enough |

## 12. Options table and recommendation

| Option | Shape | Cost | Risk | Reversibility | What it buys |
| --- | --- | --- | --- | --- | --- |
| **A — instanced impostors** | 5k local (CPU/double path) + 40k baked disc, one instanced pass | Low | Fill at 4K on the floor | High | The slice, cheapest, reuses proven shader |
| B — point cloud | thousands of primitives | Lowest | Legibility fails (1 px, aliases) | High | Nothing A does not |
| C — quad + atlas | A plus a runtime atlas | Medium | Memory/mips; sticker risk | High | Sprite variety, deferred |
| D — raymarched volume | emissive volume | Highest | Unbounded overdraw at the floor | Low | SpaceEngine look, a later layer |

**Recommendation: A, in the existing frame, with the map on emptiness, an arm-contrast
crossfade, and an identity floor for the home star.** Concretely:

1. `src/render/scale.ts`: pure `displayRadiusM(realM)`, identity below ~10¹³ m,
   `displayRadiusM(0) = 0`, bounded minimum slope through the galaxy seam, near-identity across
   the body; total and monotone on [0, 1e30]; CPU doubles, applied before the f32 upload, never
   in a shader; versioned. Tests at 0, 1e30, across the seams, and monotonicity.
2. `src/universe/galaxy.ts`: population from
   `fnv1a(seed | address | "galaxy" | version)`; a **cell-keyed** local field (~5k, 100 ly,
   camera-independent) and a disc/bulge/arm field (~40k) in real metres; counts compile-time per
   tier; arms as density modulation.
3. Renderer: one instanced additive quad pipeline; the 5k local stars on the double-subtracted
   camera-relative path (real parallax), the 40k baked galaxy-centred; `buildSceneFrame` emits
   one `lod` driven by **arm contrast**, shared by every pipeline; system geometry fades inside
   the band, one wheel rate across the joint; the crossfade completes well above the ~0.06-unit
   f32 camera-subtraction floor (a test pins it).
4. Home star: brightness floor + own hue, so it is findable among the population at 1:1.
5. Budget: ≤60k impostors, tier counts, halo radius as the first knob; frame-time watchdog drops
   a tier instead of stalling; `ugb:device-lost` keeps its fatal panel.
6. HUD: the existing `×N real` row carries the galaxy factor — no second disclaimer.

**Dissent recorded:** the shape seat would keep one CPU-clamped galactic rotation-phase uniform
(cheap, and risk's mod-2π argument removes the divergence objection); the council majority
(experience and risk) says drop it this layer because a truthful rate is invisible and a visible
one is a lie. It is deferred to Layer 4, not rejected.

**Rejected:** B (legibility), D (floor). **Deferred:** C (atlas), the Local Group hint, any
rebase, Sol, the address HUD.

**Known gap, stated plainly:** no 1650-class measurement exists in this environment. The budget
is argued, not measured, and the gate must not claim floor performance until the NVIDIA laptop
proxy runs the live handoff loop.

## 13. Thread-split proposal

| Lane | Writes (exclusive) | Depends on |
| --- | --- | --- |
| 1 — Map | `src/render/scale.ts`, `src/render/scale.test.ts` | — |
| 2 — Population | `src/universe/galaxy.ts`, `src/universe/galaxy.test.ts` | — (generates in real metres) |
| 3 — Renderer | `src/render/galaxy-scene.ts`, `src/gpu/galaxy.wgsl`, `src/gpu/renderer.ts`, `src/render/system-scene.ts` (the `lod` field only) | 1, 2 |
| 4 — Evidence | `capture/shots.json`, `tools/live-probe.mjs` (handoff leg), `tools/capture.mjs` only if the manifest shape changes | 3 |
| 5 — HUD/spec | `src/ui/hud.ts`, `src/state/url-state.ts` only if the galaxy level needs a URL key, spec §7, issue 04 | 3 |

Lanes 1 and 2 can run in parallel; 3 is the integration point and is not parallelisable with
itself; 4 and 5 follow 3. **No lane edits another lane's files.** `system-scene.ts` is lane 3's
because of `lod`; lane 1 must not touch it.

## 14. Decision

**2026-11-23 — accepted as recommended.** Option A, one camera frame, `displayRadiusM`
compressing emptiness only, arm-contrast-driven crossfade, home-star identity floor, static
galaxy, ≤60k tiered impostors, frame-time watchdog drops a tier. The shape seat's dissent (one
CPU-clamped rotation phase) is deferred to Layer 4, not rejected.

**Floor proxy: not available this session.** The budget stays argued, and the gate is barred
from claiming 1650-class performance until the laptop runs the handoff loop. This is recorded
in the evidence plan, not hidden.

Brief: `tickets/04-layer-3-star-field-and-galaxy.md`. Spec §6 and §7 carry the thesis and link
back here.