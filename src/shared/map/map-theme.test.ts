import { describe, expect, it } from 'vitest';
import TOKENS_CSS from '../../styles/tokens.css?raw';
import type { Rgba } from './icon-raster';
import { colorProperty, mapThemePaint } from './map-theme';

const THEME_SELECTOR = {
  day: /:root\s*\{([^}]*)\}/,
  dusk: /:root\[data-theme="dusk"\]\s*\{([^}]*)\}/,
  'night-red': /:root\[data-theme="night-red"\]\s*\{([^}]*)\}/,
} as const;

function tokenValue(theme: keyof typeof THEME_SELECTOR, token: string): string {
  const block = TOKENS_CSS.match(THEME_SELECTOR[theme])?.[1] ?? '';
  const value = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]+)`))?.[1];
  if (!value) throw new Error(`--${token} not found for theme "${theme}" in tokens.css`);
  return value.toLowerCase();
}

describe('mapThemePaint', () => {
  // MapLibre paint properties cannot read a CSS custom property, so map-theme.ts hand-copies
  // --alarm and --select from tokens.css per theme. This guards the two from drifting apart
  // silently, since nothing else catches a retune of one without the other.
  it('mirrors --alarm and --select from tokens.css for each theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const paint = mapThemePaint(theme);
      expect(paint.danger.toLowerCase()).toBe(tokenValue(theme, 'alarm'));
      expect(paint.select.toLowerCase()).toBe(tokenValue(theme, 'select'));
    }
  });

  it('returns a background and water color for each theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const paint = mapThemePaint(theme);
      expect(typeof paint.background).toBe('string');
      expect(typeof paint.water).toBe('string');
    }
  });

  it('night-red uses a black background', () => {
    expect(mapThemePaint('night-red').background).toBe('#000000');
  });

  it('carries an opaque symbol color for the own vessel and AIS in each theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const paint = mapThemePaint(theme);
      expect(paint.ownVessel.a).toBe(0xff);
      expect(paint.aisTarget.a).toBe(0xff);
    }
  });

  it('uses zero blue for the night-red own vessel', () => {
    // The loose b < 0x40 tolerance is what let a pink vessel (b = 0x3a) ship; the contract is a
    // pure red-family tone, so blue is exactly zero.
    const { ownVessel } = mapThemePaint('night-red');
    expect(ownVessel.r).toBeGreaterThan(ownVessel.g);
    expect(ownVessel.b).toBe(0);
  });

  it('keeps the night-red AIS target in the red band, with zero blue and no green spike', () => {
    const { aisTarget } = mapThemePaint('night-red');
    expect(aisTarget.r).toBeGreaterThan(aisTarget.g);
    expect(aisTarget.g).toBeLessThan(0x50);
    expect(aisTarget.b).toBe(0);
  });
});

// WCAG relative luminance and contrast ratio, for asserting the sun variant's luminance spread
// rather than pinning each literal.
function luminance(hex: string): number {
  const channel = (index: number) => {
    const c = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function rgbaHex(c: Rgba): string {
  const pair = (v: number) => v.toString(16).padStart(2, '0');
  return `#${pair(c.r)}${pair(c.g)}${pair(c.b)}`;
}

describe('mapThemePaint sun variant', () => {
  const day = mapThemePaint('day');
  const sun = mapThemePaint('day', 'sun');

  it('keeps theme day, so per-theme overlay colormaps keep working', () => {
    expect(sun.theme).toBe('day');
  });

  it('is day-scoped: the standard variant and the other themes are untouched', () => {
    expect(mapThemePaint('day', 'standard')).toEqual(day);
    expect(mapThemePaint('dusk', 'sun')).toEqual(mapThemePaint('dusk'));
    expect(mapThemePaint('night-red', 'sun')).toEqual(mapThemePaint('night-red'));
  });

  it('still mirrors the day --alarm and --select tokens', () => {
    expect(sun.danger.toLowerCase()).toBe(tokenValue('day', 'alarm'));
    expect(sun.select.toLowerCase()).toBe(tokenValue('day', 'select'));
  });

  it('keeps the raster treatment identical to day, so the legend swatches stay honest', () => {
    expect(sun.rasterSaturation).toBe(day.rasterSaturation);
    expect(sun.rasterBrightnessMax).toBe(day.rasterBrightnessMax);
  });

  it('lightens the ground and deepens the labels', () => {
    expect(luminance(sun.background)).toBeGreaterThan(luminance(day.background));
    expect(luminance(sun.label)).toBeLessThan(luminance(day.label));
  });

  it('raises every stroke and marker hue contrast against its ground', () => {
    const keys = [
      'label',
      'road',
      'boundary',
      'warning',
      'note',
      'tide',
      'waypoint',
      'routeHighlight',
      'navStarboard',
      'navPort',
      'navLight',
      'trackSolid',
      'scrubMarker',
    ] as const;
    for (const key of keys) {
      expect(contrast(sun[key], sun.background)).toBeGreaterThan(
        contrast(day[key], day.background),
      );
    }
  });

  it('widens the water-to-land separation', () => {
    expect(contrast(sun.water, sun.land)).toBeGreaterThan(contrast(day.water, day.land));
  });

  it('deepens the own-vessel and AIS symbols against the water and keeps them opaque', () => {
    expect(contrast(rgbaHex(sun.ownVessel), sun.water)).toBeGreaterThan(
      contrast(rgbaHex(day.ownVessel), day.water),
    );
    expect(contrast(rgbaHex(sun.aisTarget), sun.water)).toBeGreaterThan(
      contrast(rgbaHex(day.aisTarget), day.water),
    );
    expect(sun.ownVessel.a).toBe(0xff);
    expect(sun.aisTarget.a).toBe(0xff);
  });

  it('keeps the own-track ramp dark to light', () => {
    expect(luminance(sun.trackSlow)).toBeLessThan(luminance(sun.trackMid));
    expect(luminance(sun.trackMid)).toBeLessThan(luminance(sun.trackFast));
  });
});

describe('colorProperty', () => {
  it('maps line to line-color', () => {
    expect(colorProperty('line')).toBe('line-color');
  });

  it('maps symbol to text-color', () => {
    expect(colorProperty('symbol')).toBe('text-color');
  });

  it('defaults everything else to fill-color', () => {
    expect(colorProperty('fill')).toBe('fill-color');
    expect(colorProperty('raster')).toBe('fill-color');
  });
});
