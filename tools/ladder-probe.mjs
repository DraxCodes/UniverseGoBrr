#!/usr/bin/env node
/**
 * Universe ladder probe (ticket 06, "Slice A"): the evidence that the address rungs and travel
 * coverage are real, end to end in the running app.
 *
 * Proves:
 * - the ladder `universe -> galaxy -> sector -> system -> body` is what the app reports, by address;
 * - one destination is priced in **every** method, and a wormhole costs the same fixed dt at every
 *   distance (ADR-0019's carve-out), while a slower method always costs more than a faster one;
 * - a galaxy-to-galaxy trip is travellable - the ADR-0022 coverage defect ("no root layout") is gone;
 * - a trip inside one solar system is offered sublight as the sensible choice, trip-advice not a gate.
 *
 * Usage: npm run build && npm run probe:ladder
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = process.cwd();
const outDir = path.join(root, '.scratch', 'ladder-probe');
const urlArg = process.argv.indexOf('--url');
const baseUrl = urlArg >= 0 ? process.argv[urlArg + 1] : null;

const SEED = 'ugb-0000';
const EPOCH = '2000-01-01T00:00:00.000Z';

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const url = (addr) =>
  `${baseUrl ?? 'http://127.0.0.1:4173/'}?seed=${SEED}&epoch=${EPOCH}&addr=${encodeURIComponent(addr)}`;

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

let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // A system address is the departure: deep enough to price every trip, and a real scene.
  await page.goto(url('v1/0.0.0'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__ugb?.ready === true && (window.__ugb?.frame ?? 0) >= 2,
    null,
    { timeout: 30_000 },
  );

  // -------------------------------------------------------------------------
  // 1. The ladder, asked of the running app by address, not of a unit test.
  // -------------------------------------------------------------------------
  // The probe drives `zoomOut` for the ancestor rungs. Each depth must answer with the address that
  // keeps that many levels - the ladder is only real if the app will actually follow it.
  const ladder = await page.evaluate(() => {
    const results = [];
    // Order matters: a successful zoom-out replaces the scene, so the rungs that are refused run
    // first and the one that commits (the galaxy) runs last, with a readiness wait after it.
    for (const depth of [0, 2, 1]) {
      const r = window.__ugb.zoomOut(depth);
      results.push({ depth, ok: r.ok, reason: r.reason ?? null, address: window.__ugb.state.address });
    }
    return results;
  });
  await page.waitForFunction(
    () => window.__ugb?.ready === true && (window.__ugb?.frame ?? 0) >= 2,
    null,
    { timeout: 30_000 },
  );

  const rootRefused = ladder.find((r) => r.depth === 0);
  check(
    'the root is refused as a destination and says why',
    rootRefused.ok === false && /layout|universe/i.test(rootRefused.reason ?? ''),
    `ok=${rootRefused.ok} reason=${rootRefused.reason}`,
  );

  const galaxyRung = ladder.find((r) => r.depth === 1);
  check(
    'the galaxy rung can be reached by zooming out',
    galaxyRung.ok === true && galaxyRung.address === 'v1/0',
    `ok=${galaxyRung.ok} address=${galaxyRung.address}`,
  );

  // Sector and system are not zoom targets yet: a sector is now a real address and a real travel
  // destination (ADR-0023), but standing *inside* its wedge is a view that does not exist, so the
  // refusal must name that next missing piece rather than pretend the rung is a label.
  const sectorRung = ladder.find((r) => r.depth === 2);
  check(
    'the sector rung is honest about not being a scene yet',
    sectorRung.ok === false && /sector/i.test(sectorRung.reason ?? ''),
    `ok=${sectorRung.ok} reason=${sectorRung.reason}`,
  );

  // -------------------------------------------------------------------------
  // 2. Price one destination in every method (ADR-0019: method is a choice).
  // -------------------------------------------------------------------------
  // Reset to the system address after the zoom walk, so both prices are from the same `from`.
  await page.goto(url('v1/0.0.0'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__ugb?.ready === true && (window.__ugb?.frame ?? 0) >= 2,
    null,
    { timeout: 30_000 },
  );

  // A **local-field** star (identity 9 is one in nine), so "near" really is near: a disc star
  // would sit tens of thousands of light-years out and the near/far contrast would be about the
  // galaxy's radius rather than about distance pricing.
  const near = await page.evaluate(() => window.__ugb.planTravel('v1/0.0.9'));
  const far = await page.evaluate(() => window.__ugb.planTravel('v1/1'));

  check(
    'a near trip reports every method, all priced',
    near.costs.length === 5 && near.costs.every((c) => typeof c.elapsedS === 'number'),
    near.costs.map((c) => `${c.method}=${c.elapsedS?.toFixed(0)}`).join(' '),
  );

  const costOf = (plan, method) => plan.costs.find((c) => c.method === method)?.elapsedS ?? null;
  const faster = ['impulse', 'warp', 'transwarp', 'hyperspace'];
  let monotone = true;
  for (let i = 1; i < faster.length; i += 1) {
    const prev = costOf(near, faster[i - 1]);
    const cur = costOf(near, faster[i]);
    if (!(cur !== null && prev !== null && cur < prev)) monotone = false;
  }
  check(
    'each faster method is cheaper in time than the one below it',
    monotone,
    faster.map((m) => `${m}=${costOf(near, m)?.toFixed(2)}`).join(' '),
  );

  // -------------------------------------------------------------------------
  // 3. The wormhole carve-out: same fixed dt near and far.
  // -------------------------------------------------------------------------
  const nearWormhole = costOf(near, 'wormhole');
  const farWormhole = costOf(far, 'wormhole');
  check(
    'a wormhole costs the same fixed dt near and across galaxies',
    nearWormhole !== null && nearWormhole === farWormhole,
    `near=${nearWormhole} far=${farWormhole}`,
  );
  check(
    'hyperspace is distance-priced: far costs far more than near',
    costOf(far, 'hyperspace') !== null &&
      costOf(near, 'hyperspace') !== null &&
      costOf(far, 'hyperspace') > costOf(near, 'hyperspace') * 1000,
    `near=${costOf(near, 'hyperspace')?.toFixed(1)} far=${costOf(far, 'hyperspace')?.toFixed(1)}`,
  );

  // -------------------------------------------------------------------------
  // 4. Coverage: galaxy-to-galaxy is no longer refused (ADR-0022's defect).
  // -------------------------------------------------------------------------
  check(
    'a galaxy-to-galaxy trip has a real distance and is accepted',
    far.ok === true &&
      typeof far.distanceM === 'number' &&
      far.distanceM > 1e22 &&
      far.method === 'hyperspace',
    `ok=${far.ok} d=${far.distanceM} method=${far.method}`,
  );

  // -------------------------------------------------------------------------
  // 4b. A **sector** is a real rung, not a label: it is a travel destination with its own distance
  //     and a real method, which is what the insertion bought (ADR-0023).
  // -------------------------------------------------------------------------
  const sectorTrip = await page.evaluate(() => window.__ugb.planTravel('v1/0.2'));
  check(
    'a sector is a travel destination with a real distance',
    sectorTrip.ok === true &&
      typeof sectorTrip.distanceM === 'number' &&
      sectorTrip.distanceM > 0 &&
      sectorTrip.method === 'transwarp',
    `ok=${sectorTrip.ok} d=${sectorTrip.distanceM} method=${sectorTrip.method}`,
  );

  // -------------------------------------------------------------------------
  // 5. Advice, not a gate: inside a system, sublight is the recommendation but every jump method
  //    is still legal (ADR-0019 §3 - the restriction is upward, not downward).
  // -------------------------------------------------------------------------
  // Body addresses (depth 4), so this is genuinely inside one system rather than system-to-system.
  const insideSystem = await page.evaluate(() => window.__ugb.planTravel('v1/0.0.0.1'));
  check(
    'inside one system the recommended plan is sublight',
    insideSystem.ok === true && insideSystem.method === 'impulse',
    `ok=${insideSystem.ok} method=${insideSystem.method}`,
  );

  const forcedJump = await page.evaluate(() => window.__ugb.planTravel('v1/0.0.0.1', 'hyperspace'));
  check(
    'a jump method is still legal inside a system - advice is not a gate',
    forcedJump.ok === true && forcedJump.method === 'hyperspace',
    `ok=${forcedJump.ok} method=${forcedJump.method} reason=${forcedJump.reason}`,
  );

  const failures = checks.filter((c) => !c.ok).length;
  await writeFile(
    path.join(outDir, 'summary.json'),
    `${JSON.stringify({ checks, near, far, failures }, null, 2)}\n`,
  );
  console.log(
    `\n[capture] ${checks.length - failures}/${checks.length} checks passed; ` +
      `summary ${path.relative(root, path.join(outDir, 'summary.json'))}`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await page?.close();
  await browser.close();
  await server?.close();
}