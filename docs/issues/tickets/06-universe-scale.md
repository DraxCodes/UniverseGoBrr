# 06 — Universe scale: galaxies, sectors, and the travel ladder

**Status:** proposed, 2026-11-25. The owner's intent is recorded here so it cannot drift again.
Three decisions are committed: ADR-0018 (sectors are an address level), ADR-0019 (method is a choice,
a wormhole costs fixed time) and the roadmap row. Open questions are marked **OPEN**.

## Why this ticket exists

The universe step was never owned. Spec §3.2's vocabulary had no *galaxy* rung
(`universe → quadrant → sector → system → body`), while the code invented `GALAXY_DEPTH = 1` as a
convention. Galaxy-to-galaxy travel appeared only as a refusal reason (`"no root layout"`) in
`src/universe/travel.ts`, ADR-0010, ADR-0012 and ticket 05 — never as a deliverable. A refused
feature that reports a clean reason reads as a boundary, so nobody wrote the ticket.

This file is that ticket.

## The owner's intent (2026-11-25)

1. **The universe is effectively infinite**, in extent and in galaxy count. Only a couple thousand
   galaxies are ever rendered; the rest exist as addressable space.
2. **Galaxies are varied** — arm count, shape, density, size, colour, nucleus — not one law with a
   different seed. Variety is what makes a field of them read as a universe.
3. **`celestial-lab` is a reference studio only.** `C:\Users\joelp\code\celestial-lab` generates
   example galaxies, stars and planets with images and JSON. It is **not** an interface, a data
   source, or a schema for Cairn to import. It exists to show what the generator *could* look like;
   Cairn's own generator stays procedural from the address.
4. **A galaxy is divided into sectors (quadrants).** Quadrant A to Quadrant B is a real, nameable
   place inside one galaxy. A quadrant is an **angular slice of the disc**, and a galaxy has **1 to 6**
   of them by size — a very small galaxy gets 1 (nothing worth splitting), a Milky-Way-sized one 4,
   larger ones 5 or 6. Six is the ceiling. The count is content (`f(seed, address)`), not a link
   parameter, and changing it re-keys every link into that galaxy.
5. **Travel method is the user's choice, not a rule.** Warp can make any trip; a faster method is the
   better option, not the required one. Time is always `Δt = d / v(method)`, with one exception:
   **a wormhole costs a fixed amount of time** (the mouth traversal), then arrives instantly.
6. **You can see the galaxy from orbit**, as in a real sky, and hovering it shows its name in a clean
   popup — "Galaxy X", where **X is either drawn from a curated list of real galaxy names or
   procedurally generated**, deterministic from the seed and address. Both sources are legitimate;
   which one a given galaxy takes is part of the naming law, not a link parameter. Names are
   presentation and **never appear in the link** (ADR-0008).
7. **Free camera travel is not a jump.** With no method selected, `t` advances normally as real time
   passes (ADR-0010: camera gestures never advance the clock).
8. **Long term:** the camera drifts and scrolling carries you deeper into the universe, with
   generation streaming ahead — travel by looking, not by selecting. **ADR-0021** makes this concrete:
   free flight has a **user-selectable speed** (sublight / warp / transwarp / hyperspace) and obeys
   the same `d/v` law, so flying a quadrant at warp is the same journey a warp jump is. Its
   **dependency** is time acceleration: crossing a galaxy at warp takes 7 real days at ×1 and 10
   minutes at ×1000, so the acceleration idea in item 9 becomes a prerequisite rather than a garnish.
9. **Idea, not settled:** user-controlled time acceleration (2×, 10×, 20×). Recorded, not decided —
   but see item 8: free flight across a galaxy needs it, so it is coupled to a real feature.

## The ladder, and how methods map onto it

The methods line up with the rungs, which is why choice works cleanly — but the mapping is **advice,
not a gate**: any method works for any trip at or above the system rung.

| Method | Cheapest at (advice) | Effect | Time |
| --- | --- | --- | --- |
| impulse / free flight / sublight | inside one system | none | real time; `t` follows the clock |
| **warp** | system → system | star streaks | `Δt = d / v` |
| **transwarp** | sector → sector, inside a galaxy | tunnel / slipstream | `Δt = d / v` |
| **hyperspace** | galaxy → galaxy | aperture / hyperspace tunnel | `Δt = d / v` |
| **wormhole** | any → any | a mouth, then arrival | **fixed `Δt`**, then instant |

Because method is a choice, a coarser method may be used for a longer trip — it is simply slow — and a
faster method may be used for a shorter one, where it is simply extravagant. That is the whole
trade-off the UI should show: the same destination, priced in each method.

