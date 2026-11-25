# Decision records

| ADR | Status | Decision |
| --- | --- | --- |
| 0001 | accepted | Build for the web on WebGPU in TypeScript, distributed as a URL. |
| 0002 | accepted | int64 cell + offset on the CPU, camera-relative float32 on the GPU, reverse-Z depth. |
| 0003 | accepted | Travel tiers are frame rebases; the warp effect masks the swap. |
| 0004 | accepted | Time is an input, evaluated in closed form; never simulated forward to reach `t`. |
| 0005 | accepted | The universe is a pure function of a versioned address; nothing is stored. |
| 0006 | proposed | Actors are a separate, tiered, swappable layer; simulation is CPU-only. Requires a council. |
| 0007 | accepted | One presentation: dark, with no theme system. Light is a property of the scene. |
| 0008 | accepted | Camera-relative double subtraction now; int64 cells and rebasing deferred to Layer 4; the address is unbounded, has a root (`v1/`), and stays opaque identity. |
| 0009 | accepted | Authored nodes reserve a new address and ignore the seed; the registry is data checked before the generator, versioned per node. Sol reserves `v1/0.0.0`. |
| 0010 | accepted | Travel advances `t` by distance over speed (`Δt = d / v(method)`), measured in the parent frame; camera gestures never advance `t`. Entails a versioned `placement(seed, address)` per node. |
| 0011 | accepted | The address grid is the world and the picture is a view of its occupied cells; placement is `placement(seed, address)`, never the inverse; occupancy is one shared rule; a tier change loses detail, not inhabitants. A galaxy is keyed on its own level. |
| 0012 | accepted | A committed travel is one atomic state change: the address becomes the destination, the clock advances by `d/v(method)` without changing mode, and the camera lands on the destination's opening view. A travel is exactly "write the arrival link and enter it". |
| 0013 | accepted | Following an address line is a free reframe (no universe time) that still gets a history entry; the `from` pin is a coordinate carried in the link; compass anchors are the nearest drawn stars; only the galaxy level zooms out in v1, face-on and framing the whole disc. |
| 0014 | accepted | The camera looks at a target; the eye is derived (`target − forward · distance`). Right-drag pans by moving the target and eye together at the target's depth; `tgt=x,y,z` carries the target, absent meaning the frame origin. A pan is a gesture: it replaces the current history entry and advances no universe time. |
| 0015 | accepted | The galaxy draws into its own `rgba16float` buffer and is composited after the sky and before the orrery. One soft-shoulder tone curve owns a per-pass ceiling (`ceil_lum` 0.79, below the home star) and an exposure floor (0.80). Density comes from population and near-uniform impostor overlap, not gain. Any appearance change bumps `GALAXY_VERSION`. |
| 0016 | accepted | The product is **Cairn**: a marker a traveller leaves for the next one, which is the act of sending a coordinate. The space lexicon was searched first and is saturated, several times by direct competitors; the collision with a 2026 climbing game is accepted. A rename touches the live surfaces only — never the seeds, the `__ugb` hook or the version constants. |
| 0017 | accepted | The repository is **MIT**-licensed. A fork may be closed and commercial; no patent grant. A successor would be AGPL-3.0, applying only to later versions. |
| 0018 | accepted | **A galaxy has sectors, and a sector is an address level**: universe → galaxy → sector → system → body. A sector is an **angular slice**, and a galaxy has **1–6** by size. Every address re-keys; accepted now because nothing has shipped. |
| 0019 | accepted | **Travel method is an input, and any method works for any trip** — the only restriction is sublight inside one system. A **wormhole costs a fixed `Δt`**, the one carve-out to ADR-0010. Absolute speeds remain open. |
| 0020 | accepted | **Scale and speed are decoupled; crossing *time* is the invariant.** Speeds are derived from time anchors (`v = d / Δt`), so growing the universe changes no experience. Raising speed alone makes it feel *smaller*. Scale must nonetheless rest on visible structure, not on travel time. |
| 0021 | accepted (direction), **deferred** | **Free flight is a user-set speed** (sublight/warp/transwarp/hyperspace) and obeys the same `d/v` law, so `t` tracks wall rate at every speed. It may leave a system. Deferred indefinitely by the owner; the rework risk (address timing during continuous flight) is accepted. |
| 0022 | accepted | **A light you can resolve is a place you can go.** Distant galaxies and stars share one appearance continuum — resolved, smudge, point — and the point tier is deliberately ambiguous. Distant galaxies are real addressed objects, **not** infinity-sky texture; the diffuse backdrop must stay diffuse. |

Status is one of `proposed`, `accepted`, `superseded` (name the successor),
`deprecated` or `rejected`. The numbered filename is `NNNN-slug.md`.