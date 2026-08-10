// The one resolved radar display palette per theme: ring lines, ring-label text, the label halo,
// area strokes and fills, and the sweep wedge. The PPI layer consumes only this, so no rendering
// code branches on theme names or hardcodes a display color, and the night-red physics (zero blue,
// bounded green, AA-passing label text) are decided in exactly one place.
export type RadarTheme = 'day' | 'dusk' | 'night-red';

export interface RadarPalette {
  // Range-ring line color: non-text, needs the 3:1 graphics floor over the chart.
  ring: string;
  // Range-ring label text: real text, needs the 4.5:1 AA floor over its halo and the chart.
  ringLabel: string;
  ringLabelHalo: string;
  // Guard-area stroke and fill base.
  area: string;
  // The sweep wedge as shader RGB floats, brighter than the rings so the scanning edge stands out.
  sweep: [number, number, number];
}

const DAY_DUSK: RadarPalette = {
  ring: '#33ff66',
  ringLabel: '#33ff66',
  // A dark halo behind the bright label text keeps it readable over any chart feature.
  ringLabelHalo: 'rgba(0, 0, 0, 0.75)',
  area: '#ff9f1c',
  sweep: [0.4, 1, 0.55],
};

const NIGHT_RED: RadarPalette = {
  // Dim red lines: 3.7:1 on true black, above the graphics floor, below the alarm tier.
  ring: '#d00000',
  // The night text tone (matches the theme --text): 4.6:1 on true black, so the range labels are
  // legible as text rather than borrowing the dim ring red that fails AA.
  ringLabel: '#d44300',
  // The halo is invisible on true black by design; the label carries its own contrast.
  ringLabelHalo: 'rgba(0, 0, 0, 0.75)',
  area: '#d00000',
  sweep: [0.75, 0, 0],
};

export function radarPalette(theme: RadarTheme): RadarPalette {
  return theme === 'night-red' ? NIGHT_RED : DAY_DUSK;
}
