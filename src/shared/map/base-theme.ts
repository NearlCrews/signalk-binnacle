import type { Map as MapLibreMap } from 'maplibre-gl';
import { FALLBACK_WATER_LAYER_ID } from './base-style';
import { CHART_SOURCE_PREFIX } from './chart-adapter';
import { colorProperty, type MapThemePaint } from './map-theme';
import { setPaintProp } from './overlay-helpers';
import { RASTER_ID_PREFIX } from './raster-overlay';

// The base map is the OpenFreeMap "liberty" style (OpenMapTiles schema). Every theme recolors it
// from each layer's source-layer, which is a far more stable key than the individual layer ids: day
// as a paper chart, dusk and night-red as dark charts.

// Every binnacle-owned overlay layer id starts with this, so the base recolor can tell them apart
// from the base-style layers it may touch. Shared with the overlay id builders.
const BINNACLE_ID_PREFIX = 'binnacle-';

// A layer whose id starts with one of these is owned by an overlay (the chart, every hosted-raster
// overlay, and every binnacle overlay theme their own layers via the layer manager), so the base
// recolor leaves them alone. RASTER_ID_PREFIX is shared with the raster-overlay factory.
const MANAGED_PREFIXES = [CHART_SOURCE_PREFIX, BINNACLE_ID_PREFIX, RASTER_ID_PREFIX];

export interface BaseLayer {
  id: string;
  type: string;
  'source-layer'?: string;
  layout?: { 'icon-image'?: unknown };
}

// The base style's layers, or an empty list if the style is not ready. getStyle throws before the
// style loads; every base-theme pass guards it the same way, so the guard lives here once.
function baseLayers(map: MapLibreMap): BaseLayer[] {
  try {
    return (map.getStyle().layers ?? []) as BaseLayer[];
  } catch {
    return [];
  }
}

// The base-style layers the theme may touch: every base layer except those an overlay owns (the
// chart, hosted rasters, and binnacle overlays theme their own). Shared by the recolor, the
// icon-visibility pass, and the source-paint capture so the skip-managed rule lives in one place.
export function themableBaseLayers(map: MapLibreMap): BaseLayer[] {
  return baseLayers(map).filter(
    (layer) => !MANAGED_PREFIXES.some((prefix) => layer.id.startsWith(prefix)),
  );
}

function paintProperty(type: string): string | null {
  if (type === 'fill' || type === 'line') return colorProperty(type);
  if (type === 'fill-extrusion') return 'fill-extrusion-color';
  return null;
}

function sourceColor(
  sourceLayer: string | undefined,
  type: string,
  paint: MapThemePaint,
): string | null {
  switch (sourceLayer) {
    case 'water':
    case 'waterway':
      return paint.water;
    case 'park':
    case 'landcover':
      return paint.landcover;
    case 'landuse':
    case 'building':
      return paint.land;
    case 'boundary':
      return paint.boundary;
    // The low-zoom worldwide landcover source-layer (distinct from landcover); unmapped it kept
    // its source greens through the night recolor at ocean-crossing zooms.
    case 'globallandcover':
      return paint.landcover;
    case 'transportation':
      return paint.road;
    // Aeroway aprons read as land; runways and taxiways read as roads.
    case 'aeroway':
      return type === 'line' ? paint.road : paint.land;
    default:
      return null;
  }
}

// The paint property and color a base-map layer should take for the theme, or null to
// leave it untouched (raster, unknown source layers). Pure, so it is unit-testable.
export function baseLayerPaint(
  layer: BaseLayer,
  paint: MapThemePaint,
): { property: string; color: string } | null {
  if (layer.type === 'background')
    return {
      property: 'background-color',
      color: layer.id === FALLBACK_WATER_LAYER_ID ? paint.water : paint.background,
    };
  // Every text label (place, road, water names) takes the theme label color.
  if (layer.type === 'symbol') return { property: 'text-color', color: paint.label };
  const property = paintProperty(layer.type);
  if (!property) return null;
  const color = sourceColor(layer['source-layer'], layer.type, paint);
  return color ? { property, color } : null;
}

