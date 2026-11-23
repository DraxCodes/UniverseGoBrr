#!/usr/bin/env node
/**
 * Capture harness: a fixed seed + epoch + t + camera -> screenshot.
 *
 * Captures the *built* app through `vite preview` on a fixed port, using installed Chrome
 * (no Playwright browser download). Every shot pins `t`, so the frame is reproducible.
 *
 * Usage:
 *   npm run build && npm run capture
 *   node tools/capture.mjs --shot layer0-1080p --headed
 *   node tools/capture.mjs --url http://127.0.0.1:5173/
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:4173/';

const args = parseArgs(process.argv.slice(2));

let previewServer = null;
let browser = null;

try {
  const manifest = await loadManifest(path.resolve(root, args.manifest));
  const shots = args.only ? manifest.shots.filter((shot) => shot.name === args.only) : manifest.shots;
  if (shots.length === 0) {
    throw new Error(`No shot${args.only ? ` named "${args.only}"` : 's'} in ${args.manifest}.`);
  }

  const outDir = path.resolve(root, args.out);
  await mkdir(outDir, { recursive: true });

  let baseUrl = args.url;
  if (!baseUrl) {
    previewServer = await startPreview();
    baseUrl = previewServer.url;
    console.log(`[capture] preview ready at ${baseUrl}`);
  }

  browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.headed,
    // Not required by every Chrome, but historically required for headless WebGPU, and
    // harmless where it is already enabled.
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });

  const results = [];
  const failures = [];

  for (const shot of shots) {
    const label = `${shot.name} (${shot.width}×${shot.height})`;
    try {
      const result = await captureShot(browser, baseUrl, outDir, shot);
      results.push(result);
      const file = path.relative(root, result.file);
      console.log(
        `[capture] ok  ${label}  frame=${result.frame} gen=${result.pipelineGeneration} ` +
          `mean=${result.sample.mean.toFixed(4)} stdev=${result.sample.stdev.toFixed(4)} → ${file}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ name: shot.name, message });
      console.error(`[capture] FAIL ${label}\n${indent(message)}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    manifest: args.manifest,
    shots: results,
    failures,
  };
  await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(
    `[capture] ${results.length}/${shots.length} shots passed; summary ${path.relative(
      root,
      path.join(outDir, 'summary.json'),
    )}`,
  );

  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`[capture] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (previewServer) await previewServer.close().catch(() => {});
}

async function captureShot(browserInstance, baseUrl, outDir, shot) {
  const context = await browserInstance.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: shot.dpr ?? 1,
    // Deliberately left at the browser default (light). There is no theme system: if the
    // page honours the OS preference by going light, the shot fails below.
    colorScheme: 'light',
    locale: 'en-GB',
  });

  try {
    const page = await context.newPage();
    const consoleErrors = [];
    const consoleWarnings = [];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
      if (message.type() === 'warning') consoleWarnings.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    const target = new URL(baseUrl);
    target.search = buildSearch(shot);

    await page.goto(target.href, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(() => window.__ugb?.ready === true, null, { timeout: 20_000 });
      await page.waitForFunction(() => (window.__ugb?.frame ?? 0) >= 3, null, { timeout: 10_000 });
      // The HUD's fps row updates on the first stats tick; wait so evidence is complete.
      await page.waitForFunction(() => (window.__ugb?.fps ?? 0) > 0, null, { timeout: 5_000 });
    } catch {
      const diagnosis = await page
        .evaluate(() => ({
          error: window.__ugb?.error ?? null,
          fatal: document.querySelector('#fatal-message')?.textContent || null,
          status: document.querySelector('#hud-status')?.textContent || null,
          hasWebGpu: 'gpu' in navigator,
        }))
        .catch(() => ({ note: 'page evaluation failed too' }));
      throw new Error(`App never became ready.\n${JSON.stringify(diagnosis, null, 2)}`);
    }

    const observed = await page.evaluate(() => {
      const debug = window.__ugb;
      if (!debug) throw new Error('The debug surface is missing.');
      const canvas = document.querySelector('canvas');
      return {
        pageLoadId: debug.pageLoadId,
        deviceId: debug.deviceId,
        frame: debug.frame,
        pipelineGeneration: debug.pipelineGeneration,
        state: debug.state,
        precisionReport: debug.precisionReport,
        // The app's own verdict on the query string. Non-empty means it replaced a value with
        // a default, so the shot is evidence of a different coordinate than it claims.
        urlIssues: (document.querySelector('#hud-issues')?.textContent || '').trim(),
        url: { pathname: location.pathname, search: location.search },
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        appearance: {
          // The context asks for a light OS preference; the page must ignore it.
          osPrefersLight: matchMedia('(prefers-color-scheme: light)').matches,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          backdrop: getComputedStyle(document.body).backgroundColor,
        },
        canvas: canvas
          ? {
              width: canvas.width,
              height: canvas.height,
              cssWidth: canvas.clientWidth,
              cssHeight: canvas.clientHeight,
            }
          : null,
      };
    });

    assertState(shot, observed.state);
    assertAcceptedQuery(shot, observed.urlIssues);

    if (!observed.deviceId) throw new Error('No GPUDevice id was reported.');
    if (observed.pipelineGeneration < 1) throw new Error('No render pipeline was built.');
    assertFullBleed(observed);
    assertDarkOnly(shot.name, observed);
    assertPrecisionControl(shot, observed.precisionReport);

    const sample = await page.evaluate(() => window.__ugb.sampleCanvas());
    if (!Number.isFinite(sample.mean) || !Number.isFinite(sample.stdev)) {
      throw new Error(`GPU readback returned invalid statistics: ${JSON.stringify(sample)}`);
    }
    if (sample.stdev < 0.002) {
      throw new Error(
        `The frame looks blank (stdev ${sample.stdev.toFixed(5)}, mean ${sample.mean.toFixed(5)}).`,
      );
    }

    const file = path.join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: false });

    if (consoleErrors.length > 0) {
      throw new Error(`Console errors:\n${consoleErrors.map(indent).join('\n')}`);
    }

    return {
      name: shot.name,
      file,
      width: shot.width,
      height: shot.height,
      dpr: shot.dpr ?? 1,
      seed: shot.seed,
      epoch: shot.epoch,
      address: shot.address ?? 'v1/0',
      t: shot.t,
      camera: shot.camera,
      precision: shot.precision ?? null,
      frame: observed.frame,
      pipelineGeneration: observed.pipelineGeneration,
      deviceId: observed.deviceId,
      state: observed.state,
      precisionReport: observed.precisionReport,
      url: observed.url,
      viewport: observed.viewport,
      appearance: observed.appearance,
      canvas: observed.canvas,
      sample,
      consoleWarnings,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function loadManifest(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`Cannot read shot manifest at ${file}.`);
  }

  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest.shots) || manifest.shots.length === 0) {
    throw new Error(`${file} must contain a non-empty "shots" array.`);
  }

  for (const shot of manifest.shots) validateShot(shot, file);
  return manifest;
}

function validateShot(shot, file) {
  const where = `${file}: shot ${JSON.stringify(shot?.name ?? '(unnamed)')}`;
  if (!shot || typeof shot !== 'object') throw new Error(`${where} is not an object.`);
  if (!/^[A-Za-z0-9._-]+$/.test(shot.name ?? '')) {
    throw new Error(`${where}: name must match [A-Za-z0-9._-]+ (it becomes a filename).`);
  }
  if (!Number.isInteger(shot.width) || shot.width <= 0) throw new Error(`${where}: bad width.`);
  if (!Number.isInteger(shot.height) || shot.height <= 0) throw new Error(`${where}: bad height.`);
  if (typeof shot.seed !== 'string' || shot.seed.length === 0) {
    throw new Error(`${where}: seed must be a non-empty string.`);
  }
  if (shot.address !== undefined) {
    // Deliberately loose: a typo guard, not a second copy of the address grammar. The page's
    // parser is the authority, and `assertAcceptedQuery` below fails the shot if it rejects
    // the value — otherwise a rejected `addr` would silently capture the default coordinate.
    if (typeof shot.address !== 'string' || !/^v\d+\/[-.\d]*$/.test(shot.address)) {
      throw new Error(`${where}: address must look like v1/0.3.-7 (or v1/ for the root).`);
    }
  }
  if (
    typeof shot.epoch !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(shot.epoch) ||
    !Number.isFinite(Date.parse(shot.epoch))
  ) {
    throw new Error(`${where}: epoch must be a parseable ISO 8601 string.`);
  }
  if (typeof shot.t !== 'number' || !Number.isFinite(shot.t)) {
    throw new Error(`${where}: t must be finite (shots are pinned, never live).`);
  }
  if (
    !Array.isArray(shot.camera) ||
    shot.camera.length !== 5 ||
    shot.camera.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new Error(`${where}: camera must be [x, y, z, yaw, pitch].`);
  }
  if (shot.precision !== undefined && shot.precision !== 'fixed' && shot.precision !== 'naive') {
    throw new Error(`${where}: precision must be "fixed" or "naive" when present.`);
  }
  if (shot.dpr !== undefined) {
    if (typeof shot.dpr !== 'number' || !(shot.dpr >= 1 && shot.dpr <= 2)) {
      throw new Error(`${where}: dpr must be a number in [1, 2] when present.`);
    }
  }
}

function buildSearch(shot) {
  const params = new URLSearchParams({
    seed: shot.seed,
    epoch: shot.epoch,
    addr: shot.address ?? 'v1/0',
    t: String(shot.t),
    cam: shot.camera.join(','),
  });
  if (shot.precision) params.set('precision', shot.precision);
  return params.toString();
}

function assertState(shot, state) {
  const problems = [];
  if (state.seed !== shot.seed) problems.push(`seed ${state.seed} != ${shot.seed}`);
  if (state.epoch !== new Date(shot.epoch).toISOString()) {
    problems.push(`epoch ${state.epoch} != ${new Date(shot.epoch).toISOString()}`);
  }
  if (state.address !== (shot.address ?? 'v1/0')) {
    problems.push(`address ${state.address} != ${shot.address ?? 'v1/0'}`);
  }
  if (state.t !== shot.t) problems.push(`t ${state.t} != ${shot.t}`);
  if ((state.precision ?? null) !== (shot.precision ?? null)) {
    problems.push(`precision ${state.precision ?? 'none'} != ${shot.precision ?? 'none'}`);
  }

  const expectedCamera = shot.camera;
  const actualCamera = state.camera;
  for (let index = 0; index < 5; index += 1) {
    const expected = expectedCamera[index] ?? 0;
    const actual = actualCamera[index] ?? 0;
    // Relative tolerance: the URL carries ~15 significant digits, so a system-scale camera
    // (10¹² m) legitimately differs in the last bits by more than an absolute 1e-9.
    if (Math.abs(actual - expected) > 1e-9 * Math.max(1, Math.abs(expected))) {
      problems.push(`camera[${index}] ${actual} != ${expected}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`The page did not adopt the requested coordinate:\n${problems.map(indent).join('\n')}`);
  }
}

/**
 * The page is the authority on its own query string. If it reports a rejected value it has
 * substituted a default, and the shot is then evidence of a different coordinate than the
 * manifest claims — the exact failure that produced a retracted number in Layer 1. Fail loudly
 * instead of capturing a picture of the wrong frame.
 */
