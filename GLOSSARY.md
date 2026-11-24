# Glossary

The project's domain language. Use these terms exactly; avoid the synonyms in the right
column. New terms get added by `/domain-modeling` when a concept is actually settled.

## Space and structure

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Address** | The coordinate identifying a node: `version/address`, optionally with an `epoch`. An unbounded list of levels, so no region is the largest. `v1/` with no levels is the **root**, the frame containing everything, where zoom-out stops. A string. | "ID", "key", "coords" |
| **Root** | The frame with no levels (`v1/`). Contains every other frame and has nothing outside it; the terminating step of zoom-out. | "origin" (that is a position, not a frame) |
| **Node** | An addressable thing or region in the octree: a galaxy, sector, system, body. | "object", "entity" |
| **Frame** | A nested coordinate space, one per level of the hierarchy. | "space" (ambiguous), "scene" |
| **Position** | A point in absolute space: a frame origin plus a double-precision local offset. On the CPU only; the GPU receives `camera-relative` float32. | "coords" |
| **Rebase** | Swapping the active frame on travel. The swap is masked by the VFX. | "teleport", "jump" (both imply a different mechanic) |
| **Cell** | An int64 grid index giving an exact absolute position, paired with a float32 local offset. **Deferred to Layer 4** (ADR-0008); the address and `Position` carry identity until travel needs it. | "chunk" (means a *generated* unit) |
| **Chunk** | A unit of generated content at a node, cached on entry. | — |
| **Level** | One step of the hierarchy: universe → quadrant → sector → system → body. | "zoom level" (conflicts with render LOD) |
| **Zoom out** | Following an address line to an ancestor frame. A **reframe**, not a travel: the address and camera change, no universe time passes, and it still earns a history entry (ADR-0013). | "travel out", "fly out" (both imply elapsed time) |
| **Anchor** | A place the compass offers as a jump target: a **drawn** star of the current galaxy, with the address that produced it. Never a place you happened to visit (ADR-0013). | "waypoint" (implies a stored route) |
| **Pin / came from** | The address the last committed travel started from, carried in the link as `from=` and treated as a coordinate, not journey state (ADR-0013). | "history", "trail" (both sound like stored motion) |
| **Display name** | The human-facing label for a level (`"Sol"`, `"Region 4211"`), resolved from the address for the HUD only. Never written into a link, and a rename never changes an address. Must be depth-indexed with a fallback, because the address has no fixed depth. | "title" (implies canvas text) |

## Generation

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Structure** | What exists at a node: `f(seed, address)`. Cached, not time-dependent. | "content" (too vague) |
| **State** | Where a thing is / what phase it is in: `f(structure, t)`. Cheap, per frame. | "position" (too narrow) |
| **Slot** | A named, typed extension point in a node's content record (e.g. `megastructures`). Always declared, even when empty. | "field", "bucket" |
| **Version** | The generator generation baked into an address. Never mutated once released. | "revision", "build" |
| **Impostor** | A billboarded or point-sprite stand-in for a distant object. Used for galaxies and distant stars. | "sprite" |
| **Density dial** | The deliberate per-layer choice between scientific truth and visual legibility. Truthful stars, inflated anomalies. | — |
| **Artificial system** | A star system whose configuration is maintained by a civilisation rather than by orbital stability. Flagship case: ten stars. | "weird system", "custom system" |
| **Authored override** | A hand-built node keyed by address, checked before the generator. Used for real nebulae and Sol; data, not a code path. | "hardcoded", "special case" |

## Time

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Epoch** | The time component of a coordinate. The moment a place is to be seen. | "timestamp" (that is the raw value) |
| **Tick** | A quantised time step for structural events, so views cache and links match. | "frame" (taken) |
| **Scrubber** | The time control. *Visit now* and *visit as found* are positions on it. | "timeline" |
| **Visit now** | See the living universe as it currently is; the thing may have moved on. | — |
| **Visit as found** | Scrub to a coordinate's epoch and see exactly what the sharer saw. | "replay" |
| **Event fold** | Computing an actor's state by scanning the finite list of scheduled events before `t`. The Tier 1 actors mechanism. | "simulation" (that is Tier 2) |

## Layers

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Universe layer** | Pure generation and time. No history. | "world", "model" |
| **Actor layer** | Ships, civilisations, reactions, growth. The only stateful layer. | "AI layer" |
| **Presentation layer** | Shaders, LOD, impostors, audio, HUD. Permitted to differ per vendor. | "view layer" |
| **Tour** | A shareable list of `(address, epoch, dwell)` — an itinerary, not a world. | "playlist", "collection" |

## Quality and process

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Floor device** | The named minimum target: GTX 1650 / i5-class. Kept in the test loop so "runs on cheap hardware" stays a checked claim. | — |
| **Experience thesis** | *Vast, legible and alive.* What the `perception` rubric scores against. | "vision" |
| **Capture harness** | Fixed seed + epoch + camera → screenshot. Serves both iteration and the perception gate's evidence. | "screenshot tool" |