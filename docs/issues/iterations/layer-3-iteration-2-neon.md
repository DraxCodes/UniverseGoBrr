# Layer 3 iteration 2 — Neon visual pass

Date: 2026-11-24
Branch: `agent/antigravity-layer3-visual-pass` (based on `33166f6`)
Scope: Tone & colour grading, cross-seed density balance, and reference-mechanism measurements (no `perception` gate score is claimed here; re-gating stays in the owner's workflow).

## Summary of changes

1. **Galaxy-only HDR accumulation and soft-shoulder tone curve (`src/gpu/galaxy.wgsl`, `src/gpu/renderer.ts`).**
   - Instanced galaxy impostors accumulate additively into an offscreen `rgba16float` target (`GALAXY_HDR_FORMAT`), then composite over the background sky in `stage0 pass` via `vs_composite` / `fs_composite`.
   - `fs_star` replaces the wide linear-halo sprite (`pow(1 - d, 2.2) * 0.86 + (1 - d) * 0.14`) with a compact Gaussian-core PSF (`exp(-r * r * 6.5) * (1 - r * r)^2 * 0.82 + (1 - r * r)^3 * 0.18`), preserving `C¹` smooth edges at `r = 1` without veiling the inter-arm lanes.
   - `fs_composite` keeps linear identity below `knee = 0.38`, applies a `C¹` rational shoulder up to `ceil_lum = 0.90` with a warm-ivory highlight roll-off (`smoothstep(0.75, 4.5, lum) * 0.55`) and `0.93` channel clamp, and gates premultiplied optical-depth alpha by `smoothstep(0.10, 0.65, mapped_lum) * galaxy.frame_info.x` so at `lod = 1` the dense luminous core occludes background infinity stars behind it while `lod = 0` and dark lanes stay pure additive.
   - Because `rgba16float` accumulation and compositing are confined strictly to the galaxy pass, `scene.wgsl`, `stage0.wgsl`, and `layer1-precision-*` (`galaxy = null`) remain bit-identical.

2. **Graded core falloff, arm luminosity, and warm-to-cool palette (`src/universe/galaxy.ts`, `GALAXY_VERSION` `6 → 7`).**
   - `discCoreTaper` (`r / (r + 0.14) * 1.4`) cancels the exponential disc's `1/r` 2D surface-density cusp near `r = 0`, removing the clipped diagonal bar and dark moat seen on `33166f6`.
   - `bulgeProfile` (`0.15 + 0.85 * exp(-3.8 * u^2)`) grades the spherical bulge into a smooth warm ivory-gold to amber-gold core.
   - Non-bulge disc luminosity weights toward spiral arms (`armLum = 0.16 + 0.84 * armMix^1.45`) without changing star coordinates or `armModulation`.
   - Stellar colour (`starColor`) is driven by intrinsic `base` brightness rather than post-taper luminosity: bulge and inter-arm lanes stay warm amber-gold (`R > G > B`), while outer spiral arms shift cleanly from warm cream to pale ice-blue-white (`B > G > R`, no magenta).

3. **Cross-seed apparent-density balance and boot dust-band preservation (`src/render/galaxy-scene.ts`).**
   - `GALAXY_GAIN` is calibrated to `0.56` against the tighter Gaussian-core PSF.
   - At galaxy scale (`legibility.lod`), `writeGalaxyFrame` computes `distRatio = centreDistance / (2.6 * GALAXY_RADIUS_M)` and applies bounded apparent-area exposure (`rawExposure = clamp(distRatio^-1.25, 0.68, 1.55)`) plus a bounded footprint bias clamped strictly inside `[GALAXY_STAR_MIN_PX, GALAXY_STAR_MAX_PX]`.
   - At `lod = 0`, `exposure === 1.0` and `discBootLift = 1 + 0.25 * (1 - lod)` preserves the boot-frame dust band's anisotropy on `layer2-orrery`.

4. **Reproducible 12-seed measurement tool (`tools/measure-layer3.mjs`, `npm run measure:layer3`).**
   - Captures `ugb-0000`..`ugb-0011` at the pinned `layer3-galaxy-1080p` camera plus native `240×240` (1080p) and `480×480` (2160p) nucleus crops for `ugb-0000`, and measures `armModulation`, nucleus plateau & `>0.97` pixels (excluding the central `6 px` home-star window), lit-pixel counts, disc mean RGB, `arm1080.ts`-exact ridge/trough, arm/lane hue separation, lane-to-arm width ratio, home star, dust band, and Layer 1/2/Sol scene pixel diffs.

## Baseline discrepancy note (`5f14277` vs `33166f6`)

The handoff brief's reference table (`12 px` 4K nucleus plateau, `10.67` 1080p ridge/trough, `4.17` dust-band axis ratio) was measured at `5f14277` (`GALAXY_VERSION = 4`). On the `33166f6` fixed point — after ADR-0011 (`0e41cfa`, `3349cf0`, `GALAXY_VERSION = 6`) re-keyed `v1/4.-2.7` from its private galaxy to `v1/4` and switched to address-based `placement` — the unmodified baseline measures:

- `layer3-galaxy-2160p`: `29 px` plateau (`29×19` bbox, `206 px` area), `509 px > 0.97`, `ridge/trough = 2.91`
- `layer3-galaxy-1080p` (`ugb-0000`): `14 px` plateau (`14×10` bbox, `51 px` area), `122 px > 0.97`, `ridge/trough = 3.79` (`3.19..8.02` across 12 seeds using the exact `arm1080.ts` `n >= 20` cell filter)
- `layer2-orrery` dust band (exact `.scratch/measure-band.mjs`): `axisRatio = 2.36`, `faintPx = 174,503`, `skyFloor = 0.0247`
- `layer3-home-star-1080p`: `peak = 0.887` at `(196, 164)` (full frame `(960, 539)`)

## 12-seed comparison (`33166f6` baseline vs Neon final)

All 12 seeds captured at `1920×1080`, `addr=v1/4.-2.7`, `t=1200`, pinned `layer3-galaxy-1080p` camera (`cam=726150025192868500000,886130388030334300000,-614393258688281300000,2.273020050191636,-0.75`). Nucleus plateau and `>0.97` counts exclude the central `6 px` home-star window; on `33166f6`, the baseline `>0.97` counts were dominated by the clipped nucleus bar (`8..183 px`).

| Seed | `armMod` | `distR` | Before `platPx` / `>0.97` | After `platPx` / `>0.97` | After `nucMaxLum` | Before `litPx` | After `litPx` | Before `meanRGB` (`R/B`) | After `meanRGB` (`R/B`) | Before `ridge/tr` | After `ridge/tr` | Before `hueSep` | After `hueSep` | After `lane/arm` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ugb-0000` | 0.432 | 2.69 | 14 / 122 | **0 / 0** | 0.781 | 165,099 | 127,543 | 0.174,0.153,0.167 (1.04) | 0.188,0.179,0.174 (1.08) | 3.79 | **5.70** | 2.1° | **63.5°** | 1.75 |
| `ugb-0001` | 0.429 | 2.52 | 2 / 8 | **0 / 0** | 0.809 | 169,314 | 139,842 | 0.164,0.144,0.156 (1.05) | 0.188,0.180,0.171 (1.10) | 4.91 | **7.18** | 2.9° | **78.6°** | 1.36 |
| `ugb-0002` | 0.428 | 2.91 | 15 / 183 | **0 / 0** | 0.894 | 156,092 | 115,756 | 0.186,0.164,0.180 (1.04) | 0.184,0.176,0.173 (1.06) | 3.70 | **4.82** | 2.4° | **52.9°** | 2.23 |
| `ugb-0003` | 0.429 | 2.76 | 3 / 27 | **0 / 0** | 0.785 | 164,271 | 128,582 | 0.175,0.154,0.168 (1.04) | 0.183,0.176,0.172 (1.06) | 3.26 | **4.56** | 6.5° | **56.2°** | 1.74 |
| `ugb-0004` | 0.430 | 2.75 | 13 / 122 | **0 / 0** | 0.772 | 164,424 | 126,725 | 0.177,0.155,0.170 (1.04) | 0.187,0.179,0.175 (1.07) | 4.49 | **6.20** | 5.0° | **58.2°** | 2.06 |
| `ugb-0005` | 0.432 | 2.44 | 4 / 33 | **0 / 0** | 0.770 | 168,322 | 142,075 | 0.158,0.140,0.151 (1.05) | 0.191,0.183,0.172 (1.11) | 8.02 | **14.43** | 5.0° | **121.3°** | 1.83 |
| `ugb-0006` | 0.424 | 2.95 | 5 / 124 | **0 / 0** | 0.787 | 152,942 | 113,455 | 0.188,0.165,0.180 (1.04) | 0.183,0.175,0.172 (1.06) | 3.83 | **6.64** | 5.6° | **53.4°** | 1.66 |
| `ugb-0007` | 0.429 | 2.38 | 1 / 20 | **0 / 0** | 0.826 | 164,560 | 143,978 | 0.154,0.138,0.145 (1.06) | 0.192,0.186,0.171 (1.12) | 3.19 | **4.75** | 10.4° | **134.1°** | 1.71 |
| `ugb-0008` | 0.435 | 2.32 | 4 / 40 | **0 / 0** | 0.873 | 168,608 | 146,365 | 0.151,0.136,0.143 (1.06) | 0.193,0.187,0.172 (1.13) | 5.64 | **8.42** | 2.4° | **168.7°** | 1.46 |
| `ugb-0009` | 0.428 | 2.48 | 13 / 88 | **0 / 0** | 0.808 | 163,920 | 135,341 | 0.160,0.143,0.152 (1.05) | 0.191,0.184,0.172 (1.11) | 6.51 | **10.86** | 2.8° | **107.8°** | 1.80 |
| `ugb-0010` | 0.428 | 2.67 | 4 / 29 | **0 / 0** | 0.888 | 166,760 | 131,382 | 0.173,0.152,0.166 (1.04) | 0.186,0.178,0.172 (1.08) | 3.69 | **5.57** | 2.5° | **66.5°** | 1.82 |
| `ugb-0011` | 0.419 | 2.47 | 0 / 10 | **0 / 0** | 0.856 | 169,000 | 139,236 | 0.162,0.143,0.154 (1.05) | 0.189,0.180,0.170 (1.11) | 6.94 | **12.63** | 9.7° | **104.5°** | 1.40 |

## Guardrail checks

- **2160p galaxy (`layer3-galaxy-2160p`):** `platMax = 0 px` (`0×0`), `>0.97 = 0`, `nucMaxLum = 0.863`, `ridge/trough = 4.67` (baseline: `29 px`, `509 px > 0.97`, `ridge/trough = 2.91`).
- **Home star (`layer3-galaxy-1080p` & `layer3-home-star-1080p`):** `peak = 0.887` at `(960, 539)` / crop `(196, 164)`, RGB `(226, 227, 219)`, surrounding field ring peak improved `0.780 → 0.672`, gap mean `0.0202` vs ring mean `0.0318`.
- **Dust band (`layer2-orrery`):** `axisRatio = 2.40` (baseline `2.36`), `faintPx = 150,399` (baseline `174,503`), `skyFloor = 0.0247`.
- **Layer 1 / Layer 2 / Sol invariance:** `layer1-precision-fixed` and `layer1-precision-naive` (`galaxy = null`) have `0` changed non-HUD pixels (`maxDeltaScene = 0`). Shots with `galaxy !== null` (`desktop-*`, `layer2-closeup-*`, `layer2-orrery-*`, `layer3-sol-1080p`) show pixel differences exclusively in the background galaxy stars (`GALAXY_VERSION = 7`, Gaussian PSF, `GALAXY_GAIN = 0.56`, `discBootLift = 1.25`); foreground planets, star, orbits, and Sol system geometry are unchanged, and all 20/20 `npm run capture` assertions pass.

## Proof commands

```sh
npx tsc --noEmit
npm test
npm run build && npm run capture
node tools/measure-layer3.mjs --out .scratch/layer3-final --captures .scratch/captures --baseline .scratch/baseline-captures
```
