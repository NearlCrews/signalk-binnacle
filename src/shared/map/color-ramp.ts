// Derives a multi-stop bathymetric depth-tint gradient from a theme's flat water and land tones,
// so a color-relief layer reuses the existing per-theme tokens instead of adding dedicated ones. A
// literal two-stop interpolate across the full -10000 to 0 m elevation domain puts the 0 to -200 m
// shelf, the depth band a cruiser actually navigates, under two percent of the ramp's span, reading
// as a flat wash inshore; these nonlinear stops concentrate the visible gradient near zero instead.

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// Expects a 6-digit #rrggbb hex string, matching this codebase's theme tokens.
function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;
}

// A positive ratio mixes toward white (lightens); a negative ratio mixes toward black (darkens); a
// ratio of 1 or -1 reaches pure white or black. Zero returns the input color unchanged.
export function shadeColor(hex: string, ratio: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number): number =>
    ratio >= 0 ? channel + (255 - channel) * ratio : channel + channel * ratio;
  return rgbToHex(mix(r), mix(g), mix(b));
}

// The elevation stops for a color-relief `color-relief-color` interpolate expression, deepest first:
// darkest offshore, graduating through the theme's water tone near the shelf, to the theme's land
// tone at and above 0 m elevation. Returned as a flat [elevation, color, elevation, color, ...] array,
// spread directly after ['elevation'] in the interpolate expression.
export function depthShadingStops(waterHex: string, landHex: string): (number | string)[] {
  return [
    -10000,
    shadeColor(waterHex, -0.6),
    -1000,
    shadeColor(waterHex, -0.35),
    -200,
    shadeColor(waterHex, -0.15),
    -50,
    waterHex,
    -20,
    shadeColor(waterHex, 0.15),
    -5,
    shadeColor(waterHex, 0.35),
    -0.01,
    shadeColor(waterHex, 0.55),
    0,
    landHex,
  ];
}
