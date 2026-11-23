# Desktop capture widths, and why there is a DPR-2 shot

Written against the Layer 0/1 capture harness (Playwright + Chrome 157, 2026-11-23).

**Shot names changed at Layer 2.** The three-width sweep plus the DPR-2 shot are now
`desktop-1080p`, `desktop-1440p`, `desktop-2160p` and `desktop-2160p-scaled`, because they now
photograph the star system rather than the Layer 0 starfield. The two precision-control shots keep
their `layer1-` names, and `layer2-orrery*` are the content shots. Any older run record that
references `layer0-*.png` is historical: those hashes are of the starfield build.

## The rule

This project is desktop-only and full-bleed (spec §1). The seam's capture widths are
**1920, 2560, 3840 CSS px** — 1080p, 1440p and 4K at 100% OS scaling — plus one
**1920 CSS px at DPR 2** shot named `layer0-2160p-scaled`.

That last shot exists because most 4K displays do not run at 100% scaling. A 3840×2160 panel
at 200% scaling has a **1920×1080 CSS viewport** with `devicePixelRatio === 2`. It has the
same physical pixels as the 100% shot but twice the UI size, so the two are not redundant: one
proves the layout at 3840 CSS px, the other proves the DPR path at 3840 physical px.

## How the harness gets there

- `capture/shots.json` may carry `"dpr": 2`; the harness defaults it to 1 and validates it to
  `[1, 2]`, matching the renderer's clamp in `src/gpu/renderer.ts` (`resize()`).
- The context is created with `deviceScaleFactor: shot.dpr ?? 1`. Playwright maps that to
  `window.devicePixelRatio`, so the renderer sizes the swap chain from it.
- Each shot record in `summary.json` carries `viewport` (`width`, `height`, `dpr`) and
  `canvas` (`width`, `height`, `cssWidth`, `cssHeight`).

## What fails if this breaks

`assertFullBleed()` in `tools/capture.mjs` rejects a shot whose canvas CSS size does not equal
the viewport, or whose backing store is not `cssSize × clampedDpr`. If a future change gives
the canvas a margin, a max-width, or ignores DPR, the capture fails instead of quietly
producing a letterboxed image.

## Related

The dev HUD is nudged up with CSS `zoom` above 2400 px and 3200 px (`src/styles.css`) so it
stays legible in the 1440p/4K evidence. That is a dev-HUD-only hack; the product HUD arrives
at Layer 2 and should size properly instead. `zoom` is fine here because WebGPU means
Chromium.

## Appearance is not a capture variable

There is one look, dark (ADR-0007), so `shots.json` has no theme field. The Playwright context
is created with `colorScheme: 'light'` on purpose: the page must stay dark when the OS prefers
light. `assertDarkOnly()` fails a shot if `color-scheme` is not `dark`, if the body backdrop is
light, or if the emulation itself did not apply. `summary.json` records the observation as
`appearance`.