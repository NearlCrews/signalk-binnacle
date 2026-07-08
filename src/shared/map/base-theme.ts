import type { AllPaintProperties, Map as MapLibreMap } from 'maplibre-gl';
import { CHART_SOURCE_PREFIX } from './chart-adapter';
import { colorProperty, type MapThemePaint } from './map-theme';
import { RASTER_ID_PREFIX } from './raster-overlay';

// The base map is the OpenFreeMap "liberty" style (OpenMapTiles schema). Its default
// palette is a light day theme, so on dusk and night-red the roads stayed white and the
// landcover green. We recolor it per theme from each layer's source-layer, which is a far
// more stable key than the individual layer ids.

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
  if (layer.type === 'background') return { property: 'background-color', color: paint.background };
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
      map.setPaintProperty(layer.id, themed.property as keyof AllPaintProperties, themed.color as never);
      // fill-pattern is a paint property in MapLibre, not a layout one; clearing it lets the
      // flat themed color show through the wetland hatch and paved-area textures.
      if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-pattern', undefined);
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
// sprite icon, so hide every base icon at night-red to keep the map pure red on black, while leaving
// the text labels (already recolored) visible. Other themes show the icons normally.
// Accepts a precomputed layer list (same contract as applyBaseTheme).
export function applyBaseIconVisibility(
  map: MapLibreMap,
  paint: MapThemePaint,
  layers?: BaseLayer[],
): void {
  const opacity = paint.theme === 'night-red' ? 0 : 1;
  // Overlay-owned symbol layers (own vessel, AIS, notes) theme themselves and carry user-set
  // opacity, so themableBaseLayers excludes them: they must never be hidden here or forced back to 1.
  for (const layer of layers ?? themableBaseLayers(map)) {
    if (layer.type !== 'symbol' || !layer.layout?.['icon-image']) continue;
    try {
      map.setPaintProperty(layer.id, 'icon-opacity', opacity);
    } catch {
      // A symbol layer that does not actually paint an icon is fine; skip it.
    }
  }
}

// The source style's own paint, captured per base layer so the day theme can restore the real
// map colors exactly rather than approximate them. Each entry keeps the property the theme would
// recolor, its original color, the original text-halo (labels), and whether a fill pattern was
// present. Capture once before the first recolor, while the layers still hold their source paint.
export type BaseSnapshot = Array<{
  id: string;
  property: string;
  color: unknown;
  halo?: unknown;
  pattern?: unknown;
  isFill?: boolean;
  isSymbol?: boolean;
}>;

// Accepts a precomputed layer list (same contract as applyBaseTheme).
export function captureBaseTheme(
  map: MapLibreMap,
  paint: MapThemePaint,
  layers?: BaseLayer[],
): BaseSnapshot {
  const snapshot: BaseSnapshot = [];
  for (const layer of layers ?? themableBaseLayers(map)) {
    const themed = baseLayerPaint(layer, paint);
    if (!themed) continue;
    const isFill = layer.type === 'fill';
    // Capture the themed color first and on its own; a failure reading an optional field (halo,
    // pattern) must never drop the whole entry, or the day theme cannot restore that layer.
    let color: unknown;
    try {
      color = map.getPaintProperty(layer.id, themed.property as keyof AllPaintProperties);
    } catch {
      continue;
    }
    const isSymbol = layer.type === 'symbol';
    const entry: BaseSnapshot[number] = {
      id: layer.id,
      property: themed.property,
      color,
      isFill,
      isSymbol,
    };
    if (isSymbol) {
      // Capture the source halo even when it is absent (undefined): the theme adds a halo to
      // every label, so the restore must put back exactly what was there, including nothing.
      try {
        entry.halo = map.getPaintProperty(layer.id, 'text-halo-color');
      } catch {
        // No halo to read; restore resets it to the style default either way.
      }
    }
    if (isFill) {
      // fill-pattern is a paint property in MapLibre, not a layout one.
      try {
        entry.pattern = map.getPaintProperty(layer.id, 'fill-pattern');
      } catch {
        // No pattern on this fill; restore clears it to undefined either way.
      }
    }
    snapshot.push(entry);
  }
  return snapshot;
}

// Restore the source style's captured colors, halos, and fill patterns, so the day theme shows
// the real map instead of the recolor approximation.
export function restoreBaseTheme(map: MapLibreMap, snapshot: BaseSnapshot): void {
  for (const entry of snapshot) {
    try {
      map.setPaintProperty(entry.id, entry.property as keyof AllPaintProperties, entry.color as never);
      // Restore the label halo for every symbol, including back to undefined (the style default),
      // so the theme's added halo does not linger as a dark outline on the day map.
      if (entry.isSymbol) map.setPaintProperty(entry.id, 'text-halo-color', entry.halo as never);
      // fill-pattern is a paint property in MapLibre; restoring it (often undefined) brings back
      // the source style's hatch where the recolor had cleared it.
      if (entry.isFill) map.setPaintProperty(entry.id, 'fill-pattern', entry.pattern as never);
    } catch {
      // A layer that no longer exists or lacks the property is fine; skip it.
    }
  }
}
