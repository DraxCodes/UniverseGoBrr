# Rapid double-writes to one file can produce a single HMR update

Written against Vite 8.3.8 + chokidar on Windows, Layer 0 dev-loop check (2026-11-23).

## Symptom

A script that appends a marker to a watched source file, waits for the HMR update, then
immediately restores the original contents sees the first update but no second one. The page
stays on the marker version and the check times out. No error is logged by Vite or the
browser.

## Cause

Chokidar's Windows "atomic write" handling coalesces file events that arrive inside a short
window (~100 ms). The restore write lands in that window, so the watcher emits one change for
both writes. This is invisible in normal editing because a person types far slower than that.

## What to do instead

Leave a gap before the next write when a test drives HMR:

```js
await delay(300);
await writeFile(file, original);
```

See `tools/check-dev-loop.mjs`. Do not treat the missing second update as an HMR bug; verify
by checking that `window.__ugb.bootId` / `pipelineGeneration` actually changed before writing
again.

## A second, worse variant: the server keeps serving the *previous* transform

Observed 2026-11-23 (Vite 8.3.8), two sequential edits to `src/gpu/renderer.ts` minutes apart.
The browser reported `ReferenceError: buildOrbitVertices is not defined`, which is impossible
for a hoisted function declaration that exists in the file. The cause was the dev server: it had
transformed edit 1 (the call site) and was still serving the pre-edit-2 module.

Confirm it instead of guessing, by asking the dev server what it is actually serving:

```sh
# does the served module contain the symbol you just added?
(Invoke-WebRequest -Uri http://127.0.0.1:5173/src/gpu/renderer.ts -UseBasicParsing).Content -match 'buildOrbitVertices'
```

If the served text disagrees with the file on disk, restart `vite` — do not restart the browser,
and do not "fix" the code you already wrote. The HMR log in the dev-server output also shows
which files it thinks it updated, and each module is served with a `?t=<timestamp>` cache key, so
two different `?t=` values in one stack trace means two different module versions were live.