// Recolor the whole base style for the theme. Skips overlay-owned layers, sets the themed
// color, clears any fill pattern (the wetland hatch, paved-area texture) so the flat color
// shows, and gives label text a background-colored halo for contrast on every theme.
// Accepts a precomputed layer list to avoid refiltering the style when the caller already
// has one; omit it and the function computes it internally.
export function applyBaseTheme(map: MapLibreMap, paint: MapThemePaint, layers?: BaseLayer[]): void {
  for (const layer of layers ?? themableBaseLayers(map)) {
    const themed = baseLayerPaint(layer, paint);
    if (!themed) continue;
    try {
      setPaintProp(map, layer.id, themed.property, themed.color);
      if (layer.type === 'fill') {
        // fill-pattern is a paint property in MapLibre, not a layout one; clearing it lets the
        // flat themed color show through the wetland hatch and paved-area textures.
        map.setPaintProperty(layer.id, 'fill-pattern', undefined);
        // An explicit fill-outline-color (park and reserve outlines are green in the source
        // style) survives a fill-color recolor on its own; align it with the themed fill so no
        // source hue outlines the night map.
        map.setPaintProperty(layer.id, 'fill-outline-color', themed.color);
      }
      if (layer.type === 'symbol')
        map.setPaintProperty(layer.id, 'text-halo-color', paint.background);
    } catch {
      // A layer without this property is fine; skip it.
    }
  }
}

// The base style's sprite icons (POI dots, road and transit shields, aerodrome marks) are pre-colored
// in the published sprite, so the source-layer recolor never reaches them and they keep their original
// blues, greens, and whites. Binnacle draws its own navigation symbols and does not rely on any base
// sprite icon, so hide every base icon at night-red to keep the map pure red on black, and fade them
// at dusk, where a pure-white highway shield is otherwise the brightest element on the dark chart.
// The text labels (already recolored) stay visible. Circle layers (POI dots) are pre-colored the
// same way with no recolorable sprite, so they follow the night hide too.
// Accepts a precomputed layer list (same contract as applyBaseTheme).
// How much of the base style's own icon and label art each theme keeps. Night-red hides it: the
// sprite is full-color and cannot be recolored, so any of it on screen breaks dark adaptation.
// Dusk dims it rather than hiding it, since the chart is still being read by eye.
const BASE_ICON_OPACITY: Partial<Record<MapThemePaint['theme'], number>> = {
  'night-red': 0,
  dusk: 0.4,
};

export function applyBaseIconVisibility(
  map: MapLibreMap,
  paint: MapThemePaint,
  layers?: BaseLayer[],
): void {
  const opacity = BASE_ICON_OPACITY[paint.theme] ?? 1;
  const circleOpacity = paint.theme === 'night-red' ? 0 : 1;
  // Overlay-owned symbol layers (own vessel, AIS, notes) theme themselves and carry user-set
  // opacity, so themableBaseLayers excludes them: they must never be hidden here or forced back to 1.
  for (const layer of layers ?? themableBaseLayers(map)) {
    if (layer.type === 'circle') {
      try {
        map.setPaintProperty(layer.id, 'circle-opacity', circleOpacity);
        map.setPaintProperty(layer.id, 'circle-stroke-opacity', circleOpacity);
      } catch {
        // A circle layer without these properties is fine; skip it.
      }
      continue;
    }
    if (layer.type !== 'symbol' || !layer.layout?.['icon-image']) continue;
    try {
      map.setPaintProperty(layer.id, 'icon-opacity', opacity);
    } catch {
      // A symbol layer that does not actually paint an icon is fine; skip it.
    }
  }
}

// The base style's raster layers (Natural Earth's shaded relief, visible at low zoom) have no single
// recolor, so each theme carries its own treatment: dimmed and grayed by day, as served at dusk and
// in the sun variant, hidden at night-red to keep the map pure red on black.
// Accepts a precomputed layer list (same contract as applyBaseTheme).
export function applyBaseRasterVisibility(
  map: MapLibreMap,
  paint: MapThemePaint,
  layers?: BaseLayer[],
): void {
  for (const layer of layers ?? themableBaseLayers(map)) {
    if (layer.type !== 'raster') continue;
    try {
      map.setPaintProperty(layer.id, 'raster-opacity', paint.reliefOpacity);
      map.setPaintProperty(layer.id, 'raster-saturation', paint.reliefSaturation);
    } catch {
      // A raster layer without these properties is fine; skip it.
    }
  }
}
