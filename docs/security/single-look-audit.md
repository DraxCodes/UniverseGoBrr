# Single-look guard — security audit evidence

**Date:** 2026-11-23
**Scope:** the change set that makes dark the only presentation — `tools/capture.mjs`
(`assertDarkOnly`), `src/look-and-feel.test.ts`, `vitest.config.ts` (`css: true`),
`src/styles.css`, `index.html`, `.opencode/workflow.json` notes.
**Auditor:** `security-auditor` (GLM lineage), briefed on the five files; read no others.
**Verdict:** CONCERNS — two LOW findings, both guard strength, no exposure.

## Claims

| # | Claim | Result |
| --- | --- | --- |
| 1 | Comment stripping cannot be evaded by a hostile source | refuted, LOW — a fake `/*`…`*/` pair could swallow a live branch; `index.html` was only checked for the meta tag |
| 2 | `import.meta.glob` `?raw` adds no traversal or build-time execution | confirmed |
| 3 | Malformed `backgroundColor` cannot throw unhandled or produce a false pass | confirmed |
| 4 | `colorScheme: 'light'` is emulation, not a host read, and weakens nothing | confirmed |
| 5 | No secrets, PII or new network calls | confirmed |

## Findings and resolution

1. **LOW, `look-and-feel.test.ts`** — string-unaware comment stripping can hide a live
   media query. **Fixed:** a second, structural check runs on the *raw* text for
   `@media … prefers-color-scheme`, `@import … (prefers-color-scheme)` and
   `matchMedia(…(prefers-color-scheme)`. Verified by injecting the exact evasion — a fake
   `/*` / `*/` pair around a live `@media (prefers-color-scheme: light)` rule: both tests now
   fail.
2. **LOW, `look-and-feel.test.ts`** — `index.html` was not scanned for the rule. **Fixed:**
   `index.html` is now in the same scanned set. Verified by adding an inline
   `<style media="(prefers-color-scheme: light)">` to `index.html`: the broad check fails.

Runtime backstop unchanged: `assertDarkOnly()` fails a shot whose `color-scheme` is not
`dark` or whose backdrop luminance exceeds 40, with the browser context emulating a light OS
preference. Verified by building a light stylesheet: 0/4 shots passed with
`document color-scheme is "light", not dark` and `backdrop rgb(244, 246, 251) is light`.

## Floor at audit close

- `npm test` — 22 tests in 4 files, all passed.
- `npm run build` — passed.
- `npm run capture` — 4/4 shots passed.
- `npm run verify:dev` — PASS.
- `base doctor .` — No errors. `base check .` — Clean (265 files).

Evidence hashed into the run record: this file, the capture summary, and the capture PNGs.