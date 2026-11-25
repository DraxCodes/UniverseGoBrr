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

- `v1/4.-2` used to be a star. After the re-key it is a sector.
- `v1/4.-2.7` is a system before and after. Its address does not change.
- So "every address re-keys" is too strong. The addresses that change are ones that named a star at
  depth 2; systems at depth 3 keep their string but now read as "sector, system" rather than
  "star, body".

Check the claim against `starKind`: it reads `address.levels[GALAXY_DEPTH]`, i.e. `levels[1]`, so a
star *is* depth 2 today. That is the ground truth, not the prose.

## State after Slice A

- `levels.ts` — the ladder, `sectorCountForSize`, `sectorIndexForAngle`, `galaxySizeFraction`.
- `layout.ts` — `galaxyPosition`, root positions, unbounded.
- `travel.ts` — method is an input; `subspace` → `hyperspace`; `wormhole` is a fixed cost;
  galaxy-to-galaxy works; **inside one system the recommendation is `impulse`** (`sameSystem`).

## Not done yet

Sectors are **not** in any address: `generateGalaxy` still iterates stars directly under a galaxy.
That insertion is the next commit, and it is where `v1/0.3` stops being a star. `GALAXY_VERSION` must
bump when it lands, because every drawn address changes.

## Probes

- `npm run probe:ladder` — new, 10/10, the Slice A evidence.
- `npm run probe:masks` — 12/12. Its last check used to assert a galaxy jump was *refused*; it now
  asserts the jump succeeds as hyperspace and lands pixel-identical to a fresh link. Do not "restore"
  the old refusal: it was the bug.
- A stale process on port 4173 makes the preview server throw `Port 4173 is already in use`. Kill the
  listener before re-running a probe.
