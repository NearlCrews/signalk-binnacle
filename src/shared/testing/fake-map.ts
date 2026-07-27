import { vi } from 'vitest';
import type { OverlayContext } from '$shared/map';

// Test-only fake MapLibre map covering the source, layer, and image surface the
// overlays use. Imported by *.test.ts files, never by production code.
type FakeSource = {
  setData?: (data: unknown) => void;
  setCoordinates?: (coordinates: unknown) => void;
  setTiles?: (tiles: unknown) => void;
  data: unknown;
  maxzoom?: number;
  tiles?: unknown;
};

export function createFakeMap() {
  const sources = new Map<string, FakeSource>();
  const layers = new Set<string>();
  const images = new Set<string>();
  const updatedImages: string[] = [];
  // A source is not loaded until its tiles arrive, as in real MapLibre; markSourceLoaded plus an
  // emitted 'sourcedata' event let a test drive the deferred load path. Event handlers are stored,
  // not a bare spy, so emit can fire them.
  const loadedSources = new Set<string>();
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  return {
    sources,
    layers,
    images,
    updatedImages,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    removeImage: (id: string) => images.delete(id),
    updateImage: (id: string) => {
      updatedImages.push(id);
      images.add(id);
    },
    addSource: (
      id: string,
      spec: { type?: string; data?: unknown; maxzoom?: number; tiles?: unknown },
    ) => {
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
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: (layer: { id: string }) => layers.add(layer.id),
    removeLayer: (id: string) => layers.delete(id),
    moveLayer: vi.fn(),
    removeSource: (id: string) => sources.delete(id),
    setLayerZoomRange: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setGlobalStateProperty: vi.fn(),
    on: (type: string, handler: (event: unknown) => void) => {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
    },
    off: (type: string, handler: (event: unknown) => void) => {
      handlers.get(type)?.delete(handler);
    },
    emit: (type: string, event: unknown) => {
      for (const handler of [...(handlers.get(type) ?? [])]) handler(event);
    },
    once: vi.fn(),
    // Read-only accessors several overlays call (anchor, notes, ais-trails, wind, base-theme), with
    // benign defaults, so an overlay tested against the bare fake exercises its logic instead of
    // throwing. A test that needs a specific value overrides the method on the returned object.
    getCanvas: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      dispatchEvent: () => true,
      style: {} as CSSStyleDeclaration,
    }),
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

// Reads back a geojson source's current features for assertions. Throws rather than defaulting to
// an empty array on a missing source or data, so a test that forgot overlay.add or used the wrong
// source id fails loudly instead of passing by coincidence against a "renders nothing" assertion.
export function sourceFeatures<T = GeoJSON.Feature>(map: FakeMap, id: string): T[] {
  const data = map.sources.get(id)?.data as { features: T[] } | undefined;
  if (!data) throw new Error(`no source data for "${id}"`);
  return data.features;
}
