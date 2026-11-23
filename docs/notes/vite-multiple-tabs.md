# Vite opens extra tabs on every dev-server restart

Written against Vite (Layer 0 scaffolding, 2026-11-23).

## Symptom

Editing a file — especially `vite.config.ts` — can leave several browser tabs or windows
open, one per reload. Each tab is a second live instance of the app and a second
`GPUDevice`, which makes performance readings meaningless and burns GPU while you work.

## Cause

Three separate causes, and they usually combine:

1. **`server.open: true`.** Vite opens a tab whenever the *server* starts. The dev server
   restarts on config and env changes, so each of those opens another tab. Ordinary HMR
   updates do not.
2. **Port drift.** If the configured port is taken (a second dev server, an old instance
   that never died), Vite silently moves to the next port and opens a tab at the *new* URL.
   The old tab stays open and now talks to nothing. This is the usual source of "five tabs".
3. **Module-scope side effects.** HMR re-executes changed modules. A `window.open()`, or a
   `device = await requestAdapter()` at module top level, runs again on every hot update and
   duplicates whatever it created.

## What to do instead

- `server: { open: false, strictPort: true }` — never auto-open a tab, and fail loudly on a
  busy port instead of drifting to another one. Open `http://localhost:5173` once, by hand.
- No side effects at module scope. Acquire the `GPUDevice`, the canvas and the workers inside
  an explicit `init()` whose result is cached on `import.meta.hot.data`, so a hot update
  reuses the existing device.
- Prefer granular `import.meta.hot.accept()` boundaries over full reloads. For shader edits
  that means recreating the shader module and pipeline only — the page and the `GPUDevice`
  survive, which is both faster and removes the reload path entirely.

## A server left over from a previous session

The dev server outlives the session that started it. `strictPort` then fails the *new* session
with `Port 5173 is already in use`, which reads like a config error. Worse, the old process may
serve a **stale HTML/HUD transform** after `index.html` or a `ui/` edit — HMR does not always
cover those — so probes and captures can show the previous version of the page.

Find and clear it before starting the loop:

```powershell
(Get-NetTCPConnection -LocalPort 5173 -State Listen).OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object CreationDate,CommandLine
Stop-Process -Id <pid> -Force
```

The `CreationDate` older than the current session is the tell. Then `npm run dev` and re-run
`npm run probe:state` / `probe:live`, which talk to 5173 directly.

## Verify

Edit a file five times in a row. Tab count must stay at one, and the console must not show a
new adapter request. If a new tab appears, read its port in the address bar: a different port
means cause 2, the same port means cause 1 or 3.