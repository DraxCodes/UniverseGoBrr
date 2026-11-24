# Layer 1 security audit — evidence

**Date:** 2026-11-23
**Scope:** the Layer 1 change set — `src/frame/position.ts`, `src/frame/address.ts`,
`src/frame/precision-probe.ts`, `src/state/url-state.ts`, `src/gpu/renderer.ts`,
`src/gpu/stage0.wgsl`, `src/ui/hud.ts`, `src/main.ts`, `index.html`, `tools/capture.mjs`.
**Auditor:** `security-auditor` (GLM lineage), briefed on those ten files. It widened by three
named files (`src/lib/hash.ts`, `package.json`, `.opencode/workflow.json`) to answer questions
the slice could not, plus three targeted greps. It edited nothing.
**Verdict:** CONCERNS — one LOW, two informational; all three routed and resolved.

## Threat model

A shared link is the unit of sharing, so the query string is attacker-controlled: `seed`,
`epoch`, `addr`, `t`, `cam`, `precision`. The interesting failure is not code execution but a
link that renders garbage or hangs the opener.

## Claims

| # | Claim | Result |
| --- | --- | --- |
| 1 | Every URL parameter is strictly validated; no throw, unbounded allocation or prototype pollution; `cam`/`t` included | **partially refuted, LOW** — `addr`, `seed`, `epoch`, `precision` fully capped; `cam`/`t` were finite-checked only, with unbounded magnitude (F1) |
| 2 | No URL value reaches the uniform as NaN/Inf causing a persistent validation error or device loss | confirmed — Inf *could* reach the buffer (F1), but WebGPU §2.1.5 makes invalid floats affect arithmetic only: no validation error, no device loss |
| 3 | The address is never injected as HTML | confirmed — `textContent` throughout; `title` is an IDL property on a fixed attribute name; no `innerHTML` in the slice |
| 4 | `capture.mjs` cannot be pushed into path traversal or URL injection | confirmed — `shot.name` is `[A-Za-z0-9._-]+` and is validated before `path.join`; the query goes through `URLSearchParams` |
| 5 | WGSL probe cannot divide by zero; the CPU clamp is mirrored | confirmed — `max(z, 1e-6)` in both, `max(resolution.y, 1)` in both |
| 6 | No secrets, PII, new network calls, new dependency, eval or HTML sink | confirmed — greps returned zero; `--url` remains an operator-only flag |
| 7 | The naive path is unreachable without `precision=naive` | confirmed — the probe is built only when the parse produced `fixed`/`naive`; no key, HUD or HMR route reaches it |

## Findings and resolution

1. **LOW — `cam`/`t` accepted unbounded magnitudes** (`url-state.ts`). A finite double above
   ~3.4×10³⁸ becomes `Infinity` in the float32 uniform, and Infinity renders as NaN pixels: a
   link that draws garbage instead of reporting a bad coordinate. **Fixed:** values are now
   capped as well as finite-checked — 10³⁰ m for position, 10⁶ rad for angles, 10²⁰ s for `t` —
   which is far above any real frame (10²⁶ m) and far below float32's Inf threshold. Rejection
   goes through the existing `issues` path, so the HUD names the rejected value.
   **Verified by injection:** with the cap removed, three tests fail
   (`rejects magnitudes that would become Infinity once stored as float32` plus the two
   default-state assertions in that case). Restored: 47/47 pass.
2. **INFO — `addr` level cap was applied after `split('.')`** (`address.ts`). A URL-sized
   string was fully split before the 64-level cap rejected it: a transient allocation bounded
   by the URL, at boot only. **Fixed** anyway, because it is two lines: `MAX_ADDRESS_LENGTH`
   (900) is checked on the raw string before splitting. Test added to the rejection table.
3. **INFO — the address version accepts 9 digits** (`address.ts`). `v999999999/0` parses while
   levels are range-capped. It reaches only HUD text and the URL, so it is recorded and left.

## Best practice checked (2026-11-23)

- W3C WebGPU spec §2.1.5, "Invalid data" (CR Draft, 2026-11-16): NaN/Inf in uploaded data
  affects arithmetic results only, with no other side effects. Basis for claim 2.
- OWASP DOM-Based XSS Prevention Cheat Sheet, rules #6/#7: `textContent` and fixed-name
  attribute assignment are safe sinks. Basis for claim 3.

## Floor at audit close

- `npm test` — 47 tests in 7 files, all passed.
- `npm run build` — `tsc --noEmit` clean, Vite build ok.
- `npm run capture` — 6/6 shots passed, including both precision-control shots.
- `npm run verify:dev` — PASS (shader rebuild keeps page, app and device; `device.ts` edit
  reboots the app and reuses the same `GPUDevice`).

Artifacts hashed into the run record: this file, the capture summary, and the two precision
capture PNGs.

## Addendum — three post-audit changes, and why none of them weakens a claim (2026-11-23)

Found by `src/frame/sharing.test.ts` (the round-trip test), after this audit closed. Recorded
here so the audit evidence is not silently stale.

1. **`parseAddress` now accepts the root, `v1/`.** The pattern changed from
   `/^v(\d{1,9})\/(.+)$/` to `(.*)`, with an explicit empty-body branch returning
   `{ levels: [] }`. This *widens* one input class. It does not touch the two caps the audit
   verified: `MAX_ADDRESS_LENGTH` (900) is still checked on the raw string before any split, and
   `MAX_LEVELS`/`MAX_LEVEL` still bound the split result. Zero levels is the smallest possible
   array, so no allocation risk is added. A hostile `v1/` gets a root frame and a HUD line.
2. **`formatNumber` now emits exponential form above 1e15 and below 1e-4.** Reached by `cam` and
   `t`, both still capped at 1e30/1e20 before serialization. `Number()` parses the emitted form,
   and the round-trip assertion in the sharing test covers every scale. No `+` is emitted, which
   removes a `%2B`-in-link cosmetic defect and the related `+`-decodes-as-space trap.
3. **`tools/capture.mjs` gained `assertAcceptedQuery`** and its manifest address regex was
   loosened to `^v\d+\/[-.\d]*$`. This *strengthens* the harness: claim 4 covered path traversal
   and URL injection, both unchanged; the new check reads `#hud-issues` via `textContent` (same
   safe sink as claim 3) and throws — it adds no write, no new file path and no new URL surface.
   Verified by injection: with the calls reordered, a manifest address of `v1/01` fails with the
   new message instead of silently capturing the default coordinate.

No new dependency, network call, secret or HTML sink was introduced by any of the three. The
verdict for the slice is unchanged: no exposure, guards strengthened.