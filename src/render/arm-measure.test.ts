/**
 * Measure the arm-contrast normaliser per arm count. **Opt-in**, not part of the suite.
 *
 * The renderer reports `contrast = modulation / ARM_CONTRAST_FULL_BY_ARMS[k]`. That normaliser is
 * a measured quantity — "what a strong field of *k* arms measures on this population" — so it is
 * produced here rather than guessed. Rerun after any change to the disc law and paste the table
 * into `src/render/galaxy-scene.ts`.
 *
 * ```powershell
 * $env:UGB_MEASURE=1; npx vitest run src/render/arm-measure.test.ts
 * ```
 *
 * Reasons it is opt-in: it generates 144 rich galaxies (about 8M impostor samples), which is ~16 s
 * of a ~5 s suite, and it asserts nothing about the *result* — the numbers are a calibration to be
 * read, not a regression to be enforced. A future arm-law change would move them, and a failing
 * assertion would then be pointing at the wrong thing.
 *
 * The project deliberately has no `@types/node`, so this file reaches the environment variable
 * through the ambient declaration below instead of `node:process`, and reports with `console.log`
 * instead of writing a file.
 */
declare const process: { env: Record<string, string | undefined> };

import { describe, it } from 'vitest';
import { parseAddressOrThrow } from '../frame/address';
import { generateGalaxy } from '../universe/galaxy';
import { armModulation } from './galaxy-scene';

const SEEDS = Array.from({ length: 12 }, (_, i) => `ugb-${String(i).padStart(4, '0')}`);
const GALAXIES_PER_SEED = 12;

describe.skipIf(!process.env['UGB_MEASURE'])('arm modulation measurement', () => {
  it('reports the distribution per arm count', () => {
    const byArms = new Map<number, number[]>();
    for (const seed of SEEDS) {
      for (let galaxy = 0; galaxy < GALAXIES_PER_SEED; galaxy += 1) {
        const generated = generateGalaxy(seed, parseAddressOrThrow(`v1/${galaxy}`), 'rich');
        const list = byArms.get(generated.shape.armCount) ?? [];
        list.push(armModulation(generated));
        byArms.set(generated.shape.armCount, list);
      }
    }

    const lines: string[] = [];
    for (const [armCount, values] of [...byArms.entries()].sort((a, b) => a[0] - b[0])) {
      const sorted = [...values].sort((a, b) => a - b);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      lines.push(
        `m=${armCount} n=${values.length} mean=${mean.toFixed(4)} p10=${pick(0.1)!.toFixed(4)} ` +
          `p50=${pick(0.5)!.toFixed(4)} p90=${pick(0.9)!.toFixed(4)} max=${sorted.at(-1)!.toFixed(4)}`,
      );
    }
    console.log(`\n${lines.join('\n')}`);
  }, 900_000);
});
