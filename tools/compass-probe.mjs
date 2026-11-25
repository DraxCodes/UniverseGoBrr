#!/usr/bin/env node
/**
 * Compass probe (lane 3): the address HUD, the compass rows, and free zoom-out.
 *
 * Unit tests cover `nearestAnchors`, `bearingOf` and `planZoomOut` as pure functions. What they
 * cannot see is the wiring, and that is where this feature can lie:
 *
 * - a compass row must point at a place travel would actually reach (the row's address is the
 *   travel target, so a mismatched pair sends you somewhere the bearing did not name);
 * - a zoom-out must cost **no universe time** and still be undoable with Back;
 * - a refused line (the root) must leave the page where it was rather than half-navigate.
 *
 * Usage: npm run build && npm run probe:compass
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.scratch/compass-probe');
const urlArg = process.argv.indexOf('--url');
const BASE = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:4173/';

const SEED = 'ugb-0000';
const EPOCH = '2000-01-01T00:00:00.000Z';
const DEPART = 'v1/0.2.3'; // a real star: sector 2, identity 3

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${DEPART}&t=1200`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page, DEPART);

  // ---- 1. the address renders as lines, only the ones with something behind them are buttons
  const crumbs = await page.evaluate(() =>
    [...document.querySelectorAll('#hud-address > *')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: el.textContent,
      title: el.getAttribute('title'),
    })),
  );
  const crumbButtons = crumbs.filter((c) => c.tag === 'button');
  check(
    'address shows v1/0/2/3 with every level above "here" clickable',
    // Four levels (version + galaxy + sector + star), three slashes between them, and three
    // buttons: the version (depth 0), the galaxy (depth 1) and the sector (depth 2). The star is
    // where you are, so it is a span — the count is the re-key in one assertion.
    crumbs.length === 7 && crumbButtons.length === 3,
    JSON.stringify(crumbs),
  );
  check(
    'the deepest line is where you are, not a button',
    crumbs[crumbs.length - 1]?.tag === 'span' && crumbs[crumbs.length - 1]?.text === '3',
    JSON.stringify(crumbs[crumbs.length - 1]),
  );

  // ---- 2. the compass lists drawn stars with a bearing and a distance
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.hud__anchor')].map((row) => ({
      address: row.dataset.address ?? null,
      name: row.querySelector('.hud__anchor-name')?.textContent ?? null,
      bearing: row.querySelector('.hud__anchor-bearing')?.textContent ?? null,
      distance: row.querySelector('.hud__anchor-distance')?.textContent ?? null,
    })),
  );
  check('compass has rows', rows.length > 0, `${rows.length} rows`);
  check(
    'every row names a place, a bearing and a distance',
    rows.every((row) => row.address && /^v1\//.test(row.address) && row.bearing && row.distance),
    JSON.stringify(rows),
  );
  check(
    'no row is the place you are at',
    rows.every((row) => row.address !== DEPART),
    rows.map((r) => r.address).join(', '),
  );

  const compass = await page.evaluate(() => window.__ugb.compass);
  check(
    'the debug surface reports the same rows the HUD shows',
    compass.length === rows.length && compass.every((c, i) => c.address === rows[i].address),
    JSON.stringify(compass),
  );

  await page.screenshot({ path: path.join(outDir, 'compass-system.png') });

  // ---- 3. a bearing follows the eye
  const bearingBefore = await page.evaluate(
    () => document.querySelector('.hud__anchor-bearing')?.textContent ?? null,
  );
  await page.evaluate(() => {
    // A 120 px left drag: enough to turn the view by a measurable angle.
    const canvas = document.querySelector('#stage');
    const box = canvas.getBoundingClientRect();
    const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { ...opts, clientX: box.width / 2, clientY: box.height / 2 }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        ...opts,
        clientX: box.width / 2 - 120,
        clientY: box.height / 2,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerup', { ...opts, clientX: box.width / 2 - 120, clientY: box.height / 2 }),
    );
  });
  await page.waitForTimeout(350);
  const bearingAfter = await page.evaluate(
    () => document.querySelector('.hud__anchor-bearing')?.textContent ?? null,
  );
  check(
    'the bearing turns with the camera',
    bearingBefore !== null && bearingAfter !== null && bearingBefore !== bearingAfter,
    `${bearingBefore} -> ${bearingAfter}`,
  );

  // ---- 4. clicking a row travels to exactly that address
  const target = rows[0].address;
  await page.click('.hud__anchor');
  await ready(page, target);
  const arrived = await page.evaluate(() => window.__ugb.state);
  check('the row travelled to the address it named', arrived.address === target, arrived.address);
  check('the pin records the departure', arrived.from === DEPART, String(arrived.from));
  const pinRow = await page.evaluate(
    () => [...document.querySelectorAll('.hud__anchor-name')].map((el) => el.textContent).join(' | '),
  );
  check('the compass shows "came from"', /came from/.test(pinRow), pinRow);

  // ---- 5. the pin survives a reload, because the link carries it
  const pinnedUrl = page.url();
  const replay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await replay.goto(pinnedUrl, { waitUntil: 'domcontentloaded' });
  await ready(replay, target);
  const replayed = await replay.evaluate(() => window.__ugb.state);
  check('the arrival link reproduces the trail', replayed.from === DEPART, String(replayed.from));
  await replay.close();

  await page.screenshot({ path: path.join(outDir, 'compass-arrived.png') });

  // ---- 6. zoom out is free, and Back undoes it
  const before = await page.evaluate(() => window.__ugb.state);
  const historyBefore = await page.evaluate(() => window.__ugb.historyLength);
  const zoom = await page.evaluate(() => window.__ugb.zoomOut(1));
  await ready(page, 'v1/0');
  const zoomed = await page.evaluate(() => window.__ugb.state);
  const historyAfter = await page.evaluate(() => window.__ugb.historyLength);

  check('zoom out reached the galaxy', zoom.ok === true && zoomed.address === 'v1/0', zoomed.address);
  check('zoom out cost no universe time', zoomed.t === before.t, `${before.t} -> ${zoomed.t}`);
  check('zoom out left the epoch alone', zoomed.epoch === before.epoch, zoomed.epoch);
  check(
    'zoom out is a place, so it gets a history entry',
    historyAfter === historyBefore + 1,
    `${historyBefore} -> ${historyAfter}`,
  );
  check('the pin survives zoom out', zoomed.from === before.from, String(zoomed.from));
  await page.screenshot({ path: path.join(outDir, 'compass-galaxy.png') });

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await ready(page, target);
  const back = await page.evaluate(() => window.__ugb.state);
  check('Back returns to the star, not past it', back.address === target, back.address);

  // ---- 7. the root line is refused, and refusing leaves the page alone
  const refused = await page.evaluate(() => window.__ugb.zoomOut(0));
  await page.waitForTimeout(200);
  const afterRefusal = await page.evaluate(() => ({
    state: window.__ugb.state,
    notice: document.querySelector('#hud-notice')?.textContent ?? null,
  }));
  check('the root line is refused', refused.ok === false, String(refused.reason));
  check(
    'a refusal leaves the address where it was',
    afterRefusal.state.address === target,
    afterRefusal.state.address,
  );
  check(
    'a refusal explains itself',
    /no layout/.test(afterRefusal.notice ?? ''),
    String(afterRefusal.notice),
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