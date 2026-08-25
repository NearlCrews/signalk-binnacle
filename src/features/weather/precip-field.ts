import type { TimeBracket, WeatherGrid } from '$entities/weather';
import type { Theme } from '$shared/ui';
import { type FieldBitmap, fieldRgba } from './field-rgba';
import { precipColor } from './precip-colormap';

// The precipitation field bitmap: the shared field builder bound to the grid's precipitation and the
// precipitation colormap for the theme.
export function precipFieldRgba(
  grid: WeatherGrid,
  bracket: TimeBracket,
  theme: Theme,
): FieldBitmap | undefined {
  // Step precipitation reads the lower bracket only, never blended toward the next step. The same
  // rule is enforced independently for the readout in weather-readout.ts's precipitationMm field.
  const effective =
    grid.precipitationInterpolation === 'step'
      ? { lo: bracket.lo, hi: bracket.lo, frac: 0 }
      : bracket;
  return fieldRgba(grid, grid.precipitation, effective, (v) => precipColor(v, theme));
}
