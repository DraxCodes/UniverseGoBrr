#!/usr/bin/env node
/**
 * Travel probe (lane 2): end-to-end evidence that a jump, its arrival link, and Back/Forward agree.
 *
 * The unit tests cover `planTravel`, `advanceClock` and `historyWrite` as pure functions. This
 * drives the *built* app, because the two things they cannot see are the ones that actually broke
 * in review:
 *
 * - the arrival link must reproduce the arrival state exactly (ADR-0012's round trip);
 * - a framing write must not grow `history.length`, so Back retraces places rather than mouse
 *   movements.
 *
 * It also pins both clock modes, because "travel advances time" has two different correct answers.
 *
 * Usage: npm run build && npm run probe:travel
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.scratch/travel-probe');
const urlArg = process.argv.indexOf('--url');
const BASE = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:4173/';

const SEED = 'ugb-0000';
const EPOCH = '2000-01-01T00:00:00.000Z';
const DEPART = 'v1/0';
const ARRIVE = 'v1/0.9'; // a local-field star, so the plan picks a warp

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * rel;

await mkdir(outDir, { recursive: true });

// The probe starts its own preview only when it was pointed at nothing; `--url` reuses a dev server.
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

/** Wait until the app has drawn a frame at `addr` (or any address when omitted). */
const ready = (page, addr) =>
  page.waitForFunction(
    (expected) =>
      window.__ugb?.ready === true &&
      (window.__ugb?.frame ?? 0) >= 2 &&
      (!expected || window.__ugb?.state.address === expected),
    addr ?? null,
    { timeout: 30_000 },
  );

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // ---- 1. a travel on a live clock keeps it live ---------------------------
  await page.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${DEPART}`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page);
  const depart = await page.evaluate(() => window.__ugb.state);
  const historyBefore = await page.evaluate(() => window.__ugb.historyLength);

  const plan = await page.evaluate((to) => window.__ugb.travel(to), ARRIVE);
  check('travel accepted', plan.ok === true, JSON.stringify(plan));

  await ready(page, ARRIVE);
  const live = await page.evaluate(() => window.__ugb.state);
  check('live clock stayed live', live.t === null, `t=${live.t}`);
  const epochShiftS = (Date.parse(depart.epoch) - Date.parse(live.epoch)) / 1000;
  check(
    'live epoch moved back by d/v',
    near(epochShiftS, plan.elapsedS, 1e-6),
    `${(epochShiftS / 86_400).toFixed(3)} d vs ${(plan.elapsedS / 86_400).toFixed(3)} d`,
  );
  check('address is the destination', live.address === ARRIVE, live.address);

  const historyAfter = await page.evaluate(() => window.__ugb.historyLength);
  check(
    'arrival pushed exactly one entry',
    historyAfter === historyBefore + 1,
    `${historyBefore} -> ${historyAfter}`,
  );
  await page.screenshot({ path: path.join(outDir, 'travel-live-arrival.png') });

  // ---- 2. a framing write does not grow history ----------------------------
  const framingBefore = await page.evaluate(() => window.__ugb.historyLength);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' })));
  await page.waitForTimeout(300);
  const framingAfter = await page.evaluate(() => window.__ugb.historyLength);
  check(
    'framing write left history unchanged',
    framingAfter === framingBefore,
    `${framingBefore} -> ${framingAfter}`,
  );

  // ---- 3. the arrival link reproduces the arrival state --------------------
  const arrivalUrl = page.url();
  const replay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await replay.goto(arrivalUrl, { waitUntil: 'domcontentloaded' });
  await ready(replay, ARRIVE);
  const replayed = await replay.evaluate(() => window.__ugb.state);
  check(
    'arrival link reproduces address, camera and epoch',
    replayed.address === live.address &&
      replayed.epoch === live.epoch &&
      replayed.camera.every((v, i) => v === live.camera[i]),
    `${replayed.address} ${replayed.epoch}`,
  );
  await replay.screenshot({ path: path.join(outDir, 'travel-link-arrival.png') });
  await replay.close();

  // ---- 4. Back and Forward walk the places --------------------------------
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await ready(page, DEPART);
  const back = await page.evaluate(() => window.__ugb.state);
  check('Back returned to the departure', back.address === DEPART, back.address);

  await page.goForward({ waitUntil: 'domcontentloaded' });
  await ready(page, ARRIVE);
  const forward = await page.evaluate(() => window.__ugb.state);
  check('Forward returned to the arrival', forward.address === ARRIVE, forward.address);

  // ---- 5. a travel on a pinned clock keeps it pinned ----------------------
  const pinned = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await pinned.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${DEPART}&t=1200`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(pinned);
  const pinnedPlan = await pinned.evaluate((to) => window.__ugb.travel(to), ARRIVE);
  await ready(pinned, ARRIVE);
  const pinnedState = await pinned.evaluate(() => window.__ugb.state);
  check('pinned clock stayed pinned', pinnedState.t !== null, `t=${pinnedState.t}`);
  check(
    'pinned t moved forward by d/v',
    near(pinnedState.t - 1200, pinnedPlan.elapsedS, 1e-9),
    `${(pinnedState.t - 1200).toFixed(1)} s vs ${pinnedPlan.elapsedS.toFixed(1)} s`,
  );
  check('pinned epoch did not move', pinnedState.epoch === EPOCH, pinnedState.epoch);
  await pinned.close();

  const failures = checks.filter((c) => !c.ok).length;
  await writeFile(
    path.join(outDir, 'summary.json'),
    `${JSON.stringify({ checks, failures }, null, 2)}\n`,
  );
  console.log(`\n[capture] ${checks.length - failures}/${checks.length} checks passed; ` +
    `summary ${path.relative(root, path.join(outDir, 'summary.json'))}`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
  await server?.close();
}
