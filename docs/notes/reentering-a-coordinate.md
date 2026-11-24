# Re-entering a coordinate rebuilds the app, it does not patch the scene

**Written against:** `8c62720` (Layer 4 lane 2, 2026-11-24).

## The mechanism

`createRenderer` captures the address's content once: `system` and `galaxy` are built in `init()`
and handed to the renderer, which owns them for its lifetime. There is no `setScene` and no
`replaceGalaxy`. A different address is a different scene, so changing `state.address` in place
leaves the picture showing the old place.

`src/main.ts` therefore routes every coordinate change — first boot, Back/Forward, a committed
travel — through `start()`:

1. bump `bootGeneration`, take `previous = app`, set `app = null` and `ready = false`;
2. `previous?.dispose()` (controls, listeners, renderer);
3. `init(attempt)`, which re-parses `location.search` and builds the new scene.

`popstate` calls `start()`. Without that listener the URL and the picture disagree after Back,
which is exactly the failure the history contract exists to prevent.

## The trap

**Do not add a second way to change the scene.** A "just update the galaxy" path would have to
re-derive the system, the galaxy, the camera default and the HUD, i.e. duplicate `init`, and the two
would drift. A travel is deliberately defined as *write the arrival URL, then re-enter it*
(ADR-0012), so the travel path and the shared-link path cannot disagree.

**The GPU device survives the rebuild.** `initDevice()` caches its promise in
`src/gpu/device.ts` (module-level `pending`, plus `import.meta.hot.data` across HMR), so `start()`
does not request a second adapter or device. If you see a second device in a dev session, that cache
is what broke — not the rebuild.

**The latest attempt must win.** `init(attempt)` checks `attempt !== bootGeneration` after each
`await` (device acquisition, pipeline creation) and throws. A stale init that finished late would
otherwise install a renderer for the previous URL over the new one. `start()` ignores its own thrown
error when it is superseded, so no fatal panel is painted over the newer scene.

**Boot writing the URL is a replace, not a push.** `persist()` normalises the entry in place (it
adds the chosen `cam`). Only a committed arrival pushes (`historyWrite` in `src/state/url-state.ts`),
so one drag does not create a history entry and Back retraces places.

**The writer must not be able to write what the reader rejects.** `parseUrlState` caps `t` at
`±1e20` and only accepts a four-digit ISO year, so an arrival that pushes either past its bound
would reload as a *different* state — the pin dropped, or the epoch reset to 2000. The audit found
exactly that, so `advanceClock` returns `{ ok: false, reason }` when the arrival clock leaves the
range and `commitTravel` refuses the jump instead of writing the link. If you add another URL field
that travel can move, give it the same treatment: the write and the read must be proved by a
`parseUrlState(urlForState(...))` round trip in the tests, not by inspection.

## What to do instead

- Any new coordinate-changing action: build the complete arrival `UrlState`, call `writeUrl(next,
  'arrival')`, then `void start()`. Do not mutate `state.address` and hope.
- Any new same-place view change (camera, pan, reset, pin): call `persist()`, which is
  `writeUrl(state, 'framing')`.
- A new scene field that `createRenderer` captures must either be part of the address's content
  (so the rebuild handles it) or be updatable through an existing renderer handle. If it is neither,
  `start()` is the only correct path.

## Evidence this works

`npm run probe:travel` (`tools/travel-probe.mjs`) drives the built app: travel, reload the arrival
link, Back, Forward, and a framing write. It asserts the arrival link reproduces the state exactly
and that `history.length` is constant for a framing write. Run it after any change to `start()` or
`init()`.