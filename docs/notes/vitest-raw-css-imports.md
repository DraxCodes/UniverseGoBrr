# Vitest returns an empty string for `?raw` CSS imports unless `test.css` is true

Written against Vitest 5.1.1 + Vite 8.3.8, Layer 0 "single look" test (2026-11-23).

## Symptom

A test imports a stylesheet as text to assert on it:

```ts
import styles from './styles.css?raw';
expect(styles).toMatch(/color-scheme:\s*dark;/);
```

The module resolves and the import does not throw, but `styles` is `''`. The matcher fails
with `expected '' to match ...`, which looks like the CSS is missing rather than the import
being stubbed.

## Cause

Vitest processes CSS imports through its own pipeline. With `test.css` left at its default
(`false`), CSS imports are replaced with an empty module — including `?raw` queries, because
the CSS plugin claims the `.css` extension before the raw loader sees it.

## What to do instead

Set `test.css: true` in `vitest.config.ts`:

```ts
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], css: true },
});
```

The alternative is to avoid reading CSS from a test (assert on a rendered style instead), but
that needs a DOM environment for what is a one-line source check.

## Related trap in the same file

Do not import `node:fs` in a test under `src/` for this: `tsconfig.json` sets
`"types": ["vite/client", "@webgpu/types"]`, so `node:fs`, `node:path` and `process` fail
`tsc --noEmit` during `npm run build` (TS2591). Vite's `?raw` import and
`import.meta.glob(..., { query: '?raw', import: 'default' })` both work with the existing
config and need no `@types/node`.

`src/look-and-feel.test.ts` uses both patterns as the working example.