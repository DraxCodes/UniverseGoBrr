# Layer 0 security audit — evidence

**Date:** 2026-11-23
**Scope:** the uncommitted Layer 0 scaffold (no git repo; current working tree is the fixed point).
**Auditor:** `security-auditor` (GLM lineage), briefed on 27 named files; read no other source.
**Verdict:** PASS — no findings.

## Claims checked

1. URL `seed`, `epoch`, `t`, `cam` are validated; no URL-derived value reaches an HTML or
   shell sink; rendering uses `textContent`; seed is restricted to `[A-Za-z0-9._-]{1,64}`.
2. Capture and dev-loop scripts bind only to `127.0.0.1`, launch fixed local binaries, never
   interpolate manifest/URL values into a shell, and validate shot names before using them as
   filenames.
3. No secrets, tokens, PII or external network calls; `.scratch/` is local evidence only - the tracked record under `docs/` carries no
   credentials, and provider keys come from `{env:...}` references.
4. `window.__ugb` exposes only local state and a GPU readback.
5. URL input cannot drive GPU allocations out of bounds; the readback loop stays inside its
   buffer.

## Result by claim

| Claim | Verdict |
| --- | --- |
| 1. URL handling | confirmed |
| 2. Harness scripts | confirmed |
| 3. Secrets / exposure | none |
| 4. Debug surface | confirmed |
| 5. GPU bounds | confirmed |

Informational and contained: `tools/capture.mjs --url` can point the harness at any origin;
its console output is printed and stored as data, never executed. It is an operator-only flag.

## Follow-up

After the report, query serialization in `src/state/url-state.ts` was changed to leave `:` and
`,` readable (`epoch=...T00:00:00.000Z`, `cam=12,-4,...`) instead of percent-encoding them.
The auditor re-checked the parse/validate path and render sinks: claim 1 intact, no injection
or parsing ambiguity, 17/17 tests passing.

## Floor at audit time

- `npm test` — 17 tests in 3 files, all passed.
- `npm run build` — passed (`tsc --noEmit` + Vite production build).

Artifacts hashed into the run record: this file, the capture summary, and both screenshots.