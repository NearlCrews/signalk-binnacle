import {
  formatLengthOr,
  formatPercent,
  formatPrecipRateOr,
  formatSpeedOr,
  knotsToMetersPerSecond,
  lengthUnit,
  precipRateUnit,
  speedUnit,
  type UnitsSelection,
} from '$shared/lib';
import type { Theme } from '$shared/ui';
import { cloudColor } from './cloud-colormap';
import { type Rgba, tupleCss } from './color-ramp';
import { WEATHER_LAYER_IDS } from './fills';
import { precipColor } from './precip-colormap';
import { isobarColors } from './pressure-colors';
import { DEFAULT_INTERVAL_HPA } from './pressure-isobars';
import { waveColor } from './wave-colormap';
import { windColor } from './wind-colormap';

interface LegendSwatch {
  color: string;
  label: string;
}

export interface WeatherLegend {
  id: string;
  title: string;
  // A continuous ramp: a CSS gradient with low and high end labels.
  gradient?: string;
  lowLabel?: string;
  highLabel?: string;
  // Or discrete swatches, for the isobar line and the fixed radar palette.
  swatches?: LegendSwatch[];
  // An optional short footnote, for example the radar's resolution limit.
  note?: string;
  // The layer's coverage bound for a region-limited source, so silence outside coverage never
  // reads as an all-clear. Rendered beside the note and never substituted by a live status line.
  coverageNote?: string;
}

// Whole-knot stops (in m/s): sailors think in 10-knot bands, and the old m/s stops rendered as
// "0.0" and "50.5" kn, false precision on model wind.
const WIND_STOPS = [0, 10, 20, 30, 40, 50].map(knotsToMetersPerSecond);
const WAVE_STOPS = [0.5, 1, 2, 4, 6, 9]; // m
const PRECIP_STOPS = [0.2, 1, 2.5, 10, 25, 40]; // mm/h, tops out where the precip colormap does
const CLOUD_STOPS = [0.25, 0.5, 0.75, 1]; // fraction

// Render a colormap stop opaque so the legend ramp is visible even where the field itself is
// translucent or fully transparent at the low end.
function opaque([r, g, b]: Rgba): string {
  return tupleCss([r, g, b, 1]);
}

// A continuous-ramp legend: a left-to-right CSS gradient across the stops, plus the value at each
// end at the display unit.
function rampLegend(
  id: string,
  title: string,
  stops: number[],
  color: (value: number) => Rgba,
  label: (value: number) => string,
): WeatherLegend {
  const min = stops[0];
  const max = stops[stops.length - 1];
  const span = max - min || 1;
  const parts = stops.map((v) => `${opaque(color(v))} ${Math.round(((v - min) / span) * 100)}%`);
  return {
    id,
    title,
    gradient: `linear-gradient(to right, ${parts.join(', ')})`,
    lowLabel: label(min),
    highLabel: label(max),
  };
}

// The legend for a weather layer: a continuous ramp for the field and arrow layers, or discrete
// swatches for the isobars and the radar. The wind, wave, and rain legends follow the preference's
// per-category units. Returns undefined for an unknown layer id.
export function weatherLegend(
  layerId: string,
  theme: Theme,
  units: UnitsSelection,
): WeatherLegend | undefined {
  switch (layerId) {
    case WEATHER_LAYER_IDS.wind:
      return rampLegend(
        layerId,
        `Wind (${speedUnit(units)})`,
        WIND_STOPS,
        (s) => windColor(s, theme),
        (s) => formatSpeedOr(s, units, 0),
      );
    case WEATHER_LAYER_IDS.pressure:
      // Isobars are conventionally hectopascals on every chart, so the isobar legend and the
      // on-map labels stay hPa in either mode; only the pressure readouts convert.
      return {
        id: layerId,
        title: 'Pressure',
        swatches: [
          { color: isobarColors(theme).line, label: `isobars, ${DEFAULT_INTERVAL_HPA} hPa` },
        ],
      };
    case WEATHER_LAYER_IDS.waves:
      return rampLegend(
        layerId,
        `Waves (${lengthUnit(units)})`,
        WAVE_STOPS,
        (h) => waveColor(h, theme),
        // Whole feet: a tenth of a foot on model waves is false precision.
        (h) => formatLengthOr(h, units, lengthUnit(units) === 'ft' ? 0 : 1),
      );
    case WEATHER_LAYER_IDS.precip:
      return rampLegend(
        layerId,
        `Rain (${precipRateUnit(units)})`,
        PRECIP_STOPS,
        (p) => precipColor(p, theme),
        (p) => formatPrecipRateOr(p, units),
      );
    case WEATHER_LAYER_IDS.cloud:
      return rampLegend(
        layerId,
        'Cloud (%)',
        CLOUD_STOPS,
        (c) => cloudColor(c, theme),
        // Whole percent: model cloud fraction has no tenth-percent meaning.
        (c) => formatPercent(c),
      );
    case WEATHER_LAYER_IDS.radar:
      // RainViewer's raster palette is a fixed light-to-intense scale. At night the tiles are
      // desaturated to red (applyRasterTheme), so the legend uses a red-band ramp there to honor the
      // night-red contract rather than showing literal blue and green chips.
      // PINNED to applyRasterTheme in shared/map/map-theme.ts: these night chips hand-approximate
      // that treatment's raster-saturation and raster-brightness-max output, so a change to those
      // paint values must re-tune these literals or the legend lies about the tiles.
      return {
        id: layerId,
        title: 'Rain radar',
        swatches:
          theme === 'night-red'
            ? [
                { color: 'rgb(90, 26, 20)', label: 'light' },
                { color: 'rgb(140, 36, 26)', label: 'moderate' },
                { color: 'rgb(190, 50, 36)', label: 'heavy' },
                { color: 'rgb(240, 80, 60)', label: 'intense' },
              ]
            : [
                { color: 'rgb(120, 160, 230)', label: 'light' },
                { color: 'rgb(60, 170, 90)', label: 'moderate' },
                { color: 'rgb(230, 200, 60)', label: 'heavy' },
                { color: 'rgb(220, 70, 60)', label: 'intense' },
              ],
        // The newest RainViewer frames are model extrapolation, not observation; "live radar"
        // would overstate them.
        note: 'radar with short-term nowcast, regional resolution',
        // RainViewer composites land-based radar, so beyond radar range there is simply no data;
        // without this bound an offshore blank would read as no rain.
        coverageNote: 'land-based radar coverage only; blank offshore means no data, not no rain',
      };
    default:
      return undefined;
  }
}
