import { clampInt } from '$shared/lib';

// Derives a multi-stop bathymetric depth-tint gradient from a theme's flat water and land tones,
// so a color-relief layer reuses the existing per-theme tokens instead of adding dedicated ones. A
// literal two-stop interpolate across the full -10000 to 0 m elevation domain puts the 0 to -200 m
// shelf, the depth band a cruiser actually navigates, under two percent of the ramp's span, reading
// as a flat wash inshore; these nonlinear stops concentrate the visible gradient near zero instead.

// Expects a 6-digit #rrggbb hex string, matching this codebase's theme tokens.
function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clampInt(c, 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

// A positive ratio mixes a channel toward white (lightens); a negative ratio mixes toward black
// (darkens); a ratio of 1 or -1 reaches pure white or black. Zero returns the channel unchanged.
function mixChannel(channel: number, ratio: number): number {
  return ratio >= 0 ? channel + (255 - channel) * ratio : channel + channel * ratio;
}

// A positive ratio mixes toward white (lightens); a negative ratio mixes toward black (darkens); a
// ratio of 1 or -1 reaches pure white or black. Zero returns the input color unchanged.
export function shadeColor(hex: string, ratio: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(mixChannel(r, ratio), mixChannel(g, ratio), mixChannel(b, ratio));
}

// The elevation stops for a color-relief `color-relief-color` interpolate expression, deepest first:
// darkest offshore, graduating through the theme's water tone near the shelf, to the theme's land
// tone at and above 0 m elevation. Returned as a flat [elevation, color, elevation, color, ...] array,
// spread directly after ['elevation'] in the interpolate expression. Decodes waterHex to its [r, g, b]
// tuple once, since every stop below shades the same water color at a different ratio.
export function depthShadingStops(waterHex: string, landHex: string): (number | string)[] {
  const [r, g, b] = hexToRgb(waterHex);
  const shadeWater = (ratio: number): string =>
    rgbToHex(mixChannel(r, ratio), mixChannel(g, ratio), mixChannel(b, ratio));
  return [
    -10000,
    shadeWater(-0.6),
    -1000,
    shadeWater(-0.35),
    -200,
    shadeWater(-0.15),
    -50,
    waterHex,
    -20,
    shadeWater(0.15),
    -5,
    shadeWater(0.35),
    -0.01,
    shadeWater(0.55),
    0,
    landHex,
  ];
}
