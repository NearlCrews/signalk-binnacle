import type { GeoJSONSourceDiff } from 'maplibre-gl';
import { vi } from 'vitest';
import type { OverlayContext } from '$shared/map';

// Test-only fake MapLibre map covering the source, layer, and image surface the
// overlays use. Imported by *.test.ts files, never by production code.
type FakeSource = {
  setData?: (data: unknown) => void;
  setCoordinates?: (coordinates: unknown) => void;
  setTiles?: (tiles: unknown) => void;
  updateData?: (diff: GeoJSONSourceDiff) => void;
  data: unknown;
  maxzoom?: number;
  tiles?: unknown;
};

// The fields addSource reads, plus the three an assertion reads back off a declared spec. Closed
// rather than an open index signature, so a misspelled field fails at type-check instead of
// resolving to unknown and failing later with a confusing runtime message.
type SourceSpec = {
  type?: string;
  data?: unknown;
  tiles?: unknown;
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
  bounds?: unknown;
  promoteId?: string;
};

// What setFeatureState addresses: real MapLibre also takes sourceLayer, which no overlay uses.
type FeatureStateTarget = { source: string; id?: string | number };

// Applies a GeoJSONSourceDiff to a fake geojson source's FeatureCollection, in the real order
// (removeAll, remove, add, update) with add replacing a same-id feature, so a test asserting the
// resulting features exercises the same end state a browser would render.
function applyGeoJsonDiff(
  data: GeoJSON.FeatureCollection,
  diff: GeoJSONSourceDiff,
  promoteId: string | undefined,
): GeoJSON.FeatureCollection {
  const idOf = (feature: GeoJSON.Feature): unknown =>
    promoteId ? feature.properties?.[promoteId] : feature.id;
  let features = diff.removeAll ? [] : data.features;
  if (diff.remove?.length || diff.add?.length) {
    const gone = new Set<unknown>(diff.remove ?? []);
    for (const feature of diff.add ?? []) gone.add(idOf(feature));
    features = features.filter((feature) => !gone.has(idOf(feature)));
    if (diff.add) features = features.concat(diff.add);
  }
  if (diff.update?.length) {
    const updates = new Map(diff.update.map((update) => [update.id as unknown, update]));
    features = features.map((feature) => {
      const update = updates.get(idOf(feature));
      if (!update) return feature;
      const properties = update.removeAllProperties ? {} : { ...(feature.properties ?? {}) };
      for (const key of update.removeProperties ?? []) delete properties[key];
      for (const { key, value } of update.addOrUpdateProperties ?? []) properties[key] = value;
      return {
        ...feature,
        geometry: update.newGeometry ?? feature.geometry,
        properties,
      };
    });
  }
  return { type: 'FeatureCollection', features };
}

