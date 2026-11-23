#!/usr/bin/env node
/**
 * Proves Layer 0's dev loop on a real browser:
 *   1. a shader edit rebuilds the pipeline, without reloading the page or re-acquiring the device;
 *   2. a change to the GPU module restarts the app but still reuses the same GPUDevice;
 *   3. no extra tab opens.
 *
 * Runs against `vite` on the fixed dev port (5173). Expects the port to be free.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const baseUrl = 'http://127.0.0.1:5173/';
const shaderPath = path.join(root, 'src', 'gpu', 'stage0.wgsl');
const devicePath = path.join(root, 'src', 'gpu', 'device.ts');

const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');

let server = null;
let browser = null;

const originalShader = await readFile(shaderPath, 'utf8');
const originalDevice = await readFile(devicePath, 'utf8');

try {
  console.log(
    '[dev-loop] temporarily edits src/gpu/stage0.wgsl and src/gpu/device.ts; do not edit during the run.',
  );
  server = await startDevServer();
  console.log(`[dev-loop] dev server ready at ${baseUrl}`);

  browser = await chromium.launch({
    channel: 'chrome',
    headless: !headed,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });

  const context = await browser.newContext({
    viewport: { width: 900, height: 600 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleLog = [];
  page.on('console', (message) => {
    consoleLog.push(`${message.type()}: ${message.text()}`);
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(`${baseUrl}?seed=dev-loop&epoch=2000-01-01T00:00:00.000Z&t=0&cam=0,0,0,0,0`, {
    waitUntil: 'domcontentloaded',
  });
  await waitReady(page);

  const initial = await snapshot(page);
  assert(initial.ready, 'the app did not become ready');
  assert(initial.deviceId !== '', 'the app did not report a GPUDevice');
  assert(initial.pipelineGeneration >= 1, 'the app did not report a pipeline');
  console.log(
    `[dev-loop] ready: load=${short(initial.pageLoadId)} boot=${short(initial.bootId)} ` +
      `device=${short(initial.deviceId)} gen=${initial.pipelineGeneration}`,
  );

  // 1. Shader edit: pipeline only.
  await writeFile(shaderPath, `${originalShader}\n// dev-loop shader check ${Date.now()}\n`);
  await waitFor(
    page,
    (previous) => (window.__ugb?.pipelineGeneration ?? 0) > previous,
    initial.pipelineGeneration,
    'shader edit to rebuild the pipeline',
    consoleLog,
  );
  const afterShader = await snapshot(page);
  assert(
    afterShader.pageLoadId === initial.pageLoadId,
    'a shader edit reloaded the page (pageLoadId changed)',
  );
  assert(
    afterShader.bootId === initial.bootId,
    'a shader edit restarted the app (bootId changed)',
  );
  assert(
    afterShader.deviceId === initial.deviceId,
    'a shader edit acquired a new GPUDevice (deviceId changed)',
  );
  assert(
    afterShader.pipelineGeneration > initial.pipelineGeneration,
    'the pipeline generation did not advance after the shader edit',
  );
  await waitForFrames(page, afterShader.frame);
  console.log(
    `[dev-loop] shader edit → gen ${afterShader.pipelineGeneration}; ` +
      'page, app and GPUDevice all survived',
  );

  // Chokidar coalesces writes that land inside its 100 ms atomic window; a human editor never
  // writes that fast, but this script would. Settle before the next write.
  await delay(300);
  await writeFile(shaderPath, originalShader);
  await waitFor(
    page,
    (previous) => (window.__ugb?.pipelineGeneration ?? 0) > previous,
    afterShader.pipelineGeneration,
    'shader restore to rebuild the pipeline',
    consoleLog,
  );
  const afterRestore = await snapshot(page);
  assert(
    afterRestore.deviceId === initial.deviceId && afterRestore.pageLoadId === initial.pageLoadId,
    'restoring the shader broke the device or reloaded the page',
  );
  console.log(`[dev-loop] shader restored → gen ${afterRestore.pipelineGeneration}`);

  // 2. GPU module edit: app restart, same device, no page reload.
  await writeFile(devicePath, `${originalDevice}\n// dev-loop device check ${Date.now()}\n`);
  await waitFor(
    page,
    (previousBoot) =>
      window.__ugb?.bootId !== previousBoot &&
      window.__ugb?.ready === true &&
      (window.__ugb?.frame ?? 0) >= 2,
    afterRestore.bootId,
    'device.ts edit to restart the app',
    consoleLog,
  );
  const afterDevice = await snapshot(page);
  assert(
    afterDevice.pageLoadId === initial.pageLoadId,
    'editing device.ts reloaded the page (pageLoadId changed)',
  );
  assert(
    afterDevice.bootId !== initial.bootId,
    'editing device.ts did not restart the app (bootId unchanged)',
  );
  assert(
    afterDevice.deviceId === initial.deviceId,
    'the GPUDevice was acquired again after editing device.ts (deviceId changed)',
  );
  assert(
    afterDevice.pipelineGeneration === 1,
    `the restarted app should have a fresh pipeline, saw gen ${afterDevice.pipelineGeneration}`,
  );
  console.log(
    `[dev-loop] device.ts edit → boot ${short(afterDevice.bootId)}; ` +
      `same device=${short(afterDevice.deviceId)}, gen reset to 1`,
  );

  await delay(300);
  await writeFile(devicePath, originalDevice);
  await waitFor(
    page,
    (previousBoot) =>
      window.__ugb?.bootId !== previousBoot &&
      window.__ugb?.ready === true &&
      (window.__ugb?.frame ?? 0) >= 2,
    afterDevice.bootId,
    'device.ts restore to restart the app',
    consoleLog,
  );
  const final = await snapshot(page);
  assert(
    final.deviceId === initial.deviceId && final.pageLoadId === initial.pageLoadId,
    'restoring device.ts broke the device cache or reloaded the page',
  );
  assert(context.pages().length === 1, `expected 1 tab, found ${context.pages().length}`);
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`);
  console.log(
    `[dev-loop] device.ts restored → boot ${short(final.bootId)}; ` +
      `device=${short(final.deviceId)} still reused, tabs=${context.pages().length}`,
  );

  console.log('[dev-loop] PASS');
} catch (error) {
  console.error(`[dev-loop] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await writeFile(shaderPath, originalShader).catch(() => {});
  await writeFile(devicePath, originalDevice).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await stopServer(server);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const debug = window.__ugb;
    if (!debug) throw new Error('The debug surface is missing.');
    return {
      ready: debug.ready,
      error: debug.error,
      pageLoadId: debug.pageLoadId,
      bootId: debug.bootId,
      deviceId: debug.deviceId,
      frame: debug.frame,
      pipelineGeneration: debug.pipelineGeneration,
    };
  });
}

async function waitReady(page) {
  try {
    await page.waitForFunction(
      () => window.__ugb?.ready === true && (window.__ugb?.frame ?? 0) >= 2,
      null,
      { timeout: 30_000 },
    );
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
}

async function waitFor(page, predicate, argument, label, consoleLog, timeout = 30_000) {
  try {
    await page.waitForFunction(predicate, argument, { timeout });
  } catch {
    const diagnosis = await page
      .evaluate(() => ({
        ready: window.__ugb?.ready ?? null,
        error: window.__ugb?.error ?? null,
        pageLoadId: window.__ugb?.pageLoadId ?? null,
        bootId: window.__ugb?.bootId ?? null,
        deviceId: window.__ugb?.deviceId ?? null,
        frame: window.__ugb?.frame ?? null,
        pipelineGeneration: window.__ugb?.pipelineGeneration ?? null,
        fatal: document.querySelector('#fatal-message')?.textContent || null,
        status: document.querySelector('#hud-status')?.textContent || null,
      }))
      .catch((error) => ({ evaluationFailed: String(error) }));

    throw new Error(
      `${label} timed out.\nstate: ${JSON.stringify(diagnosis, null, 2)}\n` +
        `console (last 20):\n${consoleLog.slice(-20).join('\n')}`,
    );
  }
}

async function waitForFrames(page, fromFrame) {
  await page.waitForFunction((frame) => (window.__ugb?.frame ?? 0) > frame + 2, fromFrame, {
    timeout: 10_000,
  });
}

async function startDevServer() {
  // Programmatic rather than a child process, so `close()` is awaited and port 5173 can
  // never be left behind by a failed run.
  const server = await createServer({ logLevel: 'warn' });
  try {
    await server.listen();
  } catch (error) {
    await server.close().catch(() => {});
    throw new Error(`Vite could not listen on 5173 (strictPort). Is it already in use?\n${error}`);
  }
  return server;
}

async function stopServer(server) {
  await server.close().catch(() => {});
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function short(value) {
  return value.length > 8 ? value.slice(0, 8) : value;
}