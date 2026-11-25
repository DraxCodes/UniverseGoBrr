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
 * Layer 3 adds the **handoff leg**: one continuous outward run from the orrery through the
 * system→galaxy crossfade to the far wheel clamp, recording `lod` (the shared crossfade value),
 * arm `contrast`, the impostor count and the HUD's own scene row at each step. The still set
 * cannot show a transition; this leg is the evidence that the order is rings → point → arm → disc
 * and that the handoff does not double-expose or pop.
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
  addr: 'v1/4.0.-2.7',
  t: '1200',
  cam: ORRERY_CAMERA,
}).toString();

// The disc is inclined 30° about world x, so an outward run that keeps the orrery pitch looks
// along the plane: `lod` correctly never resolves (an edge-on disc has no arms to read) and the
// crossfade this leg exists to measure never happens. Incline the handoff camera by the tilt at
// the same distance, which is the camera `galaxy-scene.test.ts` calls GALLERY_PITCH.
const ORRERY_PITCH = -0.6390168339184684;
const GALACTIC_TILT = (-30 * Math.PI) / 180;
const ORRERY_DISTANCE = Math.hypot(4039008706713.87, 5435959086479.569);
const HANDOFF_PITCH = ORRERY_PITCH + GALACTIC_TILT;
const HANDOFF_CAMERA = [
  0,
  -Math.sin(HANDOFF_PITCH) * ORRERY_DISTANCE,
  Math.cos(HANDOFF_PITCH) * ORRERY_DISTANCE,
  0,
  HANDOFF_PITCH,
].join(',');
const handoffTarget = new URL(target.href);
handoffTarget.searchParams.set('cam', HANDOFF_CAMERA);

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
  const galaxy = await page.evaluate(() => window.__ugb.galaxy);
  const scene = await page.evaluate(
    () => document.querySelector('#hud-scene')?.textContent?.trim() ?? '',
  );
  const eyeAU = Math.hypot(camera[0], camera[1], camera[2]) / AU;
  const file = path.join(outDir, dir, `${label}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: 'png' });
  const entry = {
    label,
    eyeAU: Number(eyeAU.toFixed(3)),
    mean: Number(stats.mean.toFixed(5)),
    stdev: Number(stats.stdev.toFixed(5)),
    lod: galaxy ? Number(galaxy.lod.toFixed(3)) : null,
    contrast: galaxy ? Number(galaxy.contrast.toFixed(3)) : null,
    count: galaxy?.count ?? null,
    tier: galaxy?.tier ?? null,
    scene,
    file: path.relative(root, file),
  };
  console.log(
    `[live] ${dir} ${label} eye=${entry.eyeAU.toFixed(2)} AU mean=${entry.mean.toFixed(4)} ` +
      `stdev=${entry.stdev.toFixed(4)} lod=${entry.lod ?? '-'} count=${entry.count ?? '-'} ` +
      `scene="${scene}"`,
  );
  return entry;
}

/**
 * The crossfade's own evidence: `lod` must climb from 0 to 1 without going back down, and the
 * handoff window is where the two scene rows swap. A step that reports `lod` outside [0,1], or a
 * decrease, is a pop the stills could not show.
 */
function summariseHandoff(steps) {
  const lods = steps.map((step) => step.lod ?? 0);
  let decreases = 0;
  let worstDecrease = 0;
  for (let index = 1; index < lods.length; index += 1) {
    const delta = lods[index] - lods[index - 1];
    if (delta < -1e-6) {
      decreases += 1;
      worstDecrease = Math.min(worstDecrease, delta);
    }
  }
  const firstRamp = steps.find((step) => (step.lod ?? 0) > 0.02);
  const firstFull = steps.find((step) => (step.lod ?? 0) >= 0.98);
  const handoff = steps.filter((step) => (step.lod ?? 0) > 0.02 && (step.lod ?? 0) < 0.98);
  return {
    steps: steps.length,
    decreases,
    worstDecrease: Number(worstDecrease.toFixed(4)),
    firstRampAt: firstRamp?.label ?? null,
    firstFullAt: firstFull?.label ?? null,
    handoffSteps: handoff.length,
    maxCount: Math.max(...steps.map((step) => step.count ?? 0)),
    sceneRows: [...new Set(steps.map((step) => step.scene))].length,
  };
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

// --- The handoff leg: one continuous outward run, orrery → galaxy → far clamp. --------------
// 80 notches at 120 px: the void boost crosses the eight decades in roughly 45, the legibility
// ramp starts near 4.7e20 m and completes near 7.5e20 m, and the tail pins the far clamp
// (6e21 m = 12 R) so the run has a definite end. This leg starts at the orrery *distance* but
// on the inclined handoff camera, so the crossfade it measures is the one a viewer who has
// orbited to see the disc gets - not the edge-on pass that keeps `lod` at zero by design.
await page.goto(handoffTarget.href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ugb?.frame >= 3, null, { timeout: 20_000 });
await page.mouse.move(960, 700);

const handoff = [await sample('handoff', 'step-00')];
for (let index = 1; index <= 80; index += 1) {
  await page.mouse.wheel(0, 120);
  handoff.push(await sample('handoff', `step-${String(index).padStart(2, '0')}`));
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  camera: ORRERY_CAMERA,
  handoffCamera: HANDOFF_CAMERA,
  inward: { steps: inward, summary: summarise(inward) },
  outward: { steps: outward, summary: summarise(outward) },
  handoff: { steps: handoff, summary: summariseHandoff(handoff) },
};
await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[live] inward  ${JSON.stringify(report.inward.summary)}`);
console.log(`[live] outward ${JSON.stringify(report.outward.summary)}`);
console.log(`[live] handoff ${JSON.stringify(report.handoff.summary)}`);

await context.close();
await browser.close();