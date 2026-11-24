---
date: 2026-11-24
verified_against: wip/layer-3, after ADR-0011
files:
  - src/universe/disc.ts
  - src/universe/placement.ts
  - src/universe/galaxy.ts
status: active
---

# Placement uses a second stream, not the population's

**Cause.** `generateGalaxy` draws its stars from one sequential mulberry32 stream: the position of
the *k*-th star depends on every draw before it, including the brightness and colour draws between
positions. So `placement(seed, v1/4.k)` cannot reproduce the *k*-th drawn star in O(1) — it would
have to replay the stream up to *k*, which is O(k) per lookup and O(n²) to place the population.

`placement` therefore keys its **own** stream on the address and calls the same `sampleDiscStar`
law. The law is shared (one function, one set of constants, the same arm phase); the stream is not.
Two consequences follow, and both have been misread as bugs:

- the star at address `v1/4.k` is **not** the *k*-th star the picture draws. They agree
  statistically — same bulge, same exponential disc, same two arms — not by identity;
- the picture still draws its own sample, so **a drawn light does not carry an address yet**.
  ADR-0011's "every light is visitable" is half-built: the positions and the law exist, the list
  does not.

**What to do instead.** To close the loop, make the population draw *by address*: for each index,
place `childAddress(galaxy, index)` and use that position, rather than drawing a position from the
disc stream. That is a real re-roll, not a refactor: bump `GALAXY_STREAM_VERSION`, then
`GALAXY_VERSION`, then re-shoot the capture set and re-measure the arm acceptance. Do **not**
attach an `address` field to a stream-placed star in the meantime — that would name a position
`placement` disagrees with, which is worse than no address at all.

**Evidence.** `src/universe/placement.test.ts` → "replays the generator's disc stream exactly":
it replays the generator's `|disc` stream through `sampleDiscStar`, consuming the two
brightness/colour draws between stars, and asserts the positions match. `src/universe/disc.ts`
holds the one law both sides call. The extraction that created it was proved bit-identical on three
seed/address/tier cases before and after (exact-double digest), so the move changed no pixel.

The counter-intuitive bit worth remembering: a hash-keyed per-address stream is what makes placement
O(1) and stable, and that is exactly why it cannot be the population's stream.