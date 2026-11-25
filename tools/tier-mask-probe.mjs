#!/usr/bin/env node
/**
 * Tier-mask probe (Layer 4, lane 4): end-to-end visual and state evidence for `warp` and `transwarp`.
 *
 * Proves:
 * - warp (star streaks) and transwarp (slipstream tunnel) both play distinct mid-effect frames;
 * - screen time is independent of distance, and the address line switches silently once mid-effect;
 * - last effect frame matches the first static frame and a fresh arrival link reload (`maxChannelDiff === 0`);
 * - interrupted crossings (Escape, pointer drag, Back, mid-crossing re-travel) never leave a
 *   half-swapped frame;
 * - a galaxy-to-galaxy crossing is a real hyperspace jump (the root layout gives it a distance) and,
 *   having no mask yet, still lands on the same frame a fresh link does.
 *
 * Usage: npm run build && npm run probe:masks
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.scratch/tier-mask-probe');
const urlArg = process.argv.indexOf('--url');
const BASE = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:4173/';

const SEED = 'ugb-0000';
const EPOCH = '2000-01-01T00:00:00.000Z';
const DEPART = 'v1/0';
const WARP_DEST = 'v1/0.9'; // local-field star -> warp
const TRANSWARP_DEST = 'v1/0.1'; // disc star -> transwarp
const HYPERSPACE_DEST = 'v1/1'; // different galaxy -> hyperspace (now travellable via the root layout)

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Decode an 8-bit RGB/RGBA non-interlaced PNG into RGBA pixel bytes. */
function decodePng(buffer) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) {
    if (buffer[i] !== sig[i]) throw new Error('Invalid PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format: depth=${bitDepth} colorType=${colorType}`);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const curRow = new Uint8Array(stride);

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x += 1) {
      const val = raw[rowStart + 1 + x];
      const left = x >= bpp ? curRow[x - bpp] : 0;
      const up = prevRow[x];
      const upLeft = x >= bpp ? prevRow[x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + left) & 0xff;
      else if (filter === 2) recon = (val + up) & 0xff;
      else if (filter === 3) recon = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paeth(left, up, upLeft)) & 0xff;
      curRow[x] = recon;
    }
    prevRow.set(curRow);

    for (let x = 0; x < width; x += 1) {
      const src = x * bpp;
      const dst = (y * width + x) * 4;
      rgba[dst + 0] = curRow[src + 0];
      rgba[dst + 1] = curRow[src + 1];
      rgba[dst + 2] = curRow[src + 2];
      rgba[dst + 3] = bpp === 4 ? curRow[src + 3] : 255;
    }
  }

  return { width, height, data: rgba };
}

/**
 * Compare two decoded PNGs across the WebGPU canvas outside the DOM HUD and transient notice pill.
 * The HUD panel shows FPS/stats and `.hud__notice` auto-hides after 1200 ms, so excluding those
 * DOM boxes isolates the pure WebGPU canvas pixels.
 */
async function diffCanvasPng(fileA, fileB, { ignoreNotice = false } = {}) {
  const [bufA, bufB] = await Promise.all([readFile(fileA), readFile(fileB)]);
  const a = decodePng(bufA);
  const b = decodePng(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Image size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }

  let maxChannelDiff = 0;
  let sumAbsDiff = 0;
  let count = 0;

  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      // Exclude top-left HUD panel area.
      if (x < 460 && y < 460) continue;
      // Exclude bottom-center transient notice pill when comparing mid-notice interrupts.
      if (ignoreNotice && x >= 160 && x <= 1120 && y >= 570 && y <= 670) continue;

      const idx = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const diff = Math.abs(a.data[idx + c] - b.data[idx + c]);
        if (diff > maxChannelDiff) maxChannelDiff = diff;
        sumAbsDiff += diff;
      }
      count += 3;
    }
  }

  return {
    maxChannelDiff,
    meanAbsDiff: count > 0 ? sumAbsDiff / (count * 255) : 0,
  };
}

await mkdir(outDir, { recursive: true });

const server =
  urlArg >= 0
    ? null
    : await preview({
        preview: { host: '127.0.0.1', port: 4173, strictPort: true },
        logLevel: 'warn',
      });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});

