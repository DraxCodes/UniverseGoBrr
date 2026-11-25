# The address ladder moved: what depth now means

Written 2026-11-25, against `main` after ticket 06 item 2 (the sector rung). Base 0.7.1.

**Read this before touching `GALAXY_DEPTH`, `starKind`, or anything that indexes `address.levels`.**

## The one thing that used to be guessed

Before this change the code had no authority for "what is a level". `GALAXY_DEPTH = 1` was a
constant documented as *"a shortcut, and it says so"*; `starKind` treated `level % 9 === 0` as a
local field star; and `travel.ts` picked a method from local-vs-disc because an address could not say
"this is a sector". All three now read `src/universe/levels.ts`.

## What depth is

| Depth | Kind |
| --- | --- |
| 0 (`v1/`) | universe |
| 1 (`v1/0`) | galaxy |
| 2 (`v1/0.3`) | sector |
| 3 (`v1/0.3.1`) | system |
| 4+ | body |

## The trap I hit, so you do not

I wrote a test asserting Sol moved from `v1/0.0.0` to `v1/0.0.0.0`. **Wrong.** Sol and the layer-2
orrery address `v1/4.-2.7` are both **depth 3 = system**, and they already were. Inserting the
sector rung at depth 2 does not move a system; it changes what **depth 2** means, from *a star* to
*a sector*.

Concretely:

- `v1/4.-2` used to be a star. After the re-key it is a **sector** address, and it collides with the
  string a star identity uses — see the collision note below.
- `v1/4.-2.7` is a *system* before and after, and the rung is **inserted above** the star identity:
  it is now `v1/4.<sector>.-2.7`, still "star −2, body 7". It is **not** `v1/4.-2.<n>` and it does not
  become "sector −2, star 7". The stale string `v1/4.-2.7` is now read as *sector −2*, which is not a
  valid sector index — see the negative-sector trap below.

Check the claim against `starKind`: it reads `address.levels[SECTOR_DEPTH]`, i.e. `levels[2]`, so a
star is depth 3 now. That is the ground truth, not the prose.

## State after the insertion (ticket 06 item 2)

- `levels.ts` — `withoutSectorRung`, `contentKey` (the one place the key shape is built), the
  ladder, `hasSystemScene`, `sectorCountForSize`, `sectorIndexForAngle`, `galaxySizeFraction`.
- `disc.ts` — `GalaxyFrame` carries `sectorCount` and `sectorPhaseRad`; `sectorOfPoint` is the one
  derivation every caller shares (`discAzimuthOf` + the wedge law), and `sectorPosition` is the
  wedge-centre reader.
- `placement.ts` — `placementKey` and `appearanceKey` both go through `contentKey`, so position and
  light do not re-roll. `sectorOfStar` derives the sector from the drawn angle via `sectorOfPoint`.
- `galaxy.ts` — `GALAXY_VERSION` 9, `APPEARANCE_VERSION` unchanged at 8, the walk emits
  `galaxy.sector.star`, and `toDiscFrame` is `discPlanePoint` (one copy of the plane rotation).
- `system.ts` — `generateSystem` keys through `contentKey`, so planets do not re-roll.
- `travel.ts` — a sector is disc; `methodForPair` no longer throws on a depth-2 address.
- `main.ts` — `hasSystemScene` decides the scene: a sector resolves **no** system and draws the
  galaxy it slices; the root draws nothing; a galaxy/system/body keeps its orrery.

## `generateSystem` is total, and that is the trap behind the scene switch

`generateSystem(seed, address)` will answer for **any** address, including a sector and the root.
Nothing in it refuses a wedge, so the scene switch that called `resolveSystem` unconditionally drew a
complete, invented planetary system for `?addr=v1/4.0` — nine plausible planets for a place that is
not a star. If you add a rung or a new scene, ask `hasSystemScene(address)` rather than assuming a
resolved system means a real one. The test in `sector-rung.test.ts` pins both halves: the predicate is
false for a sector, *and* the generator still happily returns planets for it.

The same guard is why a sector's zoom controls are attached with `SYSTEM_EXTENT_M` as the frame scale:
there is no system to borrow `displayScaleM` from, and the galaxy's own far limit
(`GALAXY_MAX_DISTANCE_M`) already bounds the other end.

## The three traps the insertion actually hit

1. **`placementKey` hashed the full address string**, so a naive re-key would have moved every star.
   Fixed by hashing `withoutSectorRung(address)`, in the same commit as the address change.

2. **Existing levels are negative, sector indices are not.** `v1/4.-2.7` has a valid *star* index
   `-2`, but `sectorIndexForAngle` returns `0..count-1`. Sector indices are non-negative ordinals,
   so `capture/shots.json` and every probe address had to be rewritten, and `GALAXY_VERSION` bumped
   in the same commit.

3. **`withoutSectorRung` cannot strip a bare sector, and that is load-bearing.** `v1/4.3` is both a
   well-formed `galaxy.sector` address *and* the pre-re-key address of star 3 — literally the same
   string. Position and appearance depend on that equality: the star-identity path
   (`placedStarForIndex`) keys on `childAddress(galaxy, index)`, which is exactly `v1/4.3`. So the
   function keeps `length <= SECTOR_DEPTH` unchanged and only strips from depth 3 down. The cost is
   that a crafted `?addr=v1/4.3` resolves to star 3's system; ADR-0023 accepts that, because a
   sector is redundant to content and is never drawn as a system.

## Sector phase: derived from home, not drawn

ADR-0023 originally allowed the phase to be sampled per galaxy. It is instead **derived from
`homeAngle`**, so slice 0 is centred on the home star and `v1/0.0.0` keeps meaning "sector 0, star
0" in every galaxy. The sign is the trap: the galactic centre is *opposite* the home star, so the
home star's azimuth about the centre is `homeAngle`, **not** `homeAngle + π`. The first cut had the
`+ π` and put the place you start in on the far side of its own galaxy, which is a one-line bug that
looks like a plausible derivation. `sector-rung.test.ts` pins it.

## Probes

- `npm run probe:ladder` — 11/11, the re-key evidence.
- `npm run probe:masks` — 12/12. Its last check used to assert a galaxy jump was *refused*; it now
  asserts the jump succeeds as hyperspace and lands pixel-identical to a fresh link. Do not "restore"
  the old refusal: it was the bug.
- A stale process on port 4173 makes the preview server throw `Port 4173 is already in use`. Kill the
  listener before re-running a probe.
