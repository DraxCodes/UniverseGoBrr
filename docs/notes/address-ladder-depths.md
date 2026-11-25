# The address ladder moved: what depth now means

Written 2026-11-25, against `main` after ticket 06 Slice A. Base 0.7.1.

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

- `v1/4.-2` used to be a star. After the re-key it is a **sector** address, and it means the same
  string a star identity uses — see the collision note below.
- `v1/4.-2.7` is a system before and after. Its *meaning* changes: it is now "star 7 of sector −2",
  not "body 7 of star −2". Star identity kept its integer, so honest new addresses read
  `v1/4.<sector>.-2.7`.

Check the claim against `starKind`: it reads `address.levels[SECTOR_DEPTH]`, i.e. `levels[2]`, so a
star is depth 3 now. That is the ground truth, not the prose.

## State after the insertion (ticket 06 item 2)

- `levels.ts` — `withoutSectorRung`, the ladder, `sectorCountForSize`, `sectorIndexForAngle`,
  `galaxySizeFraction`.
- `disc.ts` — `GalaxyFrame` carries `sectorCount` and `sectorPhaseRad`; `discAzimuthOf` and
  `sectorPosition` are the two readers of the derived phase.
- `placement.ts` — `placementKey` and `appearanceKey` both strip the sector rung, so position and
  light do not re-roll. `sectorOfStar` derives the sector from the drawn angle.
- `galaxy.ts` — `GALAXY_VERSION` 9, `APPEARANCE_VERSION` unchanged at 8, the walk emits
  `galaxy.sector.star`.
- `system.ts` — `generateSystem` keys on `withoutSectorRung`, so planets do not re-roll.
- `travel.ts` — a sector is disc; `methodForPair` no longer throws on a depth-2 address.

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

- `npm run probe:ladder` — new, 10/10, the Slice A evidence.
- `npm run probe:masks` — 12/12. Its last check used to assert a galaxy jump was *refused*; it now
  asserts the jump succeeds as hyperspace and lands pixel-identical to a fresh link. Do not "restore"
  the old refusal: it was the bug.
- A stale process on port 4173 makes the preview server throw `Port 4173 is already in use`. Kill the
  listener before re-running a probe.