const ready = (page, addr) =>
  page.waitForFunction(
    (expected) =>
      window.__ugb?.ready === true &&
      (window.__ugb?.frame ?? 0) >= 2 &&
      (!expected || window.__ugb?.state.address === expected),
    addr ?? null,
    { timeout: 30_000 },
  );

const installAddressObserver = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('#hud-address');
    const log = [{ timeMs: performance.now(), text: el?.textContent ?? '' }];
    window.__maskAddrLog = log;
    if (el) {
      const obs = new MutationObserver(() => {
        const next = el.textContent ?? '';
        if (log[log.length - 1]?.text !== next) {
          log.push({ timeMs: performance.now(), text: next });
        }
      });
      obs.observe(el, { childList: true, subtree: true, characterData: true });
      window.__maskAddrObs = obs;
    }
  });

const readAddressObserver = (page) =>
  page.evaluate(() => {
    window.__maskAddrObs?.disconnect?.();
    return window.__maskAddrLog ?? [];
  });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // ---- 1. Warp crossing (v1/0 -> v1/0.9, 1600 ms) --------------------------
  await page.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${DEPART}&t=1200`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page, DEPART);
  const warpDepartPath = path.join(outDir, 'warp-depart.png');
  await page.screenshot({ path: warpDepartPath });

  const historyBeforeWarp = await page.evaluate(() => window.__ugb.historyLength);
  await installAddressObserver(page);
  const warpPlan = await page.evaluate((to) => window.__ugb.travel(to), WARP_DEST);
  check(
    'warp travel accepted',
    warpPlan.ok === true && warpPlan.method === 'warp',
    JSON.stringify(warpPlan),
  );
  await ready(page, WARP_DEST);

  await page.waitForTimeout(160);
  const warpEarlyPath = path.join(outDir, 'warp-early.png');
  await page.screenshot({ path: warpEarlyPath });

  await page.waitForTimeout(580);
  const warpMidPath = path.join(outDir, 'warp-mid.png');
  await page.screenshot({ path: warpMidPath });
  const warpMidSample = await page.evaluate(() => window.__ugb.sampleCanvas());

  await page.waitForTimeout(540);
  const warpLatePath = path.join(outDir, 'warp-late.png');
  await page.screenshot({ path: warpLatePath });

  await page.waitForTimeout(680); // total > 1960 ms -> mask finished (> 1600 ms) and notice hidden
  const warpEndPath = path.join(outDir, 'warp-end.png');
  await page.screenshot({ path: warpEndPath });
  const warpEndSample = await page.evaluate(() => window.__ugb.sampleCanvas());

  await page.waitForTimeout(400);
  const warpStaticPath = path.join(outDir, 'warp-static.png');
  await page.screenshot({ path: warpStaticPath });
  const warpStaticSample = await page.evaluate(() => window.__ugb.sampleCanvas());

  const warpAddrLog = await readAddressObserver(page);
  const warpHistoryAfter = await page.evaluate(() => window.__ugb.historyLength);

  // Fresh reload of arrival URL
  const warpUrl = page.url();
  const warpReplay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await warpReplay.goto(warpUrl, { waitUntil: 'domcontentloaded' });
  await ready(warpReplay, WARP_DEST);
  await warpReplay.waitForTimeout(150);
  const warpLinkStaticPath = path.join(outDir, 'warp-link-static.png');
  await warpReplay.screenshot({ path: warpLinkStaticPath });
  const warpLinkSample = await warpReplay.evaluate(() => window.__ugb.sampleCanvas());
  await warpReplay.close();

  const warpMidVsDepart = await diffCanvasPng(warpMidPath, warpDepartPath);
  const warpMidVsStatic = await diffCanvasPng(warpMidPath, warpStaticPath);
  const warpEndVsStatic = await diffCanvasPng(warpEndPath, warpStaticPath);
  const warpEndVsLink = await diffCanvasPng(warpEndPath, warpLinkStaticPath);

  check(
    'warp mid-effect differs visually from departure and destination',
    warpMidVsDepart.meanAbsDiff > 0.01 &&
      warpMidVsStatic.meanAbsDiff > 0.01 &&
      warpMidSample.stdev > 0.005,
    `vsDepart=${warpMidVsDepart.meanAbsDiff.toFixed(4)} vsStatic=${warpMidVsStatic.meanAbsDiff.toFixed(4)} stdev=${warpMidSample.stdev.toFixed(4)}`,
  );
  check(
    'warp end-of-effect matches static and reloaded arrival frame identically',
    warpEndVsStatic.maxChannelDiff === 0 &&
      warpEndVsLink.maxChannelDiff === 0 &&
      Math.abs(warpEndSample.mean - warpLinkSample.mean) < 1e-6,
    `endVsStaticMax=${warpEndVsStatic.maxChannelDiff} endVsLinkMax=${warpEndVsLink.maxChannelDiff} sampleDiff=${Math.abs(warpEndSample.mean - warpLinkSample.mean).toExponential(2)}`,
  );
  check(
    'warp HUD address switched once silently from departure to destination',
    warpAddrLog.length === 2 &&
      warpAddrLog[0].text === 'v1/0' &&
      warpAddrLog[1].text === 'v1/0/9' &&
      warpHistoryAfter === historyBeforeWarp + 1,
    JSON.stringify({ log: warpAddrLog, history: [historyBeforeWarp, warpHistoryAfter] }),
  );

  // ---- 2. Transwarp crossing (v1/0 -> v1/0.1, 2200 ms) ---------------------
  await page.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${DEPART}&t=1200`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page, DEPART);
  const transDepartPath = path.join(outDir, 'transwarp-depart.png');
  await page.screenshot({ path: transDepartPath });

  const historyBeforeTrans = await page.evaluate(() => window.__ugb.historyLength);
  await installAddressObserver(page);
  const transPlan = await page.evaluate((to) => window.__ugb.travel(to), TRANSWARP_DEST);
  check(
    'transwarp travel accepted',
    transPlan.ok === true && transPlan.method === 'transwarp',
    JSON.stringify(transPlan),
  );
  await ready(page, TRANSWARP_DEST);

  await page.waitForTimeout(240);
  const transEarlyPath = path.join(outDir, 'transwarp-early.png');
  await page.screenshot({ path: transEarlyPath });

  await page.waitForTimeout(820); // ~1060 ms -> midpoint
  const transMidPath = path.join(outDir, 'transwarp-mid.png');
  await page.screenshot({ path: transMidPath });
  const transMidSample = await page.evaluate(() => window.__ugb.sampleCanvas());

  await page.waitForTimeout(700); // ~1760 ms -> exit aperture opening
  const transLatePath = path.join(outDir, 'transwarp-late.png');
  await page.screenshot({ path: transLatePath });

  await page.waitForTimeout(820); // ~2580 ms -> settled > 2200 ms & notice hidden
  const transEndPath = path.join(outDir, 'transwarp-end.png');
  await page.screenshot({ path: transEndPath });
  const transEndSample = await page.evaluate(() => window.__ugb.sampleCanvas());

  await page.waitForTimeout(400);
  const transStaticPath = path.join(outDir, 'transwarp-static.png');
  await page.screenshot({ path: transStaticPath });

  const transAddrLog = await readAddressObserver(page);
  const transHistoryAfter = await page.evaluate(() => window.__ugb.historyLength);

  const transUrl = page.url();
  const transReplay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await transReplay.goto(transUrl, { waitUntil: 'domcontentloaded' });
  await ready(transReplay, TRANSWARP_DEST);
  await transReplay.waitForTimeout(150);
  const transLinkStaticPath = path.join(outDir, 'transwarp-link-static.png');
  await transReplay.screenshot({ path: transLinkStaticPath });
  const transLinkSample = await transReplay.evaluate(() => window.__ugb.sampleCanvas());
  await transReplay.close();

  const transMidVsDepart = await diffCanvasPng(transMidPath, transDepartPath);
  const transMidVsStatic = await diffCanvasPng(transMidPath, transStaticPath);
  const transMidVsWarpMid = await diffCanvasPng(transMidPath, warpMidPath);
  const transEndVsStatic = await diffCanvasPng(transEndPath, transStaticPath);
  const transEndVsLink = await diffCanvasPng(transEndPath, transLinkStaticPath);

  check(
    'transwarp mid-effect differs visually from departure, arrival, and warp',
    transMidVsDepart.meanAbsDiff > 0.01 &&
      transMidVsStatic.meanAbsDiff > 0.01 &&
      transMidVsWarpMid.meanAbsDiff > 0.01 &&
      transMidSample.stdev > 0.005,
    `vsDepart=${transMidVsDepart.meanAbsDiff.toFixed(4)} vsStatic=${transMidVsStatic.meanAbsDiff.toFixed(4)} vsWarp=${transMidVsWarpMid.meanAbsDiff.toFixed(4)} stdev=${transMidSample.stdev.toFixed(4)}`,
  );
  check(
    'transwarp end-of-effect matches static and reloaded arrival frame identically',
    transEndVsStatic.maxChannelDiff === 0 &&
      transEndVsLink.maxChannelDiff === 0 &&
      Math.abs(transEndSample.mean - transLinkSample.mean) < 1e-6,
    `endVsStaticMax=${transEndVsStatic.maxChannelDiff} endVsLinkMax=${transEndVsLink.maxChannelDiff} sampleDiff=${Math.abs(transEndSample.mean - transLinkSample.mean).toExponential(2)}`,
  );
  check(
    'transwarp HUD address switched once silently from departure to destination',
    transAddrLog.length === 2 &&
      transAddrLog[0].text === 'v1/0' &&
      transAddrLog[1].text === 'v1/0/1' &&
      transHistoryAfter === historyBeforeTrans + 1,
    JSON.stringify({ log: transAddrLog, history: [historyBeforeTrans, transHistoryAfter] }),
  );

  // ---- 3. Interrupted crossings: Escape, Back, re-travel, and refused ------
  // 3a. Escape interrupt mid-transwarp (well before 2200 ms)
  await page.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${DEPART}&t=1200`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page, DEPART);
  await page.evaluate((to) => window.__ugb.travel(to), TRANSWARP_DEST);
  await ready(page, TRANSWARP_DEST);
  await page.waitForTimeout(450);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const escAddrText = await page.evaluate(
    () => document.querySelector('#hud-address')?.textContent ?? '',
  );
  const escPath = path.join(outDir, 'interrupt-escape.png');
  await page.screenshot({ path: escPath });
  const escSample = await page.evaluate(() => window.__ugb.sampleCanvas());
  const escVsLink = await diffCanvasPng(escPath, transLinkStaticPath, { ignoreNotice: true });

  check(
    'Escape interrupt clamps immediately to static arrival without half-swapped frame',
    escAddrText === 'v1/0/1' &&
      escVsLink.maxChannelDiff === 0 &&
      Math.abs(escSample.mean - transLinkSample.mean) < 1e-6,
    `addr=${escAddrText} maxDiff=${escVsLink.maxChannelDiff} sampleDiff=${Math.abs(escSample.mean - transLinkSample.mean).toExponential(2)}`,
  );

  // 3b. Back navigation interrupt mid-transwarp
  await page.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${DEPART}&t=1200`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page, DEPART);
  await page.evaluate((to) => window.__ugb.travel(to), TRANSWARP_DEST);
  await ready(page, TRANSWARP_DEST);
  await page.waitForTimeout(450);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await ready(page, DEPART);
  await page.waitForTimeout(150);
  const backAddrText = await page.evaluate(
    () => document.querySelector('#hud-address')?.textContent ?? '',
  );
  const backPath = path.join(outDir, 'interrupt-back.png');
  await page.screenshot({ path: backPath });
  const backSample = await page.evaluate(() => window.__ugb.sampleCanvas());

  const backUrl = page.url();
  const backReplay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await backReplay.goto(backUrl, { waitUntil: 'domcontentloaded' });
  await ready(backReplay, DEPART);
  await backReplay.waitForTimeout(150);
  const backLinkPath = path.join(outDir, 'interrupt-back-link.png');
  await backReplay.screenshot({ path: backLinkPath });
  const backLinkSample = await backReplay.evaluate(() => window.__ugb.sampleCanvas());
  await backReplay.close();

  const backVsDepart = await diffCanvasPng(backPath, warpDepartPath);
  const backVsLink = await diffCanvasPng(backPath, backLinkPath);

  check(
    'Back mid-crossing cleanly restores static departure frame',
    backAddrText === 'v1/0' &&
      backVsLink.maxChannelDiff === 0 &&
      backVsDepart.maxChannelDiff <= 4 &&
      Math.abs(backSample.mean - backLinkSample.mean) < 1e-6,
    `addr=${backAddrText} vsLinkMax=${backVsLink.maxChannelDiff} vsBootMax=${backVsDepart.maxChannelDiff}`,
  );

  // 3c. Mid-crossing re-travel (v1/0.1 -> v1/0.9 touches the disc, so it is a 2200 ms transwarp)
  await page.evaluate((to) => window.__ugb.travel(to), TRANSWARP_DEST);
  await ready(page, TRANSWARP_DEST);
  await page.waitForTimeout(400);
  const retravelPlan = await page.evaluate((to) => window.__ugb.travel(to), WARP_DEST);
  await ready(page, WARP_DEST);
  await page.waitForTimeout(2550);
  const retravelAddrText = await page.evaluate(
    () => document.querySelector('#hud-address')?.textContent ?? '',
  );
  const retravelPath = path.join(outDir, 'interrupt-retravel.png');
  await page.screenshot({ path: retravelPath });
  const retravelUrl = page.url();

  const retravelReplay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await retravelReplay.goto(retravelUrl, { waitUntil: 'domcontentloaded' });
  await ready(retravelReplay, WARP_DEST);
  await retravelReplay.waitForTimeout(150);
  const retravelLinkPath = path.join(outDir, 'interrupt-retravel-link.png');
  await retravelReplay.screenshot({ path: retravelLinkPath });
  await retravelReplay.close();

  const retravelVsLink = await diffCanvasPng(retravelPath, retravelLinkPath);
  check(
    'mid-crossing re-travel settles cleanly on the second destination',
    retravelPlan.ok === true &&
      retravelPlan.method === 'transwarp' &&
      retravelAddrText === 'v1/0/9' &&
      retravelVsLink.maxChannelDiff === 0,
    `addr=${retravelAddrText} maxDiff=${retravelVsLink.maxChannelDiff}`,
  );

  // 3d. Galaxy-to-galaxy is now a real hyperspace crossing (the root layout gives it a distance).
  // Hyperspace has no mask yet, so this also proves a methodless-with-mask crossing swaps the frame
  // cleanly: the settled frame must equal a fresh link to the same address, not a half-swapped one.
  const hyperPlan = await page.evaluate((to) => window.__ugb.travel(to), HYPERSPACE_DEST);
  await ready(page, HYPERSPACE_DEST);
  // The travel notice pill lives 1200 ms; wait past it so the comparison is canvas, not toast.
  await page.waitForTimeout(1400);
  const afterHyperAddr = await page.evaluate(() => window.__ugb.state.address);
  const hyperPath = path.join(outDir, 'hyper-galaxy-jump.png');
  await page.screenshot({ path: hyperPath });

  const hyperUrl = page.url();
  const hyperReplay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await hyperReplay.goto(hyperUrl, { waitUntil: 'domcontentloaded' });
  await ready(hyperReplay, HYPERSPACE_DEST);
  await hyperReplay.waitForTimeout(1400);
  const hyperLinkPath = path.join(outDir, 'hyper-galaxy-jump-link.png');
  await hyperReplay.screenshot({ path: hyperLinkPath });
  await hyperReplay.close();

  const hyperVsLink = await diffCanvasPng(hyperPath, hyperLinkPath);
  check(
    'galaxy-to-galaxy crosses as hyperspace and lands on the linked frame',
    hyperPlan.ok === true &&
      hyperPlan.method === 'hyperspace' &&
      hyperPlan.distanceM !== null &&
      hyperPlan.elapsedS !== null &&
      afterHyperAddr === HYPERSPACE_DEST &&
      hyperVsLink.maxChannelDiff === 0,
    `ok=${hyperPlan.ok} method=${hyperPlan.method} d=${hyperPlan.distanceM} addr=${afterHyperAddr} maxDiff=${hyperVsLink.maxChannelDiff}`,
  );

  const failures = checks.filter((c) => !c.ok).length;
  await writeFile(
    path.join(outDir, 'summary.json'),
    `${JSON.stringify({ checks, failures }, null, 2)}\n`,
  );
  console.log(
    `\n[capture] ${checks.length - failures}/${checks.length} checks passed; ` +
      `summary ${path.relative(root, path.join(outDir, 'summary.json'))}`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
  await server?.close();
}
