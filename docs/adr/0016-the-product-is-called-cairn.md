# 0016 — The product is called Cairn

**Status:** accepted (2026-11-25, owner)
**Context:** the working title `UniverseGoBrr` was a placeholder. Sharing is the product — a view is
sent as a URL and spoken aloud — so the name has to survive being typed into a link, read off a
monospace HUD, and said once to a friend. The brief asked for one safe, one bold, one plain and one
wildcard direction, with conflicts against existing space apps checked before a recommendation.

## Decision

**The product is `Cairn`.** A cairn is a stack of stones a traveller leaves to mark the way for the
next one. That is the same act as sending someone a coordinate: someone was here, this is how you
find it.

The name is one syllable, spelled exactly as it sounds, works as a URL and a HUD label, and does not
describe a space game or a planet simulator. It also gives the dark, procedural picture a quiet,
human word to sit against.

## Options considered

| Direction | Candidate | Trade-off | Outcome |
| --- | --- | --- | --- |
| Safe | **Headland** | A high place you look out from; reads coastal, one 2020 indie game shares it | Runner-up |
| Bold | **Cairn** | Encodes the share mechanic; a 2026 climbing game shares it | **Chosen** |
| Plain | **Universe Map** | Honest but unownable; `Universe Atlas` already does this in WebGPU | Rejected |
| Wildcard | **Farholm** | Coined place-name, essentially clean; sounds Nordic and needs a tagline | Rejected |

## What was checked

Each candidate was searched against apps, games and software. The finding that decided the shape of
the shortlist was **saturation**: the obvious vocabulary is owned, and several of the owners are
direct competitors rather than unrelated companies.

- **Direct space competitors:** `Perihelion` (a browser space sim with Kepler orbits, plus a Steam
  title), `Farspan` (`farspan.net`, planet-surface-to-galaxy travel), `Orrery` (three App Store
  orrery apps), `Old Light` (`oldlight.io`, a browser space strategy game), `Deep Field` (a Steam
  space game), `Laniakea` (an MMORPG), `Apsis` and `Perigee` (multiple games), `Ecliptic`,
  `Azimuth`, `Cygni`, `Orion Spur`, `Great Attractor`, `Astrolabe`, `Sextant`.
- **Owned elsewhere:** `Vantage`, `Longitude`, `Ephemeris`, `Almanac`, `Thuban`, `Deneb`, `Yonder`,
  `Landfall`, `Alight`, `Sightline`, `Nightreach`, `Vastward`, `Vastlight`, `Seamark`.
- **The plain direction had a near-identical neighbour:** `Universe Atlas` is an open-source WebGPU
  browser atlas that flies from Earth to the cosmic web.

**Not checked here:** trademark registers, domain availability, and app-store name availability.
Those are the owner's call, not assumed. `Cairn` is known to collide with a 2026 climbing game and
with several small productivity apps; the collision is in a different category and is accepted.

## Consequences

- The rename touches the live surfaces only: the app title and HUD brand (`index.html`), package
  identity, README, the status page, the current-state lines of the spec and status docs, and the
  seam's project key. The `ugb-` seed strings, the `window.__ugb` hook and the `*_VERSION` constants
  do **not** move, or every capture and the gate evidence would describe a different picture
  (`docs/notes/renaming-surface.md`).
- The GitHub repository is still named `UniverseGoBrr`. Renaming it is a separate, owner-run action;
  old links keep working until it happens.
- The old title is not kept as "formerly" in the README unless the owner asks for it.
- A name is not a generator generation: no `*_VERSION` constant is bumped for a rename.