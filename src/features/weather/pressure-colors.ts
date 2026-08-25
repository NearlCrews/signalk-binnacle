import type { Theme } from '$shared/ui';

interface IsobarColors {
  line: string;
  label: string;
  halo: string;
}

// Isobars are a single line color per theme (not a ramp). Day and dusk use a muted slate so the
// lines read over land and water without competing with the wind colors. Night-red is pure red on
// black: no blue, low brightness, with a dark halo so labels stay legible.
const COLORS: Record<Theme, IsobarColors> = {
  day: {
    line: 'rgba(70, 90, 110, 0.85)',
    label: 'rgba(40, 55, 70, 1)',
    halo: 'rgba(255, 255, 255, 0.9)',
  },
  dusk: {
    line: 'rgba(150, 165, 185, 0.8)',
    label: 'rgba(205, 215, 230, 1)',
    halo: 'rgba(10, 14, 22, 0.9)',
  },
  'night-red': {
    line: 'rgba(150, 30, 22, 0.85)',
    label: 'rgba(190, 40, 28, 1)',
    halo: 'rgba(0, 0, 0, 0.95)',
  },
};

export function isobarColors(theme: Theme): IsobarColors {
  return COLORS[theme];
}
