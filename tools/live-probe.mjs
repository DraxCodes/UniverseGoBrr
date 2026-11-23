#!/usr/bin/env node
/**
 * Live-loop probe: walk the camera in wheel steps across the ring-hide threshold and report the
 * frame's luminance at each step.
 *
 * The deterministic shot set is stills. A fade that pops as the eye crosses a ring's radius, or a
 * ring-hide threshold that is abrupt, is invisible in it: every shot is a single pinned frame. This
 * steps the wheel and records the mean luminance and stdev per step, so a discontinuity shows as a
 * jump between two adjacent steps rather than as a smooth ramp.
 *
 * Usage (needs the dev server, e.g. `npm run dev`):
 *   node tools/live-probe.mjs --url http://127.0.0.1:5173/
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.scratch/live-probe');
await mkdir(outDir, { recursive: true });

const urlArg = process.argv.indexOf('--url');
const baseUrl = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:5173/';
const AU = 1.496e11;

// The orrery framing from capture/shots.json (layer2-orrery), so the probe starts where the
// scored still starts.
const ORRERY_CAMERA = '0,4039008706713.87,5435959086479.569,0,-0.6390168339184684';
const target = new URL(baseUrl);
target.search = new URLSearchParams({
  seed: 'ugb-0000',
  epoch: '2000-01-01T00:00:00.000Z',
  addr: 'v1/4.-2.7',
  t: '1200',
  cam: ORRERY_CAMERA,
}).toString();

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});

const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' });
const page = await context.newPage();
await page.goto(target.href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ugb?.frame >= 3, null, { timeout: 20_000 });

/** One wheel gesture, then read the frame it produced. */
async function sample(dir, label) {
  const frame = await page.evaluate(() => window.__ugb.frame);
  // Wait for the loop to draw after the input before reading back.
  await page.waitForFunction((n) => window.__ugb.frame > n + 1, frame, { timeout: 5000 });
  const stats = await page.evaluate(() => window.__ugb.sampleCanvas());
  const camera = await page.evaluate(() => window.__ugb.state.camera);
  const eyeAU = Math.hypot(camera[0], camera[1], camera[2]) / AU;
  const file = path.join(outDir, dir, `${label}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: 'png' });
  const entry = {
    label,
    eyeAU: Number(eyeAU.toFixed(3)),
    mean: Number(stats.mean.toFixed(5)),
    stdev: Number(stats.stdev.toFixed(5)),
    file: path.relative(root, file),
  };
  console.log(
    `[live] ${dir} ${label} eye=${entry.eyeAU.toFixed(2)} AU mean=${entry.mean.toFixed(4)} ` +
      `stdev=${entry.stdev.toFixed(4)}`,
  );
  return entry;
}

/** Report the largest step-to-step change; a pop is a discontinuity that dwarfs its neighbours. */
function summarise(steps) {
  const deltas = steps.slice(1).map((step, index) => ({
    delta: Math.abs(step.mean - steps[index].mean),
    at: step.label,
  }));
  const sorted = deltas.map((x) => x.delta).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const worst = deltas.reduce((a, b) => (a.delta > b.delta ? a : b), { delta: 0, at: '-' });
  return {
    maxDelta: Number(worst.delta.toFixed(5)),
    at: worst.at,
    median: Number(median.toFixed(5)),
    ratio: Number((worst.delta / Math.max(median, 1e-9)).toFixed(1)),
  };
}

await page.mouse.move(960, 700);

const inward = [await sample('in', 'step-00')];
for (let index = 1; index <= 18; index += 1) {
  await page.mouse.wheel(0, -120);
  inward.push(await sample('in', `step-${String(index).padStart(2, '0')}`));
}

// Reset to the framed camera before walking the other way.
await page.goto(target.href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ugb?.frame >= 3, null, { timeout: 20_000 });
await page.mouse.move(960, 700);

const outward = [await sample('out', 'step-00')];
for (let index = 1; index <= 20; index += 1) {
  await page.mouse.wheel(0, 120);
  outward.push(await sample('out', `step-${String(index).padStart(2, '0')}`));
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  camera: ORRERY_CAMERA,
  inward: { steps: inward, summary: summarise(inward) },
  outward: { steps: outward, summary: summarise(outward) },
};
await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[live] inward  ${JSON.stringify(report.inward.summary)}`);
console.log(`[live] outward ${JSON.stringify(report.outward.summary)}`);

await context.close();
await browser.close();