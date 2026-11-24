import { describe, expect, it } from 'vitest';
import styles from './styles.css?raw';
import html from '../index.html?raw';
import status from '../public/status.html?raw';

/**
 * `public/status.html` is the owner's one-screen build dashboard, linked from the HUD. It is a
 * *handoff* surface, so the failure that matters is silent: a link that 404s, a table row that lost
 * a cell, or a page that quietly became a second look.
 *
 * These are structural checks only. The content is the owner's to edit and this test has no
 * opinion on whether a task is marked done - that judgement lives in `docs/issues/status.md`.
 */

/** `.hud` disables pointer events so the canvas keeps every gesture; the link has to opt back in. */
function isHudPointerEventsNone(): boolean {
  const rule = styles.match(/\.hud\s*\{([^}]*)\}/)?.[1] ?? '';
  return /pointer-events:\s*none/.test(rule);
}

describe('the status page the HUD links to', () => {
  it('targets a page that actually ships', () => {
    // `public/` is copied verbatim into `dist/`, so the href must name a real file there. A broken
    // href in a dev HUD is easy to miss: the link renders, nothing throws, and it 404s only when
    // someone clicks it.
    const href = html.match(/class="hud__status"[^>]*href="([^"]+)"/)?.[1];
    expect(href).toBe('/status.html');
  });

  it('gives the HUD link pointer events, or it cannot be clicked', () => {
    // `.hud` is `pointer-events: none` so the canvas keeps every gesture. Without an opt-back-in the
    // link renders and looks live while every click passes through to the scene - the worst kind of
    // broken, because it looks deliberate.
    expect(isHudPointerEventsNone()).toBe(true);
    const rule = styles.match(/\.hud__status\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/pointer-events:\s*auto/);
  });

  it('keeps every table row at three cells', () => {
    // Layer, task, status. A row that gained or lost a cell shifts the status column under the wrong
    // heading, which reads as a wrong claim rather than a layout bug.
    const rows = [...status.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1] ?? '');
    const bodyRows = rows.filter((row) => !row.includes('<th'));
    expect(bodyRows.length).toBeGreaterThan(6);
    for (const row of bodyRows) {
      expect((row.match(/<td/g) ?? []).length).toBe(3);
    }
  });

  it('does not branch on prefers-color-scheme', () => {
    // The one-look rule (ADR-0007) covers everything that ships. This page defines its own palette,
    // so it is the one place a light variant could grow without touching the app's stylesheet.
    expect(status).not.toMatch(/prefers-color-scheme/i);
    expect(status).toContain('<meta name="color-scheme" content="dark" />');
  });

  it('names the record it is a summary of', () => {
    // The page is disposable; the docs are the record. If the page ever stops saying so, the next
    // session will edit it as though it were authoritative.
    expect(status).toContain('docs/issues/status.md');
    expect(status).toContain('spec.md');
  });
});
