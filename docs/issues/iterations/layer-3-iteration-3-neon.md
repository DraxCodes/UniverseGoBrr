# Layer 3 iteration 3 — Neon density pass

Date: 2026-11-25
Branch: `agent/antigravity-layer3-density` (based on `ae909ba`)
Scope: Spiral-arm continuity and visual density pass across 1080p, 4K 1:1, and 12 seeds (no `perception` gate score is claimed here; re-gating stays in the owner's workflow).

## Summary of changes

1. **Rich-tier disc count and emission rebalance (`src/universe/galaxy.ts`, `GALAXY_VERSION` `7 → 8`).**
   - Raised `GALAXY_TIER_STARS.rich.disc` from `40000` to `55000` (`local` unchanged at `5000`; `local + disc = 60,000 <= 60_000` budget). `medium` (`2500 / 20000`) and `low` (`1600 / 12000`) prefixes, `GALAXY_STREAM_VERSION` (`3`), `PLACEMENT_VERSION` (`2`), `starColor`, `starColorLocal`, `bulgeProfile`, `discCoreTaper`, and `armLum` are unchanged.
   - Outside the bulge, lifted the faint disc-star emission tail (`emitBase = 0.73 * base^0.42`) while keeping `base` untouched for `starColor` and `size`, and scaled bulge emission (`0.72 * base`) so faint outer-arm stars bridge into continuous bands without blowing out total frame luminance or losing warm-to-cool arm/lane hue separation.

2. **Impostor footprint, overlap PSF, and tone ceiling (`src/render/galaxy-scene.ts`, `src/gpu/galaxy.wgsl`).**
   - `GALAXY_STAR_MIN_PX` / `GALAXY_STAR_MAX_PX` raised from `3.0–5.0 px` to `4.65–5.05 px` (at 1080p, scaled by `viewportHeight / 1080`) with `sizeBias = 0.15 * legibility.lod`.
   - `GALAXY_GAIN` calibrated from `0.56` to `0.194` against the denser 55k disc and fuller sprite overlap; `rawExposure` uses `clamp(distRatio^-0.40, 0.80, 1.55)` (`1.0` at `lod === 0`); `discBootLift = 1 - 0.12 * (1 - legibility.lod)` preserves the boot-frame dust band's anisotropy (`axisRatio = 2.41`) behind the orrery.
   - In `fs_star`, softened the compact Gaussian mid-body (`exp(-r * r * 3.2) * w * 0.72 + w * 0.28`, `w = (1 - r * r)^2`) so neighbouring arm stars merge cleanly at both 1080p and 4K while remaining `C¹` smooth to zero at `r = 1`.
   - In `fs_composite`, kept `knee = 0.38` and the `0.93` channel clamp, trimmed `ceil_lum` (`0.90 → 0.79`) so every seed's nucleus peak stays strictly below the home star (`0.887`), and adjusted core occlusion alpha (`smoothstep(0.08, 0.48, mapped_lum) * galaxy.frame_info.x`, still zero at `lod = 0` and in dark lanes).

3. **Arm-window and 4K crop coverage metrics (`tools/measure-layer3.mjs`).**
   - Added `measureRegionCoverage(image, region, lumThreshold)` and wired `guardrails.armWindow1080p` (`240×160` at `(1150, 780)` in `layer3-galaxy-1080p.png`, threshold `0.06`) and `guardrails.armEdge2160p` (native `900×600` crop `layer3-arm-edge-2160p.png`, threshold `0.08`), plus `maxLumAt` in `measureNucleus`.

## Arm coverage comparison (`ae909ba` vs iteration 3)

| Region | Measure | `ae909ba` | Iteration 3 |
| --- | --- | --- | --- |
| `layer3-galaxy-1080p` `(1150, 780)` `240×160`, `lum > 0.06` | coverage | 38.0% | **55.0%** |
| `layer3-galaxy-1080p` `(1150, 780)` `240×160`, `lum > 0.06` | 4-connected components | 332 | **135** |
| `layer3-galaxy-1080p` `(1150, 780)` `240×160`, `lum > 0.06` | mean component / largest share | 44.0 px / 67.2% | **156.4 px / 62.2%** |
| `layer3-arm-edge-2160p` `900×600` 1:1, `lum > 0.08` | coverage | 21.6% | **31.1%** |
| `layer3-arm-edge-2160p` `900×600` 1:1, `lum > 0.08` | isolated blobs `>= 80 px` | 103 | **77** |
| `layer3-arm-edge-2160p` `900×600` 1:1, `lum > 0.08` | largest component (share) | 81,441 px (69.9%) | **135,059 px (80.5%)** |

## 12-seed comparison (`ae909ba` vs iteration 3)

All 12 seeds captured at `1920×1080`, `addr=v1/4.-2.7`, `t=1200`, pinned `layer3-galaxy-1080p` camera. Nucleus plateau and `>0.97` counts exclude the central `6 px` home-star window.

| Seed | `armMod` | `distR` | `platPx` / `>0.97` | Before `nucMaxLum` | After `nucMaxLum` | Before `litPx` | After `litPx` | Before `meanLum` | After `meanLum` | Before `ridge/tr` | After `ridge/tr` | Before `hueSep` | After `hueSep` | After `lane/arm` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ugb-0000` | 0.429 | 2.69 | 0 / 0 | 0.781 | **0.788** | 127,543 | **190,880** | 0.0329 | **0.0380** | 5.70 | **7.01** | 63.5° | **132.2°** | 1.77 |
| `ugb-0001` | 0.429 | 2.52 | 0 / 0 | 0.809 | **0.809** | 139,842 | **204,354** | 0.0345 | **0.0390** | 7.18 | **8.82** | 78.6° | **116.7°** | 1.38 |
| `ugb-0002` | 0.425 | 2.91 | 0 / 0 | 0.894 | **0.811** | 115,756 | **179,409** | 0.0312 | **0.0368** | 4.82 | **6.99** | 52.9° | **148.8°** | 1.96 |
| `ugb-0003` | 0.425 | 2.76 | 0 / 0 | 0.785 | **0.819** | 128,582 | **189,870** | 0.0326 | **0.0378** | 4.56 | **6.55** | 56.2° | **91.2°** | 1.84 |
| `ugb-0004` | 0.431 | 2.75 | 0 / 0 | 0.772 | **0.726** | 126,725 | **189,136** | 0.0326 | **0.0378** | 6.20 | **7.85** | 58.2° | **145.7°** | 1.86 |
| `ugb-0005` | 0.432 | 2.44 | 0 / 0 | 0.770 | **0.806** | 142,075 | **201,463** | 0.0351 | **0.0390** | 14.43 | **14.83** | 121.3° | **124.0°** | 1.86 |
| `ugb-0006` | 0.425 | 2.95 | 0 / 0 | 0.787 | **0.749** | 113,455 | **174,238** | 0.0309 | **0.0366** | 6.64 | **6.66** | 53.4° | **173.8°** | 1.75 |
| `ugb-0007` | 0.428 | 2.38 | 0 / 0 | 0.826 | **0.814** | 143,978 | **207,156** | 0.0360 | **0.0394** | 4.75 | **5.82** | 134.1° | **159.6°** | 1.61 |
| `ugb-0008` | 0.434 | 2.32 | 0 / 0 | 0.873 | **0.854** | 146,365 | **208,226** | 0.0365 | **0.0396** | 8.42 | **9.61** | 168.7° | **136.2°** | 1.84 |
| `ugb-0009` | 0.428 | 2.48 | 0 / 0 | 0.808 | **0.729** | 135,341 | **194,935** | 0.0348 | **0.0388** | 10.86 | **15.61** | 107.8° | **105.8°** | 1.68 |
| `ugb-0010` | 0.427 | 2.67 | 0 / 0 | 0.888 | **0.810** | 131,382 | **195,081** | 0.0332 | **0.0383** | 5.57 | **6.56** | 66.5° | **115.5°** | 1.95 |
| `ugb-0011` | 0.421 | 2.47 | 0 / 0 | 0.856 | **0.865** | 139,236 | **200,867** | 0.0345 | **0.0387** | 12.63 | **11.44** | 104.5° | **118.4°** | 1.60 |

12-seed summary: `litPx` mean `194,635` (`174,238..208,226`, up from `132,523`), `meanLum` mean `0.0383` (`0.0366..0.0396`), `nucMaxLum` `0.726..0.865` (all `< 0.887`, `0` plateau, `0 > 0.97`), `ridge/trough` mean `8.98` (`5.82..15.61`), `hueSep` `91.2°..173.8°`.

## Guardrail and live-probe checks

- **2160p galaxy (`layer3-galaxy-2160p`):** `platMax = 0 px` (`0×0`), `>0.97 = 0`, `nucMaxLum = 0.859`, `ridge/trough = 5.65`.
- **Home star (`layer3-galaxy-1080p` & `layer3-home-star-1080p`):** `peak = 0.887` at `(960, 539)` / `(196, 164)`, RGB `(226, 227, 219)`, `ringPeak = 0.646`, `gapMean = 0.0209` vs `ringMean = 0.0394`.
- **Dust band (`layer2-orrery`):** `axisRatio = 2.41` (`faintPx = 219,629`, `skyFloor = 0.0247`).
- **Layer 1 / Layer 2 / Sol invariance:** `layer1-precision-fixed` and `layer1-precision-naive` (`galaxy = null`) have `0` changed non-HUD pixels (`maxDeltaScene = 0`). On `layer2-orrery` and `layer3-sol-1080p`, the `14 px` solar-core centre has `0` changed pixels; on `layer2-closeup-{ocean,gas,rock,superearth}`, the central `100×100` planet disc has `0/10,000` changed pixels (`maxD = 0`). All `20/20` capture assertions pass.
- **Live handoff probe (`node tools/live-probe.mjs --url http://127.0.0.1:5199/`):** `steps: 81`, `decreases: 0`, `firstRampAt: "step-64"`, `firstFullAt: "step-68"`, `handoffSteps: 4`, `maxCount: 60000`, `sceneRows: 9`. On `.scratch/live-probe/handoff/step-80.png` outside the HUD (`x >= 450`): `above97 = 0`, `maxAll = 0.8871` at `[960, 539]` (home star), `maxNoHome = 0.7828` at `[1132, 577]` (galaxy nucleus).

## Proof commands

```sh
npx tsc --noEmit
npm test
npm run build && node tools/capture.mjs
node tools/measure-layer3.mjs --out .scratch/layer3-density --captures .scratch/captures --baseline .scratch/baseline-ae909ba
node tools/live-probe.mjs --url http://127.0.0.1:5199/
```
