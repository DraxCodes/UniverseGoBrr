import { describe, expect, it } from 'vitest';
import styles from './styles.css?raw';
import html from '../index.html?raw';
import seamRaw from '../.opencode/workflow.json?raw';

/**
 * This project has one look, and it is dark (ADR-0007). A universe is dark by nature: the
 * light in a frame comes from suns, emission nebulae and supernovae, never from a light UI
 * surface. There is no theme switch, no `prefers-color-scheme` branch, and no light variant
 * to keep in sync. These tests fail if a second look is reintroduced by accident.
 *
 * Files are read through Vite's `?raw` imports rather than `node:fs`, so the check runs in
 * the same module graph as the app and needs no Node type definitions.
 *
 * Two independent checks run, because each covers the other's blind spot:
 *   1. a broad term scan over every app source, with comments removed so prose can discuss
 *      the rule without tripping it;
 *   2. a structural scan over the *raw* text for the two constructs that can actually branch
 *      on the preference. Comment stripping cannot hide those from this one.
 */
const sources = import.meta.glob<string>('./**/*.{css,ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const appFiles: Array<[string, string]> = [
  ['index.html', html],
  ...Object.entries(sources).filter(([file]) => !file.endsWith('.test.ts')),
];

/** Comments may discuss the rule; only live code can break it. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The constructs that can actually select a second look, matched on raw text. */
const LIVE_BRANCH = [
  /@media[^{}]*prefers-color-scheme/i,
  /@import[^;]*\(prefers-color-scheme/i,
  /matchMedia\(\s*['"`]?\(prefers-color-scheme/i,
];

describe('single look', () => {
  it('declares color-scheme dark to the browser', () => {
    expect(html).toContain('<meta name="color-scheme" content="dark" />');
  });

  it('declares color-scheme dark in the stylesheet', () => {
    expect(styles).toMatch(/color-scheme:\s*dark;/);
  });

  it('has no prefers-color-scheme branch in any app module, stylesheet or index.html', () => {
    const offenders = appFiles
      .filter(([, source]) => /prefers-color-scheme/.test(stripComments(source)))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it('has no structural prefers-color-scheme branch, comments or not', () => {
    const offenders = appFiles
      .filter(([, source]) => LIVE_BRANCH.some((pattern) => pattern.test(source)))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it('keeps exactly one theme in the seam', () => {
    const seam = JSON.parse(seamRaw) as { verify?: { themes?: string[] } };
    expect(seam.verify?.themes).toEqual(['dark']);
  });
});