export function createFakeMap() {
  const sources = new Map<string, FakeSource>();
  // What the overlay passed to addSource, kept beside the runtime source below for the reason the
  // addSource comment gives: only this records whether a declared value reached the map at all.
  const declaredSources = new Map<string, SourceSpec>();
  const layers = new Map<string, Record<string, unknown>>();
  const images = new Set<string>();
  const updatedImages: string[] = [];
  const renderedFeatures: GeoJSON.Feature[] = [];
  let dragPanEnabled = true;
  // A source is not loaded until its tiles arrive, as in real MapLibre; markSourceLoaded plus an
  // emitted 'sourcedata' event let a test drive the deferred load path. Event handlers are stored,
  // not a bare spy, so emit can fire them.
  const loadedSources = new Set<string>();
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const delegatedLayers = new Map<string, readonly string[]>();
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    dispatchEvent: () => true,
    // A custom layer registers its WebGL context-loss listeners on the canvas rather than the map,
    // so these are recorded for a test that drives onAdd and asserts the pair is removed again.
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    style: {} as CSSStyleDeclaration,
  };
  const handlerKey = (type: string, layers?: readonly string[]) =>
    layers ? `${type}:${JSON.stringify(layers)}` : type;
  // Per-source feature-state records, keyed source id then feature id, with the real merge
  // semantics: setFeatureState merges keys, removeFeatureState drops one key, one feature, or a
  // whole source's state. Exposed for assertions that stale state was actually cleared.
  const featureStates = new Map<string, Map<string | number, Record<string, unknown>>>();
  return {
    sources,
    layers,
    images,
    updatedImages,
    renderedFeatures,
    featureStates,
    setFeatureState: ({ source, id }: FeatureStateTarget, state: Record<string, unknown>) => {
      if (id === undefined) return;
      const forSource = featureStates.get(source) ?? new Map();
      featureStates.set(source, forSource);
      forSource.set(id, { ...(forSource.get(id) ?? {}), ...state });
    },
    removeFeatureState: ({ source, id }: FeatureStateTarget, key?: string) => {
      const forSource = featureStates.get(source);
      if (!forSource) return;
      if (id === undefined) {
        featureStates.delete(source);
        return;
      }
      if (key === undefined) {
        forSource.delete(id);
        return;
      }
      const state = forSource.get(id);
      if (!state) return;
      delete state[key];
      if (Object.keys(state).length === 0) forSource.delete(id);
    },
    getFeatureState: ({ source, id }: FeatureStateTarget) =>
      (id === undefined ? undefined : featureStates.get(source)?.get(id)) ?? {},
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    removeImage: (id: string) => images.delete(id),
    updateImage: (id: string) => {
      updatedImages.push(id);
      images.add(id);
    },
    declaredSources,
    addSource: (id: string, spec: SourceSpec) => {
      declaredSources.set(id, spec);
      // A real MapLibre source carries only its own type's mutator, so attach just that one: a
      // wrong-type call then throws in tests as in the browser instead of silently succeeding.
      const isTileSource =
        spec.type === 'raster' || spec.type === 'vector' || spec.type === 'raster-dem';
      // MapLibre's runtime tile source begins at the constructor default, even when the source
      // specification declares another maxzoom. The declared option or remote TileJSON metadata is
      // applied asynchronously, so tests must not make an immediate runtime read look authoritative.
      const source: FakeSource = {
        data: spec.data,
        maxzoom: isTileSource ? 22 : spec.maxzoom,
        tiles: spec.tiles,
      };
      if (spec.type === 'geojson') {
        source.setData = (data: unknown) => {
          source.data = data;
        };
        source.updateData = (diff: GeoJSONSourceDiff) => {
          source.data = applyGeoJsonDiff(
            source.data as GeoJSON.FeatureCollection,
            diff,
            spec.promoteId,
          );
        };
      } else if (spec.type === 'canvas' || spec.type === 'image') {
        source.setCoordinates = vi.fn();
      } else if (isTileSource) {
        source.setTiles = vi.fn();
      }
      sources.set(id, source);
    },
    getSource: (id: string) => sources.get(id),
    isSourceLoaded: (id: string) => loadedSources.has(id),
    markSourceLoaded: (id: string) => loadedSources.add(id),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    moveLayer: vi.fn(),
    removeSource: (id: string) => {
      declaredSources.delete(id);
      // Feature state lives with the source in real MapLibre, so it leaves with it here too.
      featureStates.delete(id);
      return sources.delete(id);
    },
    setLayerZoomRange: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setGlobalStateProperty: vi.fn(),
    triggerRepaint: vi.fn(),
    queryRenderedFeatures: vi.fn(() => renderedFeatures),
    dragPan: {
      isEnabled: () => dragPanEnabled,
      enable: vi.fn(() => {
        dragPanEnabled = true;
      }),
      disable: vi.fn(() => {
        dragPanEnabled = false;
      }),
    },
    on: (
      type: string,
      layerOrHandler: string | readonly string[] | ((event: unknown) => void),
      delegatedHandler?: (event: unknown) => void,
    ) => {
      const layers =
        typeof layerOrHandler === 'string'
          ? [layerOrHandler]
          : Array.isArray(layerOrHandler)
            ? layerOrHandler
            : undefined;
      const handler = delegatedHandler ?? (layerOrHandler as (event: unknown) => void);
      const key = handlerKey(type, layers);
      const set = handlers.get(key) ?? new Set();
      set.add(handler);
      handlers.set(key, set);
      if (layers) delegatedLayers.set(key, layers);
    },
    off: (
      type: string,
      layerOrHandler: string | readonly string[] | ((event: unknown) => void),
      delegatedHandler?: (event: unknown) => void,
    ) => {
      const layers =
        typeof layerOrHandler === 'string'
          ? [layerOrHandler]
          : Array.isArray(layerOrHandler)
            ? layerOrHandler
            : undefined;
      const handler = delegatedHandler ?? (layerOrHandler as (event: unknown) => void);
      const key = handlerKey(type, layers);
      const set = handlers.get(key);
      set?.delete(handler);
      if (set?.size === 0) delegatedLayers.delete(key);
    },
    emit: (type: string, event: unknown) => {
      for (const handler of [...(handlers.get(type) ?? [])]) handler(event);
    },
    emitLayer: (type: string, layer: string, event: unknown) => {
      for (const [key, set] of handlers) {
        if (key.startsWith(`${type}:`) && delegatedLayers.get(key)?.includes(layer)) {
          for (const handler of [...set]) handler(event);
        }
      }
    },
    handlerCount: (type: string, layer?: string) =>
      layer
        ? [...handlers].reduce(
            (count, [key, set]) =>
              count +
              (key.startsWith(`${type}:`) && delegatedLayers.get(key)?.includes(layer)
                ? set.size
                : 0),
            0,
          )
        : (handlers.get(handlerKey(type))?.size ?? 0),
    once: vi.fn(),
    // Read-only accessors several overlays call (anchor, notes, ais-trails, wind, base-theme), with
    // benign defaults, so an overlay tested against the bare fake exercises its logic instead of
    // throwing. A test that needs a specific value overrides the method on the returned object.
    getCanvas: () => canvas,
    getZoom: () => 10,
    getCenter: () => ({ lng: 0, lat: 0 }),
    getBounds: () => ({
      getWest: () => -1,
      getSouth: () => -1,
      getEast: () => 1,
      getNorth: () => 1,
    }),
    getStyle: () => ({ layers: [] as unknown[], sources: {} as Record<string, unknown> }),
  };
}

