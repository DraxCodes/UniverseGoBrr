#!/usr/bin/env node
/**
 * Watchdog evidence: make frames run long and show the renderer dropping a galaxy tier instead of
 * stalling. Issue 04 D6 / the evidence plan's item 4.
 *
 * The tier counts are prefixes, so a drop is a cheap tail cut; the point of this probe is that it
 * *happens* under sustained long frames and that the HUD says so, without a device loss.
 *
 * Usage (needs the dev server, e.g. `npm run dev`):
 *   node tools/watchdog-probe.mjs --url http://127.0.0.1:5173/
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.scratch/watchdog');
await mkdir(outDir, { recursive: true });

const urlArg = process.argv.indexOf('--url');
const baseUrl = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:5173/';

// The Layer 3 still's camera: the galaxy is framed and the rich tier is in use.
const GALAXY_CAMERA =
  '726150025192868500000,886130388030334300000,-614393258688281300000,2.273020050191636,-0.75';

const target = new URL(baseUrl);
target.search = new URLSearchParams({
  seed: 'ugb-0000',
  epoch: '2000-01-01T00:00:00.000Z',
  addr: 'v1/4.0.-2.7',
  t: '1200',
  cam: GALAXY_CAMERA,
}).toString();

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ugb?.ready === true, null, { timeout: 20_000 });
  await page.waitForFunction(() => (window.__ugb?.fps ?? 0) > 0, null, { timeout: 10_000 });

  const before = await page.evaluate(() => ({
    tier: window.__ugb.tier,
    count: window.__ugb.galaxy?.count ?? null,
    fps: window.__ugb.fps,
  }));
  console.log(`[watchdog] before tier=${before.tier} count=${before.count} fps=${before.fps.toFixed(1)}`);

  // ~90 frames of forced ~45 ms work: long enough for the EMA to cross 40 ms and stay there for
  // the 60 sustained frames the watchdog requires.
  await page.evaluate(() => window.__ugb.forceSlowFrames(90));
  const dropped = await page
    .waitForFunction(() => window.__ugb.tier !== 'rich', null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  const after = await page.evaluate(() => ({
    tier: window.__ugb.tier,
    count: window.__ugb.galaxy?.count ?? null,
    fps: window.__ugb.fps,
    notice: document.querySelector('#hud-notice')?.textContent?.trim() ?? '',
    status: document.querySelector('#hud-status')?.textContent?.trim() ?? '',
    frame: window.__ugb.frame,
  }));
  const file = path.join(outDir, 'after-drop.png');
  await page.screenshot({ path: file });
  console.log(
    `[watchdog] after  tier=${after.tier} count=${after.count} fps=${after.fps.toFixed(1)} ` +
      `notice="${after.notice}" status="${after.status}" frame=${after.frame}`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    camera: GALAXY_CAMERA,
    forcedSlowFrames: 90,
    dropped,
    before,
    after,
    errors,
  };
  await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (!dropped) throw new Error('The watchdog did not drop a tier under 90 forced slow frames.');
  if (after.count !== null && before.count !== null && after.count >= before.count) {
    throw new Error(
      `The tier dropped to ${after.tier} but the impostor count did not fall (${before.count} → ${after.count}).`,
    );
  }
  if (after.status !== 'ready') {
    throw new Error(`The app left the ready state during the drop: "${after.status}".`);
  }
  if (errors.length > 0) throw new Error(`Console errors: ${errors.join(' | ')}`);
} finally {
  await browser.close().catch(() => {});
}