function assertAcceptedQuery(shot, urlIssues) {
  if (urlIssues) {
    throw new Error(
      `The app rejected part of shot ${JSON.stringify(shot.name)}'s URL, so the image would ` +
        `show a default instead of the requested coordinate:\n${indent(urlIssues)}`,
    );
  }
}

/**
 * The app is full-bleed at desktop sizes: the canvas covers the viewport and its backing
 * store matches the CSS size times DPR (clamped to 2 by the renderer). This is the whole
 * point of the desktop-width shots, so it is asserted rather than eyeballed.
 */
function assertFullBleed({ viewport, canvas, name }) {
  const problems = [];
  if (!canvas) {
    problems.push('no <canvas> element');
  } else {
    const dpr = Math.min(Math.max(viewport.dpr || 1, 1), 2);
    if (canvas.cssWidth !== viewport.width || canvas.cssHeight !== viewport.height) {
      problems.push(
        `canvas covers ${canvas.cssWidth}x${canvas.cssHeight}, viewport is ${viewport.width}x${viewport.height}`,
      );
    }
    if (canvas.width !== Math.round(canvas.cssWidth * dpr)) {
      problems.push(`canvas backing width ${canvas.width} != ${canvas.cssWidth} x dpr ${dpr}`);
    }
    if (canvas.height !== Math.round(canvas.cssHeight * dpr)) {
      problems.push(`canvas backing height ${canvas.height} != ${canvas.cssHeight} x dpr ${dpr}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Shot ${name} is not full-bleed:\n${problems.map(indent).join('\n')}`);
  }
}

/**
 * One look, and it is dark (ADR-0007). The browser context emulates a light OS preference,
 * so this is a real assertion that the page does not follow it: the same rule a
 * `prefers-color-scheme` branch would break.
 */
function assertDarkOnly(name, { appearance }) {
  const problems = [];
  if (!appearance.osPrefersLight) {
    problems.push('the harness failed to emulate a light OS preference, so the check proves nothing');
  }
  const schemes = appearance.colorScheme.split(/\s+/).filter(Boolean);
  if (!schemes.includes('dark')) {
    problems.push(`document color-scheme is "${appearance.colorScheme}", not dark`);
  }
  const channels = (appearance.backdrop.match(/[\d.]+/g) ?? []).map(Number);
  if (channels.length < 3 || channels.some((value) => !Number.isFinite(value))) {
    problems.push(`cannot read the page backdrop colour: ${appearance.backdrop}`);
  } else {
    const [r, g, b] = channels;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luminance > 40) {
      problems.push(`page backdrop ${appearance.backdrop} is light (luminance ${luminance.toFixed(1)})`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Shot ${name} is not dark-only:\n${problems.map(indent).join('\n')}`);
  }
}

/**
 * The negative control. Two shots of the same probe: one through the fixed path, one through
 * the naive path. The naive shot must collapse the markers, and the fixed spread must stay
 * large in *both* shots — otherwise the control has lost its contrast and the fixed shot
 * proves nothing.
 */
function assertPrecisionControl(shot, report) {
  if (!shot.precision) {
    if (report) throw new Error(`Shot ${shot.name} drew the probe but did not ask for it.`);
    return;
  }

  const problems = [];
  if (!report) {
    throw new Error(`Shot ${shot.name} asked for precision=${shot.precision} but no report exists.`);
  }

  const { fixed, naive } = report.paths;
  if (Math.abs(report.originDistanceM - 1e13) > 1) {
    problems.push(`frame origin is now ${report.originDistanceM} m from the camera, not 1e13`);
  }
  if (fixed.spreadPx < 100) {
    problems.push(`the fixed path only separates the markers by ${fixed.spreadPx.toFixed(1)} px`);
  }
  if (naive.spreadPx >= 1) {
    problems.push(`the naive path still separates the markers by ${naive.spreadPx.toFixed(2)} px`);
  }
  if (naive.worstErrorM < 1000) {
    problems.push(`the naive path only loses ${naive.worstErrorM.toFixed(1)} m`);
  }
  if (fixed.worstErrorM > 0.05) {
    problems.push(`the fixed path loses ${fixed.worstErrorM.toFixed(4)} m, over the 50 mm budget`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Shot ${shot.name} did not reproduce the precision control:\n${problems.map(indent).join('\n')}`,
    );
  }
}

async function startPreview() {
  try {
    await access(path.join(root, 'dist', 'index.html'));
  } catch {
    throw new Error('dist/ is missing or stale. Run `npm run build` before `npm run capture`.');
  }

  // Programmatic rather than a child process: `close()` is then a real promise, and a
  // failed script cannot leave a preview server holding port 4173.
  const server = await preview({
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    logLevel: 'warn',
  });

  return { url: DEFAULT_BASE_URL, close: () => server.close() };
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function parseArgs(argv) {
  const parsed = {
    manifest: 'capture/shots.json',
    out: '.scratch/captures',
    url: null,
    headed: false,
    only: null,
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
      case '--manifest':
        parsed.manifest = value();
        break;
      case '--out':
        parsed.out = value();
        break;
      case '--url':
        parsed.url = value();
        break;
      case '--shot':
        parsed.only = value();
        break;
      case '--headed':
        parsed.headed = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'node tools/capture.mjs [--manifest capture/shots.json] [--out .scratch/captures] ' +
            '[--shot name] [--url http://127.0.0.1:4173/] [--headed]',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }

  if (parsed.url && !parsed.url.endsWith('/')) parsed.url += '/';
  return parsed;
}