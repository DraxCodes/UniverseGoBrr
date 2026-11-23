# 0001 — Web platform on WebGPU in TypeScript

**Status:** accepted (2026-11-23)
**Context:** The project is a real-time GPU renderer that must run on ordinary consumer
hardware and, above all, must be *shareable* — "here is the cool thing I found, go look."
The host language and GPU API decide distribution, iteration speed and the accessible
performance ceiling.

## Decision

Build for the **web**: TypeScript, **WebGPU**, distributed as a URL. No install, no account,
no asset download.

## Options considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Web + WebGPU | TypeScript, WGSL, runs in a browser tab | Chosen |
| B. Native Rust + `wgpu` | Same API family, higher ceiling, needs install | Rejected — distribution and sharing are product requirements |
| C. Native C++ + Vulkan | Maximum control, slowest iteration | Rejected — wrong tool for the author's experience and the goal |
| D. Web + WebGL2 | Wider browser support, older API | Rejected — no compute shaders, weaker pipeline model |

## Why

Shareability is a *product* requirement, not a convenience: a coordinate is a string, and a
URL is the whole distribution story. WebGPU is also the API where the current tooling and
model knowledge is strongest, and its lack of 64-bit floats costs nothing here precisely
because precision is solved on the CPU (ADR-0002).

Trade-off accepted: a lower performance ceiling than native, and a modern-browser
requirement. Neither binds this project for years.

## Consequences

- No `f64` in shaders, ever. All big-number work is CPU-side.
- A modern Chrome/Edge is the floor; show a graceful message otherwise. No WebGL2 fallback.
- No installed assets means the memory floor is generous and startup is fast.
- Iteration is fast (Vite + HMR), which matters more than the ceiling for a visual project.
- Revisit if a hard performance wall appears that cannot be met with quality tiers.