export type FakeMap = ReturnType<typeof createFakeMap>;

// The OverlayContext an overlay test hands its overlay: a test map plus a no-op beforeId
// resolver. Hoisted because nearly every overlay test was re-declaring this same two-line shape.
// The parameter is deliberately loose: the context's map field is cast to the MapLibre type
// regardless, and tests hand in FakeMap, extended variants with real listeners, and minimal
// bespoke stubs alike.
export function fakeOverlayContext(map: object): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

// Reads back the source specification an overlay declared, for assertions that a value reached the
// map rather than only the module that computed it. Throws on a missing source for the same reason
// sourceFeatures does: a test that forgot overlay.add would otherwise pass by coincidence.
export function declaredSource(
  map: { declaredSources: Map<string, SourceSpec> },
  id: string,
): SourceSpec {
  const spec = map.declaredSources.get(id);
  if (!spec) throw new Error(`no source declared for "${id}"`);
  return spec;
}

// Reads back a geojson source's current features for assertions. Throws rather than defaulting to
// an empty array on a missing source or data, so a test that forgot overlay.add or used the wrong
// source id fails loudly instead of passing by coincidence against a "renders nothing" assertion.
export function sourceFeatures<T = GeoJSON.Feature>(map: FakeMap, id: string): T[] {
  const data = map.sources.get(id)?.data as { features: T[] } | undefined;
  if (!data) throw new Error(`no source data for "${id}"`);
  return data.features;
}