**The one hard rule is upward:** inside a single system, sublight is the norm; warp there is
permitted but effectively instant, so it is a convenience rather than a tier.

**Resolved — naming.** The ladder above is ADR-0019: `subspace` is retired as a method name in
favour of **hyperspace**, and "tier" (the rung crossed) is now separate from "method" (what you ride).

**Resolved — absolute speeds are reframed, not chosen (ADR-0020).** The owner's anchors are *time*
anchors, and the speed for each method is **derived**: `v = d / Δt_anchor`. Nobody picks a ly/day
number. The consequence is that **scale and speed are decoupled** — grow the galaxy and every speed
grows with it, leaving every crossing time identical. So raising speeds to stop things "feeling too
close together" is both unnecessary and counterproductive: raising speed alone shrinks the felt
universe. Full table in ADR-0020.

Priced at the shipped disc size (`GALAXY_RADIUS_M = 5e20 m` ≈ 52,850 ly, so ≈105,700 ly across), where
a quadrant crossing is the **diameter**:

| Anchor (owner, 2026-11-25) | Derived speed | Confirmed table (2026-11-24) | Gap |
| --- | --- | --- | --- |
| warp, diameter in ~1 week | ≈ 15,100 ly/day | warp **1 ly/day** | ≈ **15,000× too slow** |
| transwarp, same in ≤1 hour | ≈ 2,536,800 ly/day | transwarp **100 ly/day** | ≈ **25,000× too slow** |
| hyperspace, galaxy→galaxy in ~1 hour | ≈ 1.5×10⁸ ly/day | subspace **10,000 ly/day** | ≈ **15,000× too slow** |

The **ratios** in the anchors (warp : transwarp : hyperspace = 1 : 168 : 10,080) are internally
consistent and stable across every galaxy size, so the ladder's *shape* is settled and only the
absolute values move when the size law is. The 2026-11-24 table is **superseded, not extended**: it is
off by four orders of magnitude, not a factor of two.

**OPEN — the less obvious half: short trips.** Because the anchors are set by *diameter* crossings,
high speeds make a system hop absurdly cheap — a 5 ly warp at 15,100 ly/day takes about **7 seconds**
of universe time. That is probably right (ADR-0019 §3 makes inside-a-system sublight anyway), but it
means the anchor that matters most for feel is the *shortest* one, not the longest. Worth choosing with
the effect on screen rather than in a table.

**Resolved — wormhole and ADR-0010.** The fixed-cost wormhole is now the explicit carve-out in
ADR-0019, not a branch buried in `planTravel`.

**Resolved — wormhole is not galaxy-to-galaxy only.** ADR-0019 §2 now says **any method works for any
trip**, so hyperspace and wormhole are legal for a system-to-system hop. They differ in cost, not
permission. The only restriction is upward: inside one system, sublight is the norm.

## Work breakdown

**Slice A is done (2026-11-25): items 1, 3 and the travel-coverage half of 2.** The piece that
actually removes the ADR-0022 coverage defect is item 3 plus `planTravel`, and `npm run probe:ladder`
is its evidence (10/10).

1. **Level model — DONE.** `src/universe/levels.ts` names every rung and is the single authority;
   `GALAXY_DEPTH` re-exports it. Also carries the galaxy **size fraction** and the **1–6 sector
   count** derived from it. Non-breaking: nothing consumed the kinds yet when it landed. 21 tests.
2. **Sectors as an address level — DONE for insertion and scene; the *wedge* is item 9** (ADR-0018,
   ADR-0023). A star's address is `galaxy.sector.star`: the sector is derived from the angle the
   star is already drawn at and the star keeps its old identity integer, so `v1/4.-2` is now
   `v1/4.<sector>.-2`. The rung is **inserted**, not appended: the orrery that was `v1/4.-2.7` is now
   `v1/4.<sector>.-2.7`, still "star −2, body 7". Position, appearance and system content key on the
   rung-stripped address, so the gated galaxy is byte-identical; the whole population was diffed
   against `4405c2d` at a worst delta of exactly zero. `GALAXY_VERSION` 8 → 9;
   `PLACEMENT_VERSION`/`APPEARANCE_VERSION` unchanged. A sector is a real travel destination (mid
   radius, its own wedge). **Its scene is the galaxy it slices, framed face-on** (owner,
   2026-11-25): `hasSystemScene` says a sector has no star, so `main.ts` resolves no system there and
   draws the disc instead — the same framing `commitZoomOut` uses, HUD row `one galaxy · ×1 real`.
   Before the guard, `generateSystem` (total) invented a planetary system for every sector link.
   The wedge itself is still undrawn: item 9, and `planZoomOut` refuses a sector line by name.
