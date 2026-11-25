#!/usr/bin/env node
/**
 * Capture a gallery of galaxies, each framed at the same multiple of **its own** radius.
 *
 * This is the instrument for judging the galaxy variation law (ticket 06, work item 4) as a *law*
 * rather than as one seed. `npm run capture` frames the one galaxy the manifest names; that is the
 * right evidence for "the shipped shot is good", but it cannot tell you whether a galaxy at the
 * other end of the draw ranges reads as a galaxy at all. It was this gallery that caught the first
 * cut of the law drawing radial spokes instead of arms for four of twelve galaxies — a defect the
 * manifest's single framed galaxy did not show.
 *
 * Each frame uses the manifest's camera **composition** - the oblique look from 2.6 R off the home
 * star - scaled to that galaxy's radius, so the only thing that changes between frames is the galaxy
 * itself. The camera looks at the **home star**, not the nucleus: the star is a random point in the
 * disc, so the drawn centre sits about half a radius off frame centre in a direction that differs per
 * galaxy, and the disc's apparent bounding box varies with it. That is the ship composition, not a
 * defect. Size is therefore *not* visible here; use a fixed absolute camera for that.
 *
 * Usage:
 *   node tools/galaxy-gallery.mjs --out .scratch/gallery
 *   node tools/galaxy-gallery.mjs --out .scratch/gallery --seed ugb-0007 --count 12
 *   node tools/galaxy-gallery.mjs --out .scratch/gallery-size --fixed-distance-m 1e21
 *
 * `--fixed-distance-m` frames every galaxy from the **same absolute** camera instead of at 2.6 of
 * its own radius. That is the only way to see the size law: with a per-galaxy distance every disc
 * fills the same fraction of frame by construction, so a 0.5e20 and a 9e20 galaxy look identical.
 * At a fixed distance the same twelve galaxies differ in apparent size by the whole 18x range.
 *
 * Writes `galaxy-00.png`.. plus `shapes.txt` (the drawn shape of each) to the output directory.
 * Requires `npm run build` and a free port 4174.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
/** The capture manifest's galaxy composition: yaw, pitch and 2.6 radii from the target. */
const YAW = 2.273020050191636;
const PITCH = -0.75;
const DISTANCE_R = 2.6;
const T_VAL = 1200;
const EPOCH_STR = '2000-01-01T00:00:00.000Z';
const PORT = 4174;

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(root, args.out ?? '.scratch/gallery');
const seed = args.seed ?? 'ugb-0000';
const count = args.count ?? 12;
/** When set, every frame uses this absolute distance: the only view that shows the size law. */
const fixedDistanceM = args.fixedDistanceM ? Number(args.fixedDistanceM) : null;
if (fixedDistanceM !== null && !(Number.isFinite(fixedDistanceM) && fixedDistanceM > 0)) {
  throw new Error(`--fixed-distance-m must be a positive number, got "${args.fixedDistanceM}"`);
}

await mkdir(outDir, { recursive: true });

const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

let previewServer = null;
let browser = null;

try {
  const [{ generateGalaxy }, { parseAddressOrThrow }] = await Promise.all([
    vite.ssrLoadModule('/src/universe/galaxy.ts'),
    vite.ssrLoadModule('/src/frame/address.ts'),
  ]);

  previewServer = await preview({
    root,
    preview: { host: '127.0.0.1', port: PORT, strictPort: true },
    logLevel: 'warn',
  });
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });

  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const addressText = `v1/${index}`;
    const address = parseAddressOrThrow(addressText);
    const galaxy = generateGalaxy(seed, address, 'rich');
    const distance = fixedDistanceM ?? DISTANCE_R * galaxy.radius;
    const cosPitch = Math.cos(PITCH);
    const cam = [
      Math.sin(YAW) * cosPitch * distance,
      -Math.sin(PITCH) * distance,
      Math.cos(YAW) * cosPitch * distance,
      YAW,
      PITCH,
    ];

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'en-GB',
    });
    try {
      const page = await context.newPage();
      const target = new URL(`http://127.0.0.1:${PORT}/`);
      target.search = new URLSearchParams({
        seed,
        epoch: EPOCH_STR,
        addr: addressText,
        t: String(T_VAL),
        cam: cam.join(','),
      }).toString();
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__ugb?.ready === true, null, { timeout: 20_000 });
      await page.waitForFunction(() => (window.__ugb?.frame ?? 0) >= 3, null, { timeout: 10_000 });
      const file = path.join(outDir, `galaxy-${String(index).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      const s = galaxy.shape;
      rows.push(
        `${addressText.padEnd(6)} R=${(galaxy.radius / 1e20).toFixed(2)}e20 arms=${s.armCount} ` +
          `sweep=${((s.armSweepRad * 180) / Math.PI).toFixed(0)}° wind=${s.winding.toFixed(2)} ` +
          `scale=${s.scaleLengthFraction.toFixed(2)} ` +
          `bulge=${s.bulgeFraction.toFixed(2)}/${s.bulgeRadiusFraction.toFixed(2)} ` +
          `flat=${s.bulgeFlattening.toFixed(2)} bar=${s.barStrength.toFixed(2)} ` +
          `halo=${s.haloFraction.toFixed(3)} dust=${s.dustDepth.toFixed(2)} age=${s.colourAge.toFixed(2)}`,
      );
    } finally {
      await context.close().catch(() => {});
    }
  }

  await writeFile(
    path.join(outDir, 'shapes.txt'),
    `${rows.join('\n')}\n\nframing: ${
      fixedDistanceM === null
        ? `2.6 x own radius (size not comparable between rows)`
        : `fixed ${fixedDistanceM} m for every row (size IS comparable)`
    }\n`,
  );
  console.log(rows.join('\n'));
  console.log(
    `\n[gallery] ${count} galaxies -> ${outDir} (framing: ${
      fixedDistanceM === null ? '2.6 x own radius' : `fixed ${fixedDistanceM} m`
    })`,
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (previewServer) await previewServer.close().catch(() => {});
  await vite.close().catch(() => {});
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      parsed.out = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--seed') {
      parsed.seed = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--count') {
      parsed.count = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--fixed-distance-m') {
      parsed.fixedDistanceM = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        'Usage: node tools/galaxy-gallery.mjs [--out DIR] [--seed SEED] [--count N] [--fixed-distance-m M]',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return parsed;
}
