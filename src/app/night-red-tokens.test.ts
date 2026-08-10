import { describe, expect, it } from 'vitest';
import css from '../styles/tokens.css?raw';

// Pins the night-red palette's physical contract: zero blue in every app-owned token, green
// bounded to what the WCAG floors require, and the contrast floors themselves. A retune that
// drifts any of these fails here instead of silently eroding night vision or legibility.

function nightRedBlock(): string {
  const start = css.indexOf(':root[data-theme="night-red"]');
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf('}', css.indexOf('--scrim', start));
  return css.slice(start, end);
}

function tokenHex(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`night-red block has no plain hex for ${name}`);
  return match[1].toLowerCase();
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const TOKEN_NAMES = [
  '--surface',
  '--surface-raised',
  '--surface-overlay',
  '--border',
  '--text',
  '--text-muted',
  '--accent',
  '--accent-contrast',
  '--select',
  '--ok',
  '--alarm',
  '--warning',
];

describe('night-red tokens', () => {
  const block = nightRedBlock();

  it('carries zero blue in every app-owned color token', () => {
    for (const name of TOKEN_NAMES) {
      const [, , blue] = channels(tokenHex(block, name));
      expect(blue, `${name} must have a zero blue channel`).toBe(0);
    }
  });

  it('bounds green to the brightness roles that need it', () => {
    // The highlight tier is the only token allowed past a red-orange mix, because its role is to
    // be the brightest non-alarm color; everything else stays under a 0.5 green-to-red ratio.
    for (const name of TOKEN_NAMES) {
      const [red, green] = channels(tokenHex(block, name));
      if (red === 0) continue;
      const bound = name === '--select' ? 0.65 : 0.5;
      expect(green / red, `${name} green-to-red ratio`).toBeLessThanOrEqual(bound);
    }
  });

  it('holds the WCAG floors on every night surface', () => {
    const surfaces = ['--surface', '--surface-raised', '--surface-overlay'].map((name) =>
      tokenHex(block, name),
    );
    for (const surface of surfaces) {
      for (const name of ['--text', '--text-muted', '--accent', '--alarm', '--warning']) {
        expect(
          contrast(tokenHex(block, name), surface),
          `${name} AA text contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast(tokenHex(block, '--ok'), surface),
        '--ok non-text contrast',
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the alarm tiers separable by brightness alone', () => {
    const select = luminance(tokenHex(block, '--select'));
    const alarm = luminance(tokenHex(block, '--alarm'));
    const warning = luminance(tokenHex(block, '--warning'));
    expect(select).toBeGreaterThan(alarm * 1.15);
    expect(alarm).toBeGreaterThan(warning * 1.3);
  });
});
