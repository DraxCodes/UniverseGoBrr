---
date: 2026-11-25
verified_against: 33166f6 and ae909ba
files: [tools/live-probe.mjs, tools/measure-layer3.mjs]
status: active
---

# A stale dev server on 5173 fakes "before" and "after" evidence

**Cause.** `npm run dev` leaves a Vite server listening on 5173 when its parent shell goes away.
`--strictPort` only stops *your* server from starting; it does not stop your readiness check from
succeeding against somebody else's. A wait loop that polls `http://127.0.0.1:5173/` for a 200
cannot tell the two apart, so the probe drives the old build and every frame is silently from the
wrong tree.

Seen on 2026-11-25: a `vite` rooted at `C:\Users\joelp\code\UniverseGoBrr` (the `33166f6` tree) had
been listening since 06:51. Two `live-probe` runs — one in the review worktree at `ae909ba`, one in
the baseline worktree — produced **byte-identical** PNGs (step-00, step-65, step-80) and identical
`summary.json` values. Both had measured the baseline. The tell was a frame with max luminance
`1.0` and 6,025 px above 0.97: impossible on a build whose composite clamps at 0.93.

The same class of collision applies to 4173, which `npm run capture` and `tools/measure-layer3.mjs`
each start as their own `vite preview`: a leftover preview serves an old `dist/`, and the capture
looks clean while showing the previous build.

**What to do instead.**

1. Before trusting any probe frame, find out who owns the port and what tree it serves:

   ```powershell
   Get-NetTCPConnection -LocalPort 5173 -State Listen |
     ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)" } |
     Select-Object -ExpandProperty CommandLine
   ```

   The `vite.js` path tells you nothing on its own — the *cwd* of that process is the tree. If the
   command line cannot be tied to the worktree you are testing, kill the listener.
2. Better, give each run its own port and pass it explicitly, so a collision is impossible:

   ```powershell
   npm run dev -- --port 5199 --strictPort
   node tools/live-probe.mjs --url http://127.0.0.1:5199/
   ```

   `tools/measure-layer3.mjs` has no port flag; free 4173 first, or run captures one at a time.
3. Prove a frame came from the build under test with a **build-specific invariant**, not a date or a
   filename. For the Layer 3 HDR pass: `step-80.png` must have 0 px above 0.97 outside the HUD and
   max luminance ≤ 0.887, because the composite clamps every channel at 0.93. A frame with any
   pixel at 1.0 is from a build without the clamp.
4. Identical `summary.json` numbers across two builds are not "the change is neutral" — they are a
   suspect. Hash the frames and compare.

**Evidence.** `sha256` of `handoff/step-80.png` matched across the two worktrees before the fix
(`C28B66F0D454…` in both) and diverged after it (`B8D42F1DED30…` review vs `C28B66F0D454…` base).
The after run: `above97Scene 0`, `maxScene 0.8871`; the stale baseline frame: `above97Scene 6025`,
`maxScene 1.0`. Files: `.scratch/live-probe/handoff/step-80.png` and the preserved
`.scratch/live-probe-stale-5173/` set in the review worktree.