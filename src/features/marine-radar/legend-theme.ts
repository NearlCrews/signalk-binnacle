import { forEachLegendByte, hexToRgba, legendColorTable } from './legend';
import type { LegendEntry } from './radar-types';

// A legend entry whose label marks it as a Doppler or history/trail code keeps its accent color through
// theming, so approaching, receding, and trail returns stay distinguishable instead of flattening into
// the ramp (the night-red "alarms always distinguishable" rule).
function isAccent(label: string): boolean {
  const l = label.toLowerCase();
  return (
    l.includes('doppler') ||
    l.includes('approach') ||
    l.includes('reced') ||
    l.includes('history') ||
    l.includes('trail')
  );
}

// Theme the legend table for one coherent design system. Normal returns map onto the theme ramp:
// night-red keeps red on true black with green and blue zeroed so the brightest pixel stays low, dusk
// dims, day passes through. Accent codes (Doppler, history) are preserved. Fills and themes in one
// forEachLegendByte pass, so each sample value is visited once per theme change.
export function themedColorTable(
  legend: LegendEntry[],
  theme: 'day' | 'dusk' | 'night-red',
): Uint8Array {
  if (theme === 'day') return legendColorTable(legend);
  const table = new Uint8Array(256 * 4);
  forEachLegendByte(legend, (v, entry) => {
    const [r, g, b, a] = hexToRgba(entry.color, 255);
    const o = v * 4;
    table[o + 3] = v === 0 ? 0 : a;
    if (v === 0) {
      table[o] = r;
      table[o + 1] = g;
      table[o + 2] = b;
    } else if (theme === 'night-red') {
      // Night-red is a hard color-space boundary. Accent returns stay distinguishable through red
      // intensity, but never retain green or blue pixels.
      const intensity = Math.max(r, g, b);
      table[o] =
        isAccent(entry.label) && r < Math.max(g, b)
          ? Math.max(96, Math.round(intensity * 0.75))
          : intensity;
      table[o + 1] = 0;
      table[o + 2] = 0;
    } else if (isAccent(entry.label)) {
      table[o] = r;
      table[o + 1] = g;
      table[o + 2] = b;
    } else {
      table[o] = Math.round(r * 0.7);
      table[o + 1] = Math.round(g * 0.7);
      table[o + 2] = Math.round(b * 0.7);
    }
  });
  return table;
}
