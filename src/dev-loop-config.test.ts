import { describe, expect, it } from 'vitest';
import config from '../vite.config';

describe('dev server', () => {
  it('never opens tabs', () => {
    expect(config.server?.open).toBe(false);
  });

  it('fails loudly instead of drifting to another port', () => {
    expect(config.server?.strictPort).toBe(true);
    expect(config.server?.port).toBe(5173);
  });

  it('keeps the capture preview on a fixed port too', () => {
    expect(config.preview?.strictPort).toBe(true);
    expect(config.preview?.port).toBe(4173);
  });
});