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

Status is one of `proposed`, `accepted`, `superseded` (name the successor),
`deprecated` or `rejected`. The numbered filename is `NNNN-slug.md`.