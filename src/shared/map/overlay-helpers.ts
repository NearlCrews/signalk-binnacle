import type {
  AllPaintProperties,
  GeoJSONSource,
  Map as MapLibreMap,
  SourceSpecification,
} from 'maplibre-gl';
import { emptyFeatureCollection } from './feature-collection';

// Add an empty GeoJSON source under `id` when the map does not already hold it: the idle state every
// overlay's add() starts from before its first setData. Idempotent, so a re-add after a base-style
// swap finds the source present and leaves its features in place rather than clearing them.
export function ensureGeoJsonSource(map: MapLibreMap, id: string): void {
  if (!map.getSource(id)) {
    map.addSource(id, { type: 'geojson', data: emptyFeatureCollection() });
  }
}

// The many-source form: guard-add each id. An overlay that owns more than one GeoJSON source (rings
// and labels, vectors and trails) calls this so the loop lives in one place.
export function ensureGeoJsonSources(map: MapLibreMap, ids: readonly string[]): void {
  for (const id of ids) ensureGeoJsonSource(map, id);
}

// Set a GeoJSON source's data, narrowing the source handle in one place: the dozen-odd overlays that
// push fresh features otherwise re-spell the `(map.getSource(id) as GeoJSONSource | undefined)?.setData`
// cast at each site. A no-op when the source is absent (the overlay was removed mid-flight).
export function setSourceData(
  map: MapLibreMap,
  sourceId: string,
  data: GeoJSON.GeoJSON | string,
): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  void source?.setData(data);
}

// The two loops every overlay module's setVisible and remove repeat, shared so the lifecycle
// cannot drift between overlays (a forgotten layer in one loop is an invisible-but-interactive
// or leaked layer).

export function setLayersVisibility(
  map: MapLibreMap,
  layerIds: readonly string[],
  visible: boolean,
): void {
  const value = visible ? 'visible' : 'none';
  for (const id of layerIds) {
    // Guard on getLayer, matching removeLayersAndSources: setLayoutProperty throws on a layer that is
    // not present (for example before add() or after a base-style reload), so a caller can pass its
    // full layer set without tracking which are currently attached.
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', value);
  }
}

// Layers first, then sources: a source cannot be removed while a layer still references it.
export function removeLayersAndSources(
  map: MapLibreMap,
  layerIds: readonly string[],
  sourceIds: readonly string[],
): void {
  for (const id of layerIds) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of sourceIds) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

// Casts a dynamically-computed paint property name and value through MapLibre 6's keyed paint
// types, so callers pass a plain string instead of re-spelling `as keyof AllPaintProperties` /
// `as never` at each call site. Throws exactly as the underlying MapLibre call would (a layer
// lacking the property, or the style not yet loaded); a caller that needs to skip such layers
// still wraps this in its own try/catch, same as before.
export function setPaintProp(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  // Guarded: setPaintProperty throws on an absent layer, and one throw inside a recolor pass
  // aborts the theme for every later overlay, so the safe form is the only form.
  if (!map.getLayer(layerId)) return;
  map.setPaintProperty(layerId, property as keyof AllPaintProperties, value as never);
}

export function getPaintProp(map: MapLibreMap, layerId: string, property: string): unknown {
  return map.getPaintProperty(layerId, property as keyof AllPaintProperties);
}

// Guard-add a source only if absent, so two OverlayModules that share one MapLibre source can
// both call this from their own add() without caring which one runs first.
export function ensureSource(map: MapLibreMap, sourceId: string, spec: SourceSpecification): void {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, spec);
  }
}

// Remove a shared source only once every sibling layer that still depends on it is gone, so two
// OverlayModules sharing one source can each guard-remove it from their own remove() in any order
// without one deleting the source out from under the other.
export function removeSharedSourceIfOrphaned(
  map: MapLibreMap,
  sourceId: string,
  siblingLayerIds: readonly string[],
): void {
  if (siblingLayerIds.every((id) => !map.getLayer(id)) && map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

// The one interaction gate every optional-tap overlay spells: interactive only while visible,
// not fully transparent, and allowed by the app-level gate (measure mode, chart edits) when the
// overlay declares one.
export function overlayInteractive(
  visible: boolean,
  opacity: number,
  allowed?: () => boolean,
): boolean {
  return visible && opacity > 0 && (allowed?.() ?? true);
}
