# What bounds perception on the orrery, and how it was measured

Written 2026-11-23 against the Layer 2 `perception` gate. Written because the same three things
kept coming back in gate reports and each needed a *measurement*, not an opinion.

## 1. Population: a body that is lit is not a body you can see

The gate counted 8 separable planets where the HUD claims 9. The cause was not size — the inner
worlds are 15–20 px discs — but the **lit fraction**. At the orrery's sun angle most inner discs
are 85–90% night, so the only pixels above the sky were a 4–6 px crescent.

A flat ambient lift was tried and rejected: it made every small body evenly lit at the wrong light
angle, which reads worse than a crescent. The fix is the **wrap term** in the diffuse:

```wgsl
let smallWorld = 1.0 - clamp(detail, 0.0, 1.0);   // detail = radiusPx / 42, clamped to 1
let wrap = 0.14 + 1.25 * smallWorld * smallWorld;
let diffuse = pow(clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0), 0.9);
```

`detail` is the per-instance ramp the renderer already uploads (`instanceData[base + 12]`), so
close-ups (`detail = 1`) keep the tight 0.14 terminator and only orrery-scale bodies widen.

**How to check it:** crop the expected body centre at 4–8× with `NearestNeighbor` and look for a
filled disc with a lit side and a shaded limb. Sampling a single pixel at the body's coordinates
tells you nothing — the crescent may be one pixel off the centre, and space is `rgb(4,5,7)`.

## 2. A "hole" in the ice was relief shading

The gate reported a 5 px dark speck inside the ocean world's ice cap at ~(996,437). It was not the
ice tone and not a NaN: it was the **ocean relief** shading a tilted normal through the sheet.
The ocean branch gives land `relief · 1.15` bump, and the cap is drawn over the same height field,
so high terrain under the ice tilted the normal and the white sheet went dark.

Fix: gate the ocean bump on latitude, because ice is flat —
`· (1.0 - smoothstep(0.70, 0.84, abs(dir.y)))`.

**How to check it:** sample a transect across the speck and compare against the surrounding ice.
A colour that is *neutral-dark* rather than *warm* is shading, not a surface class leaking through
(ocean land is olive, sea is navy, the sunset band is warm).

## 3. Small worlds at 1:1 need a different acceptance test than close-ups

The gate scores 1:1 first. A 25 px storm that reads as a smooth oval at 6× is a nit; a 10 px planet
that reads as a dot at 1:1 is a level-setter. So:

- judge the **storm** at 6× (a spiral with an eye, arms broken by noise — a perfect spiral is as
  much a decal as the oval it replaced), and at 1:1 only check that it reads as a spot;
- judge the **population** at 1:1 by counting discs, and use the 4–8× crop only to confirm the
  identity of one that looks ambiguous.

## The probes that are not shots

`npm run capture` pins `t`, so every shot is "ready and paused". The states that bound the score
are captured by two tools scripts, because they cannot be expressed as a pinned frame:

| Script | What it proves |
| --- | --- |
| `npm run probe:state` (`tools/state-probe.mjs`) | booting (`status: creating pipeline`), rejected URL (issue banner lists both bad params), unpinned clock (`… s · live`), no WebGPU (fatal panel, HUD hidden) |
| `npm run probe:live` (`tools/live-probe.mjs`) | the ring fades do not pop as the eye crosses the threshold: 18 wheel steps from 45 AU in to 3.4 AU and 20 out to the 284 AU clamp, max mean-luminance step ~7× the median |

Both talk to the Vite dev server on 5173 and write under `.scratch/`; they are evidence tools, not
part of the deterministic shot set. The state probe delays `/src/main.ts` with `page.route` to catch
the boot frame, and overrides `navigator.gpu` with `addInitScript` for the fatal panel.

Note on what the live probe can and cannot see: mean luminance is a whole-frame statistic, so it
catches a *large* pop and misses a thin ring flickering. The per-step PNGs are kept for the frames
around the threshold (`in/step-05`…`07`) so that case can be inspected directly.