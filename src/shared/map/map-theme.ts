import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Theme } from '$shared/ui';
import type { Rgba } from './icon-raster';

export interface MapThemePaint {
  // The active theme, so an overlay can pick a theme-specific colormap from its applyTheme paint.
  theme: Theme;
  background: string;
  water: string;
  // Vector chart fills and lines, themed so a vector chart recolors with the app.
  land: string;
  landcover: string;
  road: string;
  boundary: string;
  // Base-map text labels (place, road, and water names). Readable on each theme's
  // background; a muted red at night so labels stay in the red band.
  label: string;
  // Collision-highlight rings: danger mirrors the --alarm token per theme, warning is a
  // distinct, less-urgent hue (night-red keeps both in the red band, danger brighter). MapLibre
  // paint cannot read a CSS custom property, so danger is hand-copied from --alarm in
  // src/styles/tokens.css and the two must be retuned in lockstep.
  danger: string;
  warning: string;
  // Point-of-interest (notes) marker fill color.
  note: string;
  // Tide and tidal-current station marker fill: a teal in day and dusk, distinct from the note
  // purple so the two marker kinds never read alike; a distinct red at night.
  tide: string;
  // Standalone waypoint markers: kept apart from the note and tide hues so the marker kinds
  // never read alike on the chart.
  waypoint: string;
  // The glyph drawn on a marker disc: a light contrast in day and dusk, a brighter red
  // at night so it reads on the disc without breaking the pure-red-on-black contract.
  markerGlyph: string;
  // Highlight ring around a selected marker. A distinct accent in day and dusk; at night
  // a light red that stays in the red band yet reads apart from the danger and warning hues.
  // Mirrors the --select token per theme (hand-copied because MapLibre paint cannot read a CSS
  // custom property), so select here and --select in src/styles/tokens.css retune in lockstep.
  select: string;
  // The lit leg of a route under edit: a warmer, more saturated tone than the editing line's select,
  // so the highlighted segment stands out from the line it overlays rather than blending into it.
  // Stays in the red band at night, apart from the danger and warning hues.
  routeHighlight: string;
  // Navaid (lateral mark) fills. IALA red/green in day and dusk; at night both collapse to
  // distinguishable red shades, because night-red forbids green, so the lateral side is read
  // from the symbol shape (cone vs can, triangle vs square) rather than color.
  navStarboard: string;
  navPort: string;
  // Light flare and lighthouse lantern: chart magenta in day and dusk, a light red at night.
  navLight: string;
  // Own-track speed ramp (slow to fast) and the solid-mode track color. Night-red is a
  // dark-to-bright red ramp so the brightest pixel stays low and no blue or green appears.
  trackSlow: string;
  trackMid: string;
  trackFast: string;
  trackSolid: string;
  // The time-travel scrub marker ring. A bright color distinct from the own-vessel and AIS markers
  // in day and dusk, and a red brighter than ownVessel at night so it holds the pure-red-on-black
  // contract. The marker is drawn as a hollow ring, so shape also separates it from the filled icons.
  scrubMarker: string;
  ownVessel: Rgba;
  aisTarget: Rgba;
  // Raster depth and chart layers cannot be recolored, so each theme adjusts them instead: day
  // and dusk show them as served, night-red desaturates and dims them so they carry no blue and
  // keep the brightest pixel low. This is an approximation, not true night-red color.
  rasterSaturation: number;
  rasterBrightnessMax: number;
}

// The base-map color keys a vector chart's source-layer can be themed to. The other color keys
// on MapThemePaint (the label color and the per-overlay feature and track colors) are not
// chart-paintable, so they are intentionally excluded.
export type MapColorKey = 'background' | 'water' | 'land' | 'landcover' | 'road' | 'boundary';

