#!/usr/bin/env node
/**
 * Reproducible Layer 3 measurement suite across 12 seeds and pinned captures.
 *
 * Usage:
 *   npm run measure:layer3 -- --out .scratch/layer3-eval --captures .scratch/captures
 *   npm run measure:layer3 -- --out .scratch/layer3-iterA --captures .scratch/captures --baseline .scratch/baseline-captures
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:4173/';
const SEEDS = Array.from({ length: 12 }, (_, i) => `ugb-${String(i).padStart(4, '0')}`);
const ADDRESS_STR = 'v1/4.0.-2.7'; // star -2 (sector 0), which is the orrery system
const EPOCH_STR = '2000-01-01T00:00:00.000Z';
const T_VAL = 1200;
const GALAXY_CAM = {
  x: 726150025192868500000,
  y: 886130388030334300000,
  z: -614393258688281300000,
  yaw: 2.273020050191636,
  pitch: -0.75,
};
const LAYER12_SHOTS = [
  'desktop-1080p',
  'desktop-1440p',
  'desktop-2160p',
  'desktop-2160p-scaled',
  'layer1-precision-fixed',
  'layer1-precision-naive',
  'layer2-closeup-ocean',
  'layer2-closeup-gas',
  'layer2-closeup-rock',
  'layer2-closeup-superearth',
  'layer2-orrery',
  'layer2-orrery-1440p',
  'layer2-orrery-2160p',
  'layer3-sol-1080p',
];

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(root, args.out);
const capturesDir = path.resolve(root, args.captures);
const baselineDir = args.baseline ? path.resolve(root, args.baseline) : null;

await mkdir(outDir, { recursive: true });

const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

let previewServer = null;
let browser = null;

try {
  const [
    { generateGalaxy, toDiscFrame },
    { armModulation },
    { generateSystem },
    { displayScaleM },
    { cameraBasis, FOV_Y_RAD },
    { GALAXY_RADIUS_M },
    { parseAddressOrThrow },
  ] = await Promise.all([
    vite.ssrLoadModule('/src/universe/galaxy.ts'),
    vite.ssrLoadModule('/src/render/galaxy-scene.ts'),
    vite.ssrLoadModule('/src/universe/system.ts'),
    vite.ssrLoadModule('/src/render/system-scene.ts'),
    vite.ssrLoadModule('/src/render/camera.ts'),
    vite.ssrLoadModule('/src/render/scale.ts'),
    vite.ssrLoadModule('/src/frame/address.ts'),
  ]);

  const address = parseAddressOrThrow(ADDRESS_STR);
  const basis = cameraBasis(GALAXY_CAM.yaw, GALAXY_CAM.pitch);

  if (!args.skipCapture) {
    await access(path.join(root, 'dist', 'index.html'));
    previewServer = await preview({
      root,
      preview: { host: '127.0.0.1', port: 4173, strictPort: true },
      logLevel: 'warn',
    });
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
    });

    for (const seed of SEEDS) {
      const file = path.join(outDir, `seed-${seed}.png`);
      await captureUrl(browser, DEFAULT_BASE_URL, seed, 1920, 1080, file, null);
    }

    const g0 = generateGalaxy('ugb-0000', address, 'rich');
    const s0 = displayScaleM(generateSystem('ugb-0000', address));
    const nuc1080 = projectPoint(g0.centre, GALAXY_CAM, s0, basis, 1920, 1080, FOV_Y_RAD);
    const crop1080 = clampCrop(nuc1080.x - 120, nuc1080.y - 120, 240, 240, 1920, 1080);
    await captureUrl(
      browser,
      DEFAULT_BASE_URL,
      'ugb-0000',
      1920,
      1080,
      path.join(outDir, 'nucleus-crop-1080p.png'),
      crop1080,
    );

    const nuc2160 = projectPoint(g0.centre, GALAXY_CAM, s0, basis, 3840, 2160, FOV_Y_RAD);
    const crop2160 = clampCrop(nuc2160.x - 240, nuc2160.y - 240, 480, 480, 3840, 2160);
    await captureUrl(
      browser,
      DEFAULT_BASE_URL,
      'ugb-0000',
      3840,
      2160,
      path.join(outDir, 'nucleus-crop-2160p.png'),
      crop2160,
    );

    await browser.close();
    browser = null;
    await previewServer.close();
    previewServer = null;
  }

  const seedMetrics = [];
  for (const seed of SEEDS) {
    const file = path.join(outDir, `seed-${seed}.png`);
    const image = decodePng(await readFile(file));
    const galaxy = generateGalaxy(seed, address, 'rich');
    const scaleM = displayScaleM(generateSystem(seed, address));
    const mod = armModulation(galaxy);
    const centreDistR =
      Math.hypot(
        galaxy.centre.x - GALAXY_CAM.x,
        galaxy.centre.y - GALAXY_CAM.y,
        galaxy.centre.z - GALAXY_CAM.z,
      ) / GALAXY_RADIUS_M;

    const nuc = measureNucleus(image);
    const disc = measureDiscTone(image);
    const arm = measureArmProfile(image, galaxy, scaleM, basis, GALAXY_RADIUS_M, FOV_Y_RAD, toDiscFrame);

    seedMetrics.push({
      seed,
      armModulation: mod,
      centreDistR,
      plateauAreaPx: nuc.plateauAreaPx,
      plateauMaxDimPx: nuc.plateauMaxDimPx,
      plateauBbox: nuc.plateauBbox,
      plateauEqDiaPx: nuc.plateauEqDiaPx,
      above97: nuc.above97,
      above99: nuc.above99,
      maxLum: nuc.maxLum,
      maxLumAt: nuc.maxLumAt,
      litPx: disc.litPx,
      meanLum: disc.meanLum,
      litMeanLum: disc.litMeanLum,
      discMeanRgb: disc.discMeanRgb,
      rOverB: disc.rOverB,
      ridgeTrough1080p: arm.ratio,
      armMeanRgb: arm.armMeanRgb,
      laneMeanRgb: arm.laneMeanRgb,
      armHueDeg: arm.armHueDeg,
      laneHueDeg: arm.laneHueDeg,
      hueSepDeg: arm.hueSepDeg,
      laneToArmWidthRatio: arm.laneToArmWidthRatio,
    });
  }

  const guardrails = {};
  const gal2160Path = path.join(capturesDir, 'layer3-galaxy-2160p.png');
  if (await exists(gal2160Path)) {
    const img2160 = decodePng(await readFile(gal2160Path));
    const g0 = generateGalaxy('ugb-0000', address, 'rich');
    const s0 = displayScaleM(generateSystem('ugb-0000', address));
    const nuc2160 = measureNucleus(img2160);
    const arm2160 = measureArmProfile(img2160, g0, s0, basis, GALAXY_RADIUS_M, FOV_Y_RAD, toDiscFrame);
    guardrails.galaxy2160p = {
      ...nuc2160,
      ridgeTrough4K: arm2160.ratio,
    };
  }

  const gal1080Path = path.join(capturesDir, 'layer3-galaxy-1080p.png');
  if (await exists(gal1080Path)) {
    const img1080 = decodePng(await readFile(gal1080Path));
    guardrails.homeStarFull1080p = measureHomeStar(img1080, 960, 540, 1);
    guardrails.armWindow1080p = measureRegionCoverage(
      img1080,
      { x: 1150, y: 780, width: 240, height: 160 },
      0.06,
    );
  }

  const armEdgePath = path.join(capturesDir, 'layer3-arm-edge-2160p.png');
  if (await exists(armEdgePath)) {
    const imgArmEdge = decodePng(await readFile(armEdgePath));
    guardrails.armEdge2160p = measureRegionCoverage(
      imgArmEdge,
      { x: 0, y: 0, width: imgArmEdge.width, height: imgArmEdge.height },
      0.08,
    );
  }

  const homeCropPath = path.join(capturesDir, 'layer3-home-star-1080p.png');
  if (await exists(homeCropPath)) {
    const imgHome = decodePng(await readFile(homeCropPath));
    // Home star projects to (960, 540) in full 1080p; clip in capture/shots.json is (764, 375).
    guardrails.homeStarCrop1080p = measureHomeStar(imgHome, 960 - 764, 540 - 375, 1, 0);
  }

  const orreryPath = path.join(capturesDir, 'layer2-orrery.png');
  if (await exists(orreryPath)) {
    const imgOrrery = decodePng(await readFile(orreryPath));
    guardrails.dustBand = measureDustBand(imgOrrery);
  }

  const baselineDiffs = [];
  if (baselineDir) {
    for (const name of LAYER12_SHOTS) {
      const curFile = path.join(capturesDir, `${name}.png`);
      const baseFile = path.join(baselineDir, `${name}.png`);
      if ((await exists(curFile)) && (await exists(baseFile))) {
        const curImg = decodePng(await readFile(curFile));
        const baseImg = decodePng(await readFile(baseFile));
        baselineDiffs.push({ name, ...diffImages(baseImg, curImg) });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    seeds: seedMetrics,
    summary: summarizeSeeds(seedMetrics),
    guardrails,
    baselineDiffs,
  };

  await writeFile(path.join(outDir, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (previewServer) await previewServer.close().catch(() => {});
  await vite.close().catch(() => {});
}

async function captureUrl(browserInstance, baseUrl, seed, width, height, file, clip) {
  const context = await browserInstance.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-GB',
  });
  try {
    const page = await context.newPage();
    const target = new URL(baseUrl);
    target.search = new URLSearchParams({
      seed,
      epoch: EPOCH_STR,
      addr: ADDRESS_STR,
      t: String(T_VAL),
      cam: [GALAXY_CAM.x, GALAXY_CAM.y, GALAXY_CAM.z, GALAXY_CAM.yaw, GALAXY_CAM.pitch].join(','),
    }).toString();

    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ugb?.ready === true, null, { timeout: 20_000 });
    await page.waitForFunction(() => (window.__ugb?.frame ?? 0) >= 3, null, { timeout: 10_000 });
    await page.waitForFunction(() => (window.__ugb?.fps ?? 0) > 0, null, { timeout: 5_000 });

    await page.screenshot({ path: file, fullPage: false, ...(clip ? { clip } : {}) });
  } finally {
    await context.close().catch(() => {});
  }
}

function projectPoint(point, cam, scaleM, basis, width, height, fovYRad) {
  const focalPx = height / (2 * Math.tan(fovYRad / 2));
  const dx = (point.x - cam.x) / scaleM;
  const dy = (point.y - cam.y) / scaleM;
  const dz = (point.z - cam.z) / scaleM;
  const rx = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
  const uy = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
  const fz = dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z;
  return {
    x: width / 2 + (rx / fz) * focalPx,
    y: height / 2 - (uy / fz) * focalPx,
  };
}

function clampCrop(x, y, cropW, cropH, width, height) {
  return {
    x: Math.max(0, Math.min(width - cropW, Math.round(x))),
    y: Math.max(0, Math.min(height - cropH, Math.round(y))),
    width: cropW,
    height: cropH,
  };
}

function rec709Lum(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function measureNucleus(image) {
  const { width, height, pixels } = image;
  const hudWidth = Math.round(450 * (height / 1080));
  // Exclude the foreground home star at the exact frame centre so nucleus/disc metrics do not
  // mix with hot-star seeds from system.ts (the home star is measured separately below).
  const cx = width / 2;
  const cy = height / 2;
  const homeHalf = Math.round(6 * (height / 1080));
  const clipped = new Uint8Array(width * height);
  let above97 = 0;
  let above99 = 0;
  let maxLum = 0;
  let maxLumAt = [0, 0];

  for (let y = 0; y < height; y += 1) {
    for (let x = hudWidth; x < width; x += 1) {
      if (Math.abs(x - cx) <= homeHalf && Math.abs(y - cy) <= homeHalf) continue;
      const idx = y * width + x;
      const p = idx * 4;
      const r = pixels[p];
      const g = pixels[p + 1];
      const b = pixels[p + 2];
      const lum = rec709Lum(r, g, b);
      if (lum > maxLum) {
        maxLum = lum;
        maxLumAt = [x, y];
      }
      if (lum > 0.97) above97 += 1;
      if (lum > 0.99) above99 += 1;
      if (r >= 254 && g >= 254 && b >= 254) clipped[idx] = 1;
    }
  }

  const seen = new Uint8Array(width * height);
  let bestCount = 0;
  let bestBbox = null;
  for (let start = 0; start < width * height; start += 1) {
    if (!clipped[start] || seen[start]) continue;
    let count = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > hudWidth && clipped[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack.push(p - 1);
      }
      if (x < width - 1 && clipped[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack.push(p + 1);
      }
      if (y > 0 && clipped[p - width] && !seen[p - width]) {
        seen[p - width] = 1;
        stack.push(p - width);
      }
      if (y < height - 1 && clipped[p + width] && !seen[p + width]) {
        seen[p + width] = 1;
        stack.push(p + width);
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestBbox = { w: maxX - minX + 1, h: maxY - minY + 1 };
    }
  }

  return {
    plateauAreaPx: bestCount,
    plateauMaxDimPx: bestBbox ? Math.max(bestBbox.w, bestBbox.h) : 0,
    plateauBbox: bestBbox ? `${bestBbox.w}x${bestBbox.h}` : '0x0',
    plateauEqDiaPx: Math.sqrt((4 * bestCount) / Math.PI),
    above97,
    above99,
    maxLum,
    maxLumAt,
  };
}

function measureRegionCoverage(image, region, lumThreshold) {
  const { width, height, pixels } = image;
  const x0 = Math.max(0, Math.min(width, region.x));
  const y0 = Math.max(0, Math.min(height, region.y));
  const x1 = Math.max(x0, Math.min(width, region.x + region.width));
  const y1 = Math.max(y0, Math.min(height, region.y + region.height));
  const rw = x1 - x0;
  const rh = y1 - y0;
  const totalPx = rw * rh;
  if (totalPx === 0) {
    return {
      region: { x: x0, y: y0, width: rw, height: rh },
      lumThreshold,
      totalPx: 0,
      litPx: 0,
      coverage: 0,
      componentCount: 0,
      meanComponentPx: 0,
      largestComponentPx: 0,
      largestComponentShare: 0,
      isolatedBlobsGe80: 0,
      meanLum: 0,
    };
  }

  const mask = new Uint8Array(totalPx);
  let litPx = 0;
  let sumLum = 0;
  for (let ry = 0; ry < rh; ry += 1) {
    const iy = y0 + ry;
    for (let rx = 0; rx < rw; rx += 1) {
      const ix = x0 + rx;
      const p = (iy * width + ix) * 4;
      const lum = rec709Lum(pixels[p], pixels[p + 1], pixels[p + 2]);
      sumLum += lum;
      if (lum > lumThreshold) {
        mask[ry * rw + rx] = 1;
        litPx += 1;
      }
    }
  }

  const seen = new Uint8Array(totalPx);
  const sizes = [];
  for (let start = 0; start < totalPx; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop();
      size += 1;
      const rx = idx % rw;
      const ry = (idx - rx) / rw;
      if (rx > 0 && mask[idx - 1] && !seen[idx - 1]) {
        seen[idx - 1] = 1;
        stack.push(idx - 1);
      }
      if (rx < rw - 1 && mask[idx + 1] && !seen[idx + 1]) {
        seen[idx + 1] = 1;
        stack.push(idx + 1);
      }
      if (ry > 0 && mask[idx - rw] && !seen[idx - rw]) {
        seen[idx - rw] = 1;
        stack.push(idx - rw);
      }
      if (ry < rh - 1 && mask[idx + rw] && !seen[idx + rw]) {
        seen[idx + rw] = 1;
        stack.push(idx + rw);
      }
    }
    sizes.push(size);
  }

  let largestComponentPx = 0;
  for (const size of sizes) {
    if (size > largestComponentPx) largestComponentPx = size;
  }
  const componentCount = sizes.length;
  let ge80 = 0;
  for (const size of sizes) {
    if (size >= 80) ge80 += 1;
  }
  const isolatedBlobsGe80 = largestComponentPx >= 80 ? ge80 - 1 : ge80;

  return {
    region: { x: x0, y: y0, width: rw, height: rh },
    lumThreshold,
    totalPx,
    litPx,
    coverage: litPx / totalPx,
    componentCount,
    meanComponentPx: componentCount > 0 ? litPx / componentCount : 0,
    largestComponentPx,
    largestComponentShare: litPx > 0 ? largestComponentPx / litPx : 0,
    isolatedBlobsGe80,
    meanLum: sumLum / totalPx,
  };
}

function measureDiscTone(image) {
  const { width, height, pixels } = image;
  const hudWidth = Math.round(450 * (height / 1080));
  let totalPx = 0;
  let sumLumAll = 0;
  let litPx = 0;
  let sumLitLum = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = hudWidth; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const r = pixels[p] / 255;
      const g = pixels[p + 1] / 255;
      const b = pixels[p + 2] / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumLumAll += lum;
      totalPx += 1;
      if (lum > 0.05) {
        litPx += 1;
        sumLitLum += lum;
        sumR += r;
        sumG += g;
        sumB += b;
      }
    }
  }

  const meanR = litPx > 0 ? sumR / litPx : 0;
  const meanG = litPx > 0 ? sumG / litPx : 0;
  const meanB = litPx > 0 ? sumB / litPx : 0;
  return {
    litPx,
    meanLum: totalPx > 0 ? sumLumAll / totalPx : 0,
    litMeanLum: litPx > 0 ? sumLitLum / litPx : 0,
    discMeanRgb: [meanR, meanG, meanB],
    rOverB: meanB > 0 ? meanR / meanB : 0,
  };
}

function measureArmProfile(image, galaxy, scaleM, basis, galaxyRadiusM, fovYRad, toDiscFrame) {
  const { width: W, height: H, pixels } = image;
  const focalPx = H / (2 * Math.tan(fovYRad / 2));
  const sampleRgb = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return [0, 0, 0, 0];
    const i = (yi * W + xi) * 4;
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    return [0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b];
  };

  const binR = 8;
  const binA = 72;
  const r0 = 0.30;
  const r1 = 0.95;
  const sum = new Float64Array(binR * binA);
  const sumR = new Float64Array(binR * binA);
  const sumG = new Float64Array(binR * binA);
  const sumB = new Float64Array(binR * binA);
  const cnt = new Float64Array(binR * binA);
  const rad = Math.max(1, Math.round(H / 1080));

  for (const star of galaxy.stars) {
    if (star.home) continue;
    const d = toDiscFrame(galaxy, star);
    const r = Math.hypot(d.x, d.z) / galaxyRadiusM;
    if (r < r0 || r >= r1) continue;
    const ui = Math.min(binR - 1, Math.floor(((r - r0) / (r1 - r0)) * binR));
    const ai = Math.min(
      binA - 1,
      Math.floor(((Math.atan2(d.z, d.x) + Math.PI) / (2 * Math.PI)) * binA),
    );
    const dx = (star.x - GALAXY_CAM.x) / scaleM;
    const dy = (star.y - GALAXY_CAM.y) / scaleM;
    const dz = (star.z - GALAXY_CAM.z) / scaleM;
    const rx = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
    const uy = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
    const fz = dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z;
    if (fz <= 0) continue;
    const sx = W / 2 + (rx / fz) * focalPx;
    const sy = H / 2 - (uy / fz) * focalPx;
    let sl = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let oy = -rad; oy <= rad; oy += 1) {
      for (let ox = -rad; ox <= rad; ox += 1) {
        const [l, cr, cg, cb] = sampleRgb(sx + ox, sy + oy);
        sl += l;
        sr += cr;
        sg += cg;
        sb += cb;
        n += 1;
      }
    }
    const cell = ui * binA + ai;
    sum[cell] += sl / n;
    sumR[cell] += sr / n;
    sumG[cell] += sg / n;
    sumB[cell] += sb / n;
    cnt[cell] += 1;
  }

  let aggRidge = 0;
  let aggTrough = 0;
  let armR = 0;
  let armG = 0;
  let armB = 0;
  let armN = 0;
  let laneR = 0;
  let laneG = 0;
  let laneB = 0;
  let laneN = 0;
  let laneWidthCells = 0;
  let armWidthCells = 0;

  for (let ri = 1; ri <= 5; ri += 1) {
    let best = -1;
    let worst = 1e9;
    const cells = [];
    for (let ai = 0; ai < binA; ai += 1) {
      const idx = ri * binA + ai;
      const n = cnt[idx];
      if (n < 20) continue;
      const v = sum[idx] / n;
      if (v > best) best = v;
      if (v < worst) worst = v;
      cells.push({
        v,
        r: sumR[idx] / n,
        g: sumG[idx] / n,
        b: sumB[idx] / n,
      });
    }
    if (cells.length === 0) continue;
    aggRidge += best;
    aggTrough += worst;

    const mid = 0.5 * (best + worst);
    for (const c of cells) {
      if (c.v < mid) laneWidthCells += 1;
      else armWidthCells += 1;
    }

    cells.sort((a, b) => a.v - b.v);
    const q = Math.max(1, Math.floor(cells.length * 0.25));
    for (let i = 0; i < q; i += 1) {
      laneR += cells[i].r;
      laneG += cells[i].g;
      laneB += cells[i].b;
      laneN += 1;
    }
    for (let i = cells.length - q; i < cells.length; i += 1) {
      armR += cells[i].r;
      armG += cells[i].g;
      armB += cells[i].b;
      armN += 1;
    }
  }

  const armMeanRgb = armN > 0 ? [armR / armN, armG / armN, armB / armN] : [0, 0, 0];
  const laneMeanRgb = laneN > 0 ? [laneR / laneN, laneG / laneN, laneB / laneN] : [0, 0, 0];
  const armHueDeg = rgbHueDeg(armMeanRgb);
  const laneHueDeg = rgbHueDeg(laneMeanRgb);
  const diff = Math.abs(armHueDeg - laneHueDeg);
  const hueSepDeg = Math.min(diff, 360 - diff);

  return {
    ratio: aggRidge / Math.max(1e-6, aggTrough),
    armMeanRgb,
    laneMeanRgb,
    armHueDeg,
    laneHueDeg,
    hueSepDeg,
    laneToArmWidthRatio: armWidthCells > 0 ? laneWidthCells / armWidthCells : 0,
  };
}

function measureHomeStar(image, cx, cy, scale, hudWidthOverride = null) {
  const { width, height, pixels } = image;
  const hudWidth = hudWidthOverride ?? Math.round(450 * (height / 1080));
  const half = Math.round(6 * scale);
  let corePeak = 0;
  let coreRgb = [0, 0, 0];
  let coreAt = [cx, cy];

  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x < hudWidth || x >= width || y < 0 || y >= height) continue;
      const p = (y * width + x) * 4;
      const lum = rec709Lum(pixels[p], pixels[p + 1], pixels[p + 2]);
      if (lum > corePeak) {
        corePeak = lum;
        coreRgb = [pixels[p], pixels[p + 1], pixels[p + 2]];
        coreAt = [x, y];
      }
    }
  }

  let ringPeak = 0;
  let ringSum = 0;
  let ringN = 0;
  const ringInner = Math.round(12 * scale);
  const ringOuter = Math.round(60 * scale);
  for (let y = cy - ringOuter; y <= cy + ringOuter; y += 1) {
    for (let x = cx - ringOuter; x <= cx + ringOuter; x += 1) {
      if (x < hudWidth || x >= width || y < 0 || y >= height) continue;
      const r = Math.hypot(x - cx, y - cy);
      if (r < ringInner || r > ringOuter) continue;
      const p = (y * width + x) * 4;
      const lum = rec709Lum(pixels[p], pixels[p + 1], pixels[p + 2]);
      if (lum > ringPeak) ringPeak = lum;
      ringSum += lum;
      ringN += 1;
    }
  }

  let gapSum = 0;
  let gapN = 0;
  const gapInner = Math.round(3 * scale);
  const gapOuter = Math.round(7 * scale);
  for (let y = cy - gapOuter; y <= cy + gapOuter; y += 1) {
    for (let x = cx - gapOuter; x <= cx + gapOuter; x += 1) {
      if (x < hudWidth || x >= width || y < 0 || y >= height) continue;
      const r = Math.hypot(x - cx, y - cy);
      if (r < gapInner || r > gapOuter) continue;
      const p = (y * width + x) * 4;
      gapSum += rec709Lum(pixels[p], pixels[p + 1], pixels[p + 2]);
      gapN += 1;
    }
  }

  return {
    corePeak,
    coreAt,
    coreRgb,
    coreHueDeg: rgbHueDeg(coreRgb.map((v) => v / 255)),
    ringPeak,
    ringMean: ringN > 0 ? ringSum / ringN : 0,
    gapMean: gapN > 0 ? gapSum / gapN : 0,
    peakRatio: corePeak / Math.max(1e-6, ringPeak),
  };
}

function measureDustBand(image) {
  const { width, height, pixels } = image;
  const hudWidth = Math.round(450 * (height / 1080));
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    lum[i] = rec709Lum(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
  }
  const skySamples = [];
  for (let y = height - 60; y < height - 10; y += 2) {
    for (let x = hudWidth; x < width; x += 3) skySamples.push(lum[y * width + x]);
  }
  skySamples.sort((a, b) => a - b);
  const sky = skySamples[Math.floor(skySamples.length / 2)] ?? 0;

  const cx = width / 2;
  const cy = height / 2;
  const low = sky * 1.5;
  const high = 0.35;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let wsum = 0;
  const pts = [];
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = hudWidth + 4; x < width - 4; x += 1) {
      const l = lum[y * width + x];
      if (l < low || l > high) continue;
      const w = l - low;
      pts.push([x, y, w]);
      sx += (x - cx) * w;
      sy += (y - cy) * w;
      wsum += w;
      n += 1;
    }
  }
  if (wsum === 0) return { skyFloor: sky, faintPx: 0, axisRatio: 0 };
  const mx = sx / wsum;
  const my = sy / wsum;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const [x, y, w] of pts) {
    const dx = x - cx - mx;
    const dy = y - cy - my;
    cxx += w * dx * dx;
    cyy += w * dy * dy;
    cxy += w * dx * dy;
  }
  cxx /= wsum;
  cyy /= wsum;
  cxy /= wsum;
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const e1 = tr / 2 + disc;
  const e2 = Math.max(1e-9, tr / 2 - disc);
  return {
    skyFloor: sky,
    faintPx: n,
    axisRatio: Math.sqrt(e1 / e2),
  };
}

function diffImages(baseImg, curImg) {
  if (baseImg.width !== curImg.width || baseImg.height !== curImg.height) {
    return { sizeMismatch: true };
  }
  const { width, height, pixels: a } = baseImg;
  const { pixels: b } = curImg;
  const hudWidth = Math.round(450 * (height / 1080));
  const hudHeight = Math.round(430 * (height / 1080));
  let maxDeltaAll = 0;
  let changedAll = 0;
  let maxDeltaScene = 0;
  let changedScene = 0;
  let changedSceneOver2 = 0;
  let sceneTotal = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const d = Math.max(
        Math.abs(a[p] - b[p]),
        Math.abs(a[p + 1] - b[p + 1]),
        Math.abs(a[p + 2] - b[p + 2]),
      );
      if (d > maxDeltaAll) maxDeltaAll = d;
      if (d > 0) changedAll += 1;
      const inHud = x < hudWidth && y < hudHeight;
      if (!inHud) {
        sceneTotal += 1;
        if (d > maxDeltaScene) maxDeltaScene = d;
        if (d > 0) changedScene += 1;
        if (d > 2) changedSceneOver2 += 1;
      }
    }
  }
  return {
    maxDeltaAll,
    changedAll,
    maxDeltaScene,
    changedScene,
    changedSceneOver2,
    sceneTotal,
  };
}

function summarizeSeeds(seeds) {
  const range = (fn) => {
    const vals = seeds.map(fn);
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  };
  return {
    armModulation: range((s) => s.armModulation),
    plateauMaxDimPx: range((s) => s.plateauMaxDimPx),
    above97: range((s) => s.above97),
    maxLum: range((s) => s.maxLum),
    litPx: range((s) => s.litPx),
    meanLum: range((s) => s.meanLum),
    rOverB: range((s) => s.rOverB),
    ridgeTrough1080p: range((s) => s.ridgeTrough1080p),
    hueSepDeg: range((s) => s.hueSepDeg),
    laneToArmWidthRatio: range((s) => s.laneToArmWidthRatio),
  };
}

function rgbHueDeg([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function printReport(report) {
  console.log(
    'seed      | mod   | distR | platPx | >0.97 | maxLum | litPx  | meanLum | meanRGB           | R/B  | ridge/tr | hueSep | lane/arm',
  );
  console.log('-'.repeat(130));
  for (const s of report.seeds) {
    const rgb = s.discMeanRgb.map((v) => v.toFixed(3)).join(',');
    console.log(
      `${s.seed}  | ${s.armModulation.toFixed(3)} | ${s.centreDistR.toFixed(2)}  | ` +
        `${String(s.plateauMaxDimPx).padStart(6)} | ${String(s.above97).padStart(5)} | ` +
        `${s.maxLum.toFixed(3)}  | ${String(s.litPx).padStart(6)} | ${s.meanLum.toFixed(4)}  | ` +
        `${rgb} | ${s.rOverB.toFixed(2)} | ${s.ridgeTrough1080p.toFixed(2).padStart(8)} | ` +
        `${s.hueSepDeg.toFixed(1).padStart(5)}° | ${s.laneToArmWidthRatio.toFixed(2)}`,
    );
  }
  const sum = report.summary;
  console.log('-'.repeat(130));
  console.log(
    `summary: mod ${sum.armModulation.min.toFixed(3)}..${sum.armModulation.max.toFixed(3)}, ` +
      `platMax ${sum.plateauMaxDimPx.max} px, >0.97 max ${sum.above97.max}, ` +
      `litPx ${sum.litPx.min}..${sum.litPx.max}, ridge/tr ${sum.ridgeTrough1080p.min.toFixed(2)}..${sum.ridgeTrough1080p.max.toFixed(2)}, ` +
      `R/B ${sum.rOverB.min.toFixed(2)}..${sum.rOverB.max.toFixed(2)}, hueSep ${sum.hueSepDeg.min.toFixed(1)}..${sum.hueSepDeg.max.toFixed(1)}°`,
  );
  if (report.guardrails.galaxy2160p) {
    const g4 = report.guardrails.galaxy2160p;
    console.log(
      `guardrail 2160p: platMax=${g4.plateauMaxDimPx}px (${g4.plateauBbox}), >0.97=${g4.above97}, maxLum=${g4.maxLum.toFixed(3)}, ridge/tr=${g4.ridgeTrough4K.toFixed(2)}`,
    );
  }
  if (report.guardrails.homeStarFull1080p) {
    const hs = report.guardrails.homeStarFull1080p;
    console.log(
      `guardrail home-star (full 1080p): peak=${hs.corePeak.toFixed(3)} at ${hs.coreAt}, rgb=${hs.coreRgb.join(',')}, ringPeak=${hs.ringPeak.toFixed(3)}, gapMean=${hs.gapMean.toFixed(4)}, ringMean=${hs.ringMean.toFixed(4)}`,
    );
  }
  if (report.guardrails.homeStarCrop1080p) {
    const hc = report.guardrails.homeStarCrop1080p;
    console.log(
      `guardrail home-star (crop 1080p): peak=${hc.corePeak.toFixed(3)} at ${hc.coreAt}, rgb=${hc.coreRgb.join(',')}, ringPeak=${hc.ringPeak.toFixed(3)}`,
    );
  }
  if (report.guardrails.dustBand) {
    const db = report.guardrails.dustBand;
    console.log(
      `guardrail dust-band (orrery): axisRatio=${db.axisRatio.toFixed(2)}, faintPx=${db.faintPx}, skyFloor=${db.skyFloor.toFixed(4)}`,
    );
  }
  if (report.guardrails.armWindow1080p) {
    const aw = report.guardrails.armWindow1080p;
    console.log(
      `guardrail arm-window (1080p, >${aw.lumThreshold}): coverage=${(aw.coverage * 100).toFixed(1)}%, components=${aw.componentCount}, meanComp=${aw.meanComponentPx.toFixed(1)}px, largest=${aw.largestComponentPx}px (${(aw.largestComponentShare * 100).toFixed(1)}%)`,
    );
  }
  if (report.guardrails.armEdge2160p) {
    const ae = report.guardrails.armEdge2160p;
    console.log(
      `guardrail arm-edge (2160p 1:1, >${ae.lumThreshold}): coverage=${(ae.coverage * 100).toFixed(1)}%, components=${ae.componentCount}, blobs>=80=${ae.isolatedBlobsGe80}, largest=${ae.largestComponentPx}px (${(ae.largestComponentShare * 100).toFixed(1)}%)`,
    );
  }
  if (report.baselineDiffs.length > 0) {
    console.log('baseline pixel diffs (non-HUD scene):');
    for (const d of report.baselineDiffs) {
      console.log(
        `  ${d.name}: maxDeltaScene=${d.maxDeltaScene}, changedScene=${d.changedScene}/${d.sceneTotal}, maxDeltaAll=${d.maxDeltaAll}`,
      );
    }
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced png');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride);
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let value;
      if (filter === 0) value = x;
      else if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`filter ${filter}`);
      out[i] = value & 0xff;
    }
    for (let col = 0; col < width; col += 1) {
      const s = col * channels;
      const d = (row * width + col) * 4;
      pixels[d] = out[s];
      pixels[d + 1] = out[s + 1];
      pixels[d + 2] = out[s + 2];
      pixels[d + 3] = channels === 4 ? out[s + 3] : 255;
    }
    prev = out;
  }
  return { width, height, pixels };
}

function parseArgs(argv) {
  const parsed = {
    out: '.scratch/layer3-eval',
    captures: '.scratch/captures',
    baseline: null,
    skipCapture: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split('=', 2);
    const value = () => {
      const next = inline ?? argv[++index];
      if (typeof next !== 'string' || next.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
      }
      return next;
    };
    switch (flag) {
      case '--out':
        parsed.out = value();
        break;
      case '--captures':
        parsed.captures = value();
        break;
      case '--baseline':
        parsed.baseline = value();
        break;
      case '--skip-capture':
        parsed.skipCapture = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return parsed;
}
