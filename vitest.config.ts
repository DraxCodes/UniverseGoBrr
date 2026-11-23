import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The "single look" test reads `styles.css?raw`; Vitest empties CSS imports otherwise.
    css: true,
  },
});