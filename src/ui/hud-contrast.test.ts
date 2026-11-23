import { describe, expect, it } from 'vitest';
import styles from '../styles.css?raw';

/**
 * The gate measured the 10 px footer and label text at ~3.3:1 on the HUD panel — legible, but
 * below WCAG AA's 4.5:1 for normal text, and the faintest element on the page. This pins the
 * fix so a later palette tweak cannot quietly undo it.
 *
 * The panel is `--panel` composited over the page background; text sits on the composite, not
 * on either colour alone.
 */

function hex(style: string, name: string): [number, number, number] {
  const match = style.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing hex custom property ${name}`);
  const value = match[1] as string;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgba(style: string, name: string): [number, number, number, number] {
  const match = style.match(
    new RegExp(`${name}:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([\\d.]+)\\s*\\)`),
  );
  if (!match) throw new Error(`Missing rgba custom property ${name}`);
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [light, dark] = luminance(a) > luminance(b) ? [a, b] : [b, a];
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
}

/** The page background behind the panel (body background in styles.css). */
const page = hex(styles, 'background');
const panel = rgba(styles, '--panel');
const composited: [number, number, number] = [
  panel[0] * panel[3] + page[0] * (1 - panel[3]),
  panel[1] * panel[3] + page[1] * (1 - panel[3]),
  panel[2] * panel[3] + page[2] * (1 - panel[3]),
];

describe('HUD text contrast', () => {
  it('keeps the faint text at AA for normal text on the panel', () => {
    expect(contrast(hex(styles, '--ink-faint'), composited)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the three-level hierarchy: ink > ink-dim > ink-faint', () => {
    expect(contrast(hex(styles, '--ink-dim'), composited)).toBeGreaterThan(
      contrast(hex(styles, '--ink-faint'), composited),
    );
    expect(contrast(hex(styles, '--ink'), composited)).toBeGreaterThan(
      contrast(hex(styles, '--ink-dim'), composited),
    );
  });
});