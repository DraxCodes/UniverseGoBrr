#!/usr/bin/env node
/**
 * State probes: the HUD's non-happy-path states, captured outside the deterministic shot set.
 *
 * The 13-shot set pins a ready, paused frame; it says nothing about what a viewer sees while the
 * app boots, when a URL is rejected, or when WebGPU is unavailable. Those are the states the
 * perception gate cannot certify from the shot set, so they are captured here as evidence.
 *
 * Usage: node .scratch/state-probe.mjs [--url http://127.0.0.1:5173/]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.scratch/state-probe');
await mkdir(outDir, { recursive: true });

const urlArg = process.argv.indexOf('--url');
const baseUrl = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:5173/';
const pinned = new URLSearchParams({
  seed: 'ugb-0000',
  epoch: '2000-01-01T00:00:00.000Z',
  addr: 'v1/4.-2.7',
  t: '1200',
  cam: '0,1.33,1.79,0,-0.64',
});

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});

const report = [];

async function shot(name, setup, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'light',
  });
  try {
    const page = await context.newPage();
    const file = path.join(outDir, `${name}.png`);
    const observed = await setup(page);
    await page.screenshot({ path: file, type: 'png' });
    report.push({ name, file: path.relative(root, file), ...(observed ?? {}) });
    console.log(`[state] ok  ${name} -> ${path.relative(root, file)}`);
  } catch (error) {
    report.push({ name, error: error instanceof Error ? error.message : String(error) });
    console.error(`[state] FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Boot, before the first frame: the HUD is up, the status is still a boot status. */
await shot('loading', async (page) => {
  await page.route('**/src/main.ts', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#hud-status');
  await page.waitForTimeout(250);
  return page.evaluate(() => ({
    status: document.querySelector('#hud-status')?.textContent ?? null,
  }));
});

/** A rejected URL: the HUD has to say what it replaced, not silently draw a default. */
await shot('error-url', async (page) => {
  const search = new URLSearchParams(pinned);
  search.set('addr', 'garbage');
  search.set('cam', 'not-a-camera');
  await page.goto(`${baseUrl}?${search.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ugb?.frame >= 2, null, { timeout: 20000 });
  return page.evaluate(() => ({
    status: document.querySelector('#hud-status')?.textContent ?? null,
    issues: (document.querySelector('#hud-issues')?.textContent ?? '').trim(),
    issuesVisible: !document.querySelector('#hud-issues')?.hidden,
  }));
});

/** Live clock: P unpins t, so the HUD no longer claims a pinned frame. */
await shot('paused-to-live', async (page) => {
  await page.goto(`${baseUrl}?${pinned.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ugb?.frame >= 2, null, { timeout: 20000 });
  await page.keyboard.press('p');
  await page.waitForTimeout(600);
  return page.evaluate(() => ({
    status: document.querySelector('#hud-status')?.textContent ?? null,
    time: document.querySelector('#hud-time')?.textContent ?? null,
  }));
});

/** WebGPU missing: the app must fail loudly, not show an empty canvas. */
await shot('fatal-no-webgpu', async (page) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true });
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fatal:not([hidden])', { timeout: 15000 });
  return page.evaluate(() => ({
    fatal: (document.querySelector('#fatal-message')?.textContent ?? '').trim(),
    hudHidden: document.querySelector('#hud')?.hidden ?? null,
  }));
});

await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(`[state] wrote ${path.relative(root, path.join(outDir, 'summary.json'))}`);