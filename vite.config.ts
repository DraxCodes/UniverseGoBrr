import { defineConfig } from 'vite';

// `open: false` and `strictPort: true` are deliberate: a dev-server restart must never
// open another tab, and a busy port must fail loudly instead of drifting to a new URL.
// See docs/notes/vite-multiple-tabs.md.
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
});