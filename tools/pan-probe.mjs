#!/usr/bin/env node
/**
 * Pan probe (lane 4): right-drag panning and the camera target (ADR-0014).
 *
 * The pure maths is unit-tested in `src/input/orbit-controls.test.ts`. What only an end-to-end
 * run can show is that the input is wired to it and that the URL stays the source of truth:
 *
 * - a right-drag must move the **target**, not just the eye, so the next orbit keeps the point
 *   you panned to instead of snapping back to the frame origin;
 * - a pan must be a gesture, not a place: it must rewrite the URL in place and never grow Back;
 * - a left-drag must still orbit (the target must not move);
 * - the panned link must reproduce the same target on reload, or a shared view is a lie.
 *
 * Usage: npm run build && npm run probe:pan
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.scratch/pan-probe');
const urlArg = process.argv.indexOf('--url');
const BASE = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:4173/';

const SEED = 'ugb-0000';
const EPOCH = '2000-01-01T00:00:00.000Z';
const ADDRESS = 'v1/0.2.3'; // a disc star: sector 2, identity 3
/** Relative tolerance for 10¹² m coordinates: a double's ulp there is ~0.001 m. */
const REL = 1e-9;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const close = (a, b, rel = REL) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const sameVec = (a, b, rel = REL) => [0, 1, 2].every((i) => close(a[i], b[i], rel));

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
  await page.goto(`${BASE}?seed=${SEED}&epoch=${EPOCH}&addr=${ADDRESS}&t=1200`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page, ADDRESS);

  const snapshot = () => page.evaluate(() => window.__ugb.state);
  const search = () => page.evaluate(() => location.search);

  // ---- 1. an untouched view orbits the frame origin
  const start = await snapshot();
  check('the opening view targets the frame origin', sameVec(start.target, [0, 0, 0]), JSON.stringify(start.target));
  check('an unpanned link carries no tgt', !(await search()).includes('tgt='), await search());

  // ---- 2. a right-drag pans the target
  const box = await page.locator('#stage').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const historyBefore = await page.evaluate(() => window.__ugb.historyLength);

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 180, cy - 90, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(450);

  const panned = await snapshot();
  const pannedSearch = await search();
  check('a right-drag moves the target', !sameVec(panned.target, [0, 0, 0]), JSON.stringify(panned.target));
  check('a right-drag keeps the view angle', close(panned.camera[3], start.camera[3]) && close(panned.camera[4], start.camera[4]), JSON.stringify(panned.camera.slice(3)));
  check('the panned link carries tgt', pannedSearch.includes('tgt='), pannedSearch);

  const eyeBefore = [start.camera[0], start.camera[1], start.camera[2]];
  const eyeAfter = [panned.camera[0], panned.camera[1], panned.camera[2]];
  const eyeShift = [0, 1, 2].map((i) => eyeAfter[i] - eyeBefore[i]);
  check('the eye moves by the target shift, so the view slides', sameVec(eyeShift, panned.target), JSON.stringify({ eyeShift, target: panned.target }));

  const historyAfter = await page.evaluate(() => window.__ugb.historyLength);
  check('a pan is a gesture, not a place: Back does not grow', historyAfter === historyBefore, `${historyBefore} -> ${historyAfter}`);
  const view = await page.evaluate(() => document.querySelector('#hud-view')?.textContent ?? null);
  check('the HUD says the view is panned', /panned/.test(view ?? ''), String(view));

  await page.screenshot({ path: path.join(outDir, 'pan-system.png') });

  // ---- 3. a left-drag after a pan orbits around the new target
  const targetBeforeOrbit = panned.target;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(cx - 120, cy, { steps: 5 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(450);
  const orbited = await snapshot();
  check('a left-drag keeps the panned target', sameVec(orbited.target, targetBeforeOrbit), JSON.stringify({ before: targetBeforeOrbit, after: orbited.target }));
  check('a left-drag changes the view angle', orbited.camera[3] !== panned.camera[3], `${panned.camera[3]} -> ${orbited.camera[3]}`);

  // ---- 4. the wheel keeps the target (it is not a reset)
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(450);
  const zoomed = await snapshot();
  check('the wheel keeps the panned target', sameVec(zoomed.target, targetBeforeOrbit), JSON.stringify(zoomed.target));

  // ---- 5. the panned link reproduces the target on reload
  const pannedUrl = page.url();
  const replay = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await replay.goto(pannedUrl, { waitUntil: 'domcontentloaded' });
  await ready(replay, ADDRESS);
  const replayed = await replay.evaluate(() => window.__ugb.state);
  check('the shared link reproduces the target', sameVec(replayed.target, targetBeforeOrbit), JSON.stringify({ expected: targetBeforeOrbit, got: replayed.target }));
  check('the shared link reproduces the eye', sameVec([replayed.camera[0], replayed.camera[1], replayed.camera[2]], [zoomed.camera[0], zoomed.camera[1], zoomed.camera[2]]), JSON.stringify(replayed.camera));
  await replay.close();

  // ---- 6. reset returns the view to the frame origin
  await page.keyboard.press('r');
  await page.waitForTimeout(450);
  const reset = await snapshot();
  check('reset clears the target', sameVec(reset.target, [0, 0, 0]), JSON.stringify(reset.target));
  check('reset drops tgt from the link', !(await search()).includes('tgt='), await search());

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