const PAINT: Record<Theme, Omit<MapThemePaint, 'theme'>> = {
  day: {
    // The base map renders land and empty areas as the background layer, so this is the land
    // tone, not a water tone. A warm light neutral (close to the source style's cream) keeps the
    // map from taking on a blue cast once the theme recolor runs over the warm default.
    background: '#f2efe8',
    water: '#a8c9e0',
    land: '#eae6dd',
    landcover: '#d6e6c8',
    road: '#c9c2b6',
    boundary: '#b6a98f',
    label: '#33414c',
    danger: '#a9361a',
    warning: '#e0a020',
    note: '#7a3fa0',
    tide: '#0d8a99',
    waypoint: '#1f6fb0',
    markerGlyph: '#ffffff',
    select: '#ffb300',
    routeHighlight: '#ff7a00',
    navStarboard: '#d8392f',
    navPort: '#1f9e54',
    navLight: '#c026d3',
    trackSlow: '#1a3a5a',
    trackMid: '#2c6da3',
    trackFast: '#6fb1e0',
    trackSolid: '#1f6fb2',
    scrubMarker: '#ff7a18',
    ownVessel: { r: 0x1f, g: 0x6f, b: 0xb2, a: 0xff },
    aisTarget: { r: 0xe0, g: 0xa0, b: 0x20, a: 0xff },
    rasterSaturation: 0,
    rasterBrightnessMax: 1,
  },
  dusk: {
    background: '#0a151f',
    water: '#10212e',
    land: '#16242f',
    landcover: '#152b24',
    road: '#2a3b48',
    boundary: '#3a4d5c',
    label: '#9fb4c6',
    danger: '#e0703a',
    warning: '#d9a441',
    note: '#9a6fc0',
    tide: '#2f9fb0',
    waypoint: '#4f8fc0',
    markerGlyph: '#eef3f6',
    select: '#ffc24d',
    routeHighlight: '#ff9433',
    navStarboard: '#e0573f',
    navPort: '#3fae6a',
    navLight: '#cf5bd9',
    trackSlow: '#22455f',
    trackMid: '#3f87bf',
    trackFast: '#84c0ea',
    trackSolid: '#4f9fd8',
    scrubMarker: '#ff8a3a',
    ownVessel: { r: 0x4f, g: 0x9f, b: 0xd8, a: 0xff },
    aisTarget: { r: 0xd9, g: 0xa4, b: 0x41, a: 0xff },
    rasterSaturation: 0,
    rasterBrightnessMax: 1,
  },
  'night-red': {
    background: '#000000',
    water: '#140400',
    land: '#0c0300',
    landcover: '#0f0400',
    road: '#3a0d00',
    boundary: '#4a1000',
    label: '#9a3c00',
    danger: '#ff6e00',
    warning: '#b03b00',
    note: '#9a2b00',
    tide: '#c24c00',
    waypoint: '#d96d00',
    markerGlyph: '#ff9f00',
    select: '#ff9f00',
    routeHighlight: '#ff8e00',
    navStarboard: '#ff6e00',
    navPort: '#8e2c00',
    navLight: '#c05200',
    trackSlow: '#3a0d00',
    trackMid: '#9a3100',
    trackFast: '#ff6e00',
    trackSolid: '#c84600',
    scrubMarker: '#ff6e00',
    ownVessel: { r: 0xe0, g: 0x47, b: 0x3a, a: 0xff },
    aisTarget: { r: 0xb0, g: 0x2e, b: 0x22, a: 0xff },
    rasterSaturation: -1,
    rasterBrightnessMax: 0.45,
  },
};

export function mapThemePaint(theme: Theme): MapThemePaint {
  return { ...PAINT[theme], theme };
}

// Initial draw colors shared by every overlay that paints before the real saved theme is broadcast:
// the chart adapter and the Seascape depth-chart overlays all draw once with this, then applyTheme
// (or applyRasterTheme) corrects the color once the app's actual theme arrives.
export const DAY_PAINT: MapThemePaint = mapThemePaint('day');

// The color paint property for a fill, line, or symbol layer. The chart adapter and the base-style
// recolor both choose between line-color, fill-color, and text-color, so sharing this keeps the
// spellings from drifting. Anything that is not a line or symbol takes fill-color, matching the
// chart adapter's fill default.
export function colorProperty(type: string): 'line-color' | 'fill-color' | 'text-color' {
  if (type === 'line') return 'line-color';
  if (type === 'symbol') return 'text-color';
  return 'fill-color';
}

// Apply the theme to a raster overlay layer. A raster layer cannot be recolored, so night-red
// desaturates and dims it instead. Shared by the chart, depth-bathymetry, and rain-radar rasters
// so the one treatment is defined once.
// The radar legend's night swatches in features/weather/legend.ts hand-approximate this treatment's
// output, so changing rasterSaturation or rasterBrightnessMax means re-tuning those swatch literals
// or the legend lies about the tiles.
export function applyRasterTheme(map: MapLibreMap, layerId: string, paint: MapThemePaint): void {
  // Guard on getLayer, matching setLayersVisibility: setPaintProperty throws on a layer that is not
  // present, for example a theme change during the window after a base-style reload and before the
  // overlay reattaches. One guard here covers every raster caller.
  if (!map.getLayer(layerId)) return;
  map.setPaintProperty(layerId, 'raster-saturation', paint.rasterSaturation);
  map.setPaintProperty(layerId, 'raster-brightness-max', paint.rasterBrightnessMax);
}