3. **Root layout — DONE.** `src/universe/layout.ts`, `galaxyPosition`. Total and unbounded, so
   "further out" always has something; `cbrt(|g|)` gives roughly constant density instead of a
   shell. Galaxy 0 is the origin (Sol). 10 tests.
4. **Galaxy variation law - DONE (2026-11-25), `perception` 8/10 SHIP.** A parameter space
   sampled from the address: arms, pitch, bar, bulge, halo, dust, colour, size. Informed by
   `celestial-lab` references, implemented independently.

   **The law is `galaxyShape` + `galaxyRadiusM` in `src/universe/disc.ts`, on its own stream
   `seed|addr|shape|v1`.** Every field is drawn from `(seed, galaxyAddress)` only, so it is content:
   travel to `v1/7` and you get that galaxy's arms, not a re-rolled one.

   | Axis | Range | Where |
   | --- | --- | --- |
   | size | 0.5e20..9.0e20 m (18×), linear on the size fraction | `galaxyRadiusM` |
   | arms | 2, 3, 4 (50/25/25) | `armCount`, `armOffsets` |
   | arm sweep | 378°..550° of turn, centre to rim | `armSweepRad` |
   | pitch | `sweep · scaleLengthFraction` (**derived**) | `winding` |
   | scale length | 0.28..0.45 R | `scaleLengthFraction` |
   | bulge | 3-14% of stars, 0.09-0.20 R, flattened 0.45-0.85 | `bulgeFraction` etc. |
   | bar | 0..0.35, bulge elongated on the first arm | `barStrength` |
   | halo | 0..3% on a 2.2× radial tail, 3× height, old-red | `haloFraction` |
   | dust | 0..0.35 lane emission depression | `dustDepth` |
   | colour age | 0..1, red/quenched .. blue/star-forming | `colourAge` |

   **Sweep is drawn and pitch is derived because drawing both freely produced spokes.** Their ratio
   is the arm's total turn, and a free ratio ranged 217°..561° across twelve galaxies; below ~300°
   the lanes between arms read as radial wedges around a dark pinwheel (measured ridge/trough 1.3,
   against 10–16 on the tight ones). Drawing the sweep pins it, and a test now holds the invariant
   (`galaxy.test.ts`, "draws a real spiral at every arm count and pitch").

   **Size is real everywhere it matters**, not a display number: radius drives framing distance, the
   zoom ceiling, legibility thresholds, exposure correction and every star distance, so each galaxy
   is a different object, not the same one scaled. Because framing scales with radius, size is
   visible at a *fixed* absolute camera (boot/orrery band), not in a per-galaxy shot.

   **Halo and dust are honest minimal** (owner's call): a halo is a heavier radial tail on the same
   star kind, not a new one, and dust darkens lane emission rather than occluding stars.

   **The home galaxy is one sample of the law** (owner's call): `v1/0` is not pinned, so the boot
   frame, the galaxy-layer captures and the Sol backdrop all changed with the law.

   Version bumps: `GALAXY_VERSION` 9→10, `APPEARANCE_VERSION` 8→9, `PLACEMENT_VERSION` 2→3, new
   `GALAXY_SHAPE_VERSION` 1. `GALAXY_STREAM_VERSION` 3 and `SCALE_VERSION` 1 unchanged.

   **Evidence:** `tools/galaxy-gallery.mjs` (12 galaxies at the manifest composition, 2.6× each
   galaxy's own radius) is the instrument for judging the law - it is what caught the spoke defect.
   `npm run capture` 20/20, `measure-layer3` 12-seed report, and the full probe set. Tests: 337
   passed. Caveats: the harness `arm-measure.test.ts` is opt-in (`UGB_MEASURE=1`) and asserts
   nothing - its numbers are a calibration to paste into `galaxy-scene.ts`.

   **Gate: `perception` 8/10, SHIP** (`.scratch/runs/layer3-iteration4-gate.json`). The three nits
   that hold it below 9, all recorded and carried: (1) 4K 1:1 stars are uniform pebbles with no
   per-star size cue - the one change that would reach 9, and it is shader work (Neon handoff
   territory); (2) halo clumps at the top of the halo range read as detached wads; (3) lane:arm
   width 2.33 at the thin-arm end. The blindspot pass ran and found no art defect; of its 12
   findings 9 were downscale misreads of HUD text and 2 restated the home-star camera anchor. Its
   one real hit was against **my own brief**, not the art: the camera targets the home star, which
   is a random point in the disc, so the nucleus sits ~237 px off frame centre by design. Proof of
   the size law now exists at a fixed camera: `--fixed-distance-m 3.0e21` shows `v1/2` at ~52 px and
   `v1/0` at ~196 px from identical camera coordinates.

   **Not done for this item:** the security lens was skipped, not passed - `surplus/glm-5.3` was
   unroutable at its `min80` floor (best eligible discount 69.4%) and the rule is to note a skip
   rather than silently change the seat. `8e6f73e` has not been through the security lens.
5. **Galaxy naming.** A deterministic name per galaxy address, presentation-only, shown on hover.
6. **Multi-galaxy rendering.** Instanced galaxy impostors with LOD, selected by apparent brightness.
   Addressable density stays full; the *render* set is a selection — that is how "infinite feel,
   finite render" works.
7. **Other galaxies on every tier, not just in the sky.** The distant population is a **continuum of
   appearance**, and the tiers are the whole point (ADR-0022):

   - **Resolved** — arms, bar or elliptical glow: unmistakably a galaxy. Andromeda-tier. Must respect
     ADR-0015's `ceil_lum` 0.79 so it never outshines the home star.
   - **Smudge** — a small elongated blob, "is that one?".
   - **Point** — an ordinary dot, indistinguishable from a star. Deliberately ambiguous, and the
     largest tier: many of those dots are galaxies.

   **The sky is anisotropic, and that is the point.** Appearance depends on *two* axes, not one: distance
   (resolved / smudge / point) **and** direction relative to the disc's plane. Looking **into** the plane
   you see the disc band — local stars, dust, nebula — and distant things are occluded. Looking **out of**
   the plane the disc is thin, so local stars thin out and other galaxies show through as smudges and
   points. The same galaxy is therefore a point one way and invisible the other, which is what makes the
   sky read as a place with a shape rather than a uniform sphere of dots. The plane normal already exists
   (`GALACTIC_PLANE_TILT_RAD` in `disc.ts`), so the split is computable.

   **These cannot be drawn in the infinity sky.** `stage0.wgsl` answers to orientation only (a position
   term breaks float precision and bands — documented in the shader), so anything placed there is
   permanently unreachable. Distant galaxies are therefore **real addressed objects at real distances**,
   rendered as points when far. That is a population, not a texture.

   **The shipped capture already shows the layout.** `layer3-sol-1080p` has the disc band across roughly
   a third of the frame and open sky everywhere else. The composition is already right; the content in
   that open region is `stage0`'s point layers, which look like places and are not. That region is where
   the smudge and point tiers go, and **how much of the frame is disc band versus populated open sky** is
   a checkable scale figure.

   **Composition is the lever.** At galaxy zoom-out the disc fills the middle of the frame and leaves a
   lot of free space around it — that space is where the smudge and point tiers live, and how densely it
   is filled is a direct control on perceived scale (ADR-0020). Filling it is not decoration; it is the
   answer to "does it feel big".
8. **Travel rework.** Method becomes an input (`planTravel(from, to, method)`), the plan prices every
   method, and wormhole gets its fixed-time path. **Coverage becomes the done-criterion:** every
   address reachable, every trip priceable, nothing refused for want of a distance.
9. **Sectors as places.** Compass entries and address lines for a sector, not just a star.

## Open questions

- **V1 scope.** **Answered: V1 includes this layer** (owner, 2026-11-25). Rows 0-4 plus 4b.
- **Sector geometry and count.** ADR-0018 settled that a sector is *a rung*; it did not settle how
  many a galaxy has or whether one is a wedge, a box or a shell. This is the first thing the level
  model must answer, because travel selection depends on it.
- Whether time acceleration ships, and whether it is a camera feature or a clock feature.
- Galaxy count and selection rule for the render set.
- How far "local cluster" reaches before the field is purely procedural shell-filling.

## Evidence this ticket will need

- **The first-three-seconds capture (the primary one).** A screenshot from a solar system, standing
  still, with neighbouring galaxies visible as smudges. It is scored against the experience thesis
  directly: can a viewer tell this is enormous before anything moves? This is the capture that proves
  4b, not the galaxy field itself.
- A capture of the multi-galaxy field, and one of the same galaxy seen from orbit.
- **The sky must stay under ADR-0015's per-pass ceiling** (`ceil_lum` 0.79, below the home star's
  0.887). A neighbouring galaxy is visible *because it is big and faint*, never because it is bright;
  if it outshines the home star, the tone curve was spent on the wrong thing.
- **A coverage check.** Every address reachable, every trip priceable in every method. Today
  galaxy-to-galaxy is refused, so this check *fails* until the root layout lands — which is what makes
  it the honest definition of done.
- A probe that walks the ladder: system → sector → galaxy, printing the address at each rung and the
  distance in the parent frame.
- A `planTravel` table showing one destination priced in every method, including the wormhole's fixed
  time.
- `npm test`, `npm run build`, `npm run capture` green at every step.