import type { LayerSpecification, SourceSpecification } from 'maplibre-gl';
import type { SignalKChart } from './chart-types';
import { DAY_PAINT, type MapColorKey } from './map-theme';

// Stamped on each themed draw layer so the chart overlay can recolor it on a theme
// change without re-deriving the source-layer to color mapping.
export const THEME_PAINT_KEY = 'binnacle:themePaint';

// The pmtiles protocol scheme prefix, shared so the overlay can detect and strip it.
export const PMTILES_SCHEME = 'pmtiles://';

// The prefix on every chart source and layer id, so the base-theme recolor can recognize and
// skip chart-owned layers from a single source of truth rather than a hardcoded string.
export const CHART_SOURCE_PREFIX = 'chart-';

interface ChartSpecs {
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
}

export function chartSourceId(identifier: string): string {
  return `${CHART_SOURCE_PREFIX}${identifier}`;
}

function absolute(url: string, base: string): string {
  // Pass through absolute, protocol-relative, blob, and pmtiles URLs; only join true relatives.
  // A user-imported file resolves to a pmtiles://blob: URL, which is already absolute.
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('//') ||
    url.startsWith('blob:') ||
    url.startsWith(PMTILES_SCHEME)
  ) {
    return url;
  }
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function hasPmtilesPath(value: string): boolean {
  const candidate = value.startsWith(PMTILES_SCHEME) ? value.slice(PMTILES_SCHEME.length) : value;
  try {
    // Use the pathname rather than the whole URL so signed and cache-busted archives retain their
    // query string while still being recognized as PMTiles documents.
    return new URL(candidate, 'http://binnacle.invalid').pathname
      .toLowerCase()
      .endsWith('.pmtiles');
  } catch {
    return candidate.split(/[?#]/, 1)[0].toLowerCase().endsWith('.pmtiles');
  }
}

// A PMTiles archive URL for MapLibre's protocol: an already-pmtiles URL stays as is, a URL whose
// pathname ends in .pmtiles gets the scheme, and anything else is not a PMTiles archive.
function pmtilesUrl(resolved: string): string | undefined {
  if (resolved.startsWith(PMTILES_SCHEME)) return resolved;
  if (hasPmtilesPath(resolved)) return `${PMTILES_SCHEME}${resolved}`;
  return undefined;
}

function rasterSpecs(chart: SignalKChart, base: string): ChartSpecs {
  const sourceId = chartSourceId(chart.identifier);
  const layerId = `${sourceId}-layer`;
  const resolved = absolute(chart.tilemapUrl ?? chart.url ?? '', base);
  const pmtiles = pmtilesUrl(resolved);
  // A raster PMTiles archive serves its own TileJSON through the protocol, so it is referenced by
  // url; a tile-server raster uses a {z}/{x}/{y} template.
  const source: SourceSpecification = pmtiles
    ? {
        type: 'raster',
        url: pmtiles,
        tileSize: 256,
        ...(chart.bounds ? { bounds: chart.bounds } : {}),
      }
    : {
        type: 'raster',
        tiles: [resolved],
        tileSize: 256,
        ...(chart.minzoom !== undefined ? { minzoom: chart.minzoom } : {}),
        ...(chart.maxzoom !== undefined ? { maxzoom: chart.maxzoom } : {}),
        ...(chart.bounds ? { bounds: chart.bounds } : {}),
      };
  return {
    sources: { [sourceId]: source },
    layers: [{ id: layerId, type: 'raster', source: sourceId }],
  };
}

// How each known vector source-layer is drawn and which theme color it takes. A
// vector tile source paints nothing on its own; MapLibre needs a draw layer per
// source-layer. The two dominant vector base-map schemas are covered so an arbitrary
// user archive renders: Protomaps (earth, roads, boundaries) and OpenMapTiles
// (no earth land polygon, transportation, boundary).
type DrawKind = 'fill' | 'line';
interface DrawStyle {
  sourceLayer: string;
  kind: DrawKind;
  paint: MapColorKey;
  // Only draw this source-layer at or above this zoom. Some archives ship a source-layer
  // un-simplified from low zoom (landuse can be ~1700 polygons in a single z9 tile), which
  // is invisible-but-heavy there and can overwhelm a weaker GPU into dropping tiles. Hold
  // such layers until the zoom where they are actually legible.
  minZoom?: number;
}

// Below this zoom landuse is tiny zoning detail, not worth its polygon weight.
const LANDUSE_MIN_ZOOM = 12;

// Boundary lines draw a touch heavier than the other line work so administrative borders read over
// the roads and transportation lines beneath them.
const BOUNDARY_LINE_WIDTH = 0.8;
const FEATURE_LINE_WIDTH = 0.5;

// One ordered list is the single source of both draw order and per-source-layer style,
// so a styled source-layer can never be left out of the draw order. Drawn back to front:
// land base, ground cover, water, then line work on top. Water is drawn over land on
// purpose: on a marine chart navigable water must never be hidden by an over-generalized
// land polygon. The tradeoff is that at low zoom a small island whose archive water tile
// lacks a hole merges into the water; it reappears once the tiles carry enough detail.
// Two schemas are covered so an arbitrary archive renders: Protomaps (earth, roads,
// boundaries) and OpenMapTiles (no earth land polygon, transportation, boundary).
const DRAW_LAYERS: readonly DrawStyle[] = [
  { sourceLayer: 'earth', kind: 'fill', paint: 'land' },
  { sourceLayer: 'landcover', kind: 'fill', paint: 'landcover' },
  { sourceLayer: 'landuse', kind: 'fill', paint: 'landcover', minZoom: LANDUSE_MIN_ZOOM },
  { sourceLayer: 'water', kind: 'fill', paint: 'water' },
  { sourceLayer: 'roads', kind: 'line', paint: 'road' },
  { sourceLayer: 'transportation', kind: 'line', paint: 'road' },
  { sourceLayer: 'boundaries', kind: 'line', paint: 'boundary' },
  { sourceLayer: 'boundary', kind: 'line', paint: 'boundary' },
];

function vectorDrawLayers(sourceId: string, available: string[]): LayerSpecification[] {
  // Signal K's charts API often returns an empty layers list for a PMTiles archive;
  // the real source-layer names live in the archive's own metadata. The vector base
  // map uses the standard Protomaps schema, so when no layers are declared, draw the
  // full known set. MapLibre silently ignores a draw layer whose source-layer is
  // absent from the tiles, so emitting all of them is safe.
  const present =
    available.length > 0 ? new Set(available) : new Set(DRAW_LAYERS.map((d) => d.sourceLayer));
  const layers: LayerSpecification[] = [];
  for (const style of DRAW_LAYERS) {
    const sourceLayer = style.sourceLayer;
    if (!present.has(sourceLayer)) continue;
    const id = `${sourceId}-${sourceLayer}`;
    const color = DAY_PAINT[style.paint];
    const metadata = { [THEME_PAINT_KEY]: style.paint };
    const minzoom = style.minZoom !== undefined ? { minzoom: style.minZoom } : {};
    if (style.kind === 'fill') {
      layers.push({
        id,
        type: 'fill',
        source: sourceId,
        'source-layer': sourceLayer,
        paint: { 'fill-color': color },
        metadata,
        ...minzoom,
      });
    } else {
      layers.push({
        id,
        type: 'line',
        source: sourceId,
        'source-layer': sourceLayer,
        paint: {
          'line-color': color,
          // Boundary source-layers carry paint 'boundary' in DRAW_LAYERS; key the wider stroke off
          // that category so adding a boundary source-layer to the table needs no second edit here.
          'line-width': style.paint === 'boundary' ? BOUNDARY_LINE_WIDTH : FEATURE_LINE_WIDTH,
        },
        metadata,
        ...minzoom,
      });
    }
  }
  return layers;
}

// True for an XYZ tile template (it carries the {z} placeholder) rather than a TileJSON or
// .pmtiles document URL. MapLibre substitutes the placeholders only for a `tiles` entry.
function isTileTemplate(url: string): boolean {
  return url.includes('{z}');
}

function vectorSpecs(chart: SignalKChart, base: string): ChartSpecs {
  const sourceId = chartSourceId(chart.identifier);
  // A vector chart's `url` is its TileJSON or .pmtiles document, preferred over the
  // `{z}/{x}/{y}` template in `tilemapUrl`; the raster path prefers them the other way.
  const raw = chart.url ?? chart.tilemapUrl ?? '';
  const resolved = absolute(raw, base);
  const pmtiles = pmtilesUrl(resolved);
  // Honor a declared coverage extent so MapLibre suppresses tile requests outside it; a
  // regional vector chart would otherwise fetch and 404 tiles across the whole world.
  const extent = {
    ...(chart.minzoom !== undefined ? { minzoom: chart.minzoom } : {}),
    ...(chart.maxzoom !== undefined ? { maxzoom: chart.maxzoom } : {}),
    ...(chart.bounds ? { bounds: chart.bounds } : {}),
  };
  // A {z}/{x}/{y} template must go in `tiles` so MapLibre substitutes the placeholders per
  // request; in `url` MapLibre would fetch it verbatim, percent-encoding the braces into a 404. A
  // .pmtiles archive and a TileJSON document are documents referenced by `url` (a pmtiles URL never
  // carries a template, so it takes this branch).
  const source: SourceSpecification = isTileTemplate(resolved)
    ? { type: 'vector', tiles: [resolved], ...extent }
    : { type: 'vector', url: pmtiles ?? resolved, ...extent };
  return {
    sources: { [sourceId]: source },
    layers: vectorDrawLayers(sourceId, chart.layers ?? []),
  };
}

// A chart is vector when it declares a vector type or an MVT/PMTiles payload. Some
// Signal K servers label a vector PMTiles archive as "tilelayer" but mark it with
// format "mvt", so the format and the .pmtiles suffix are checked, not just the type.
const RASTER_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif']);

function isVector(chart: SignalKChart): boolean {
  if (chart.type === 'tileJSON') return true;
  if (chart.format === 'mvt' || chart.format === 'pbf') return true;
  // An explicit raster format wins over the .pmtiles suffix, so a raster PMTiles is not vector.
  if (chart.format && RASTER_FORMATS.has(chart.format)) return false;
  const candidate = chart.url ?? chart.tilemapUrl ?? '';
  return hasPmtilesPath(candidate);
}

export function chartToSpecs(chart: SignalKChart, serverBase: string): ChartSpecs {
  // A mapstyleJSON chart is a full style document, not a tile source; until the style
  // pipeline lands (a later spec) it cannot load as an overlay, so emit nothing rather
  // than a broken vector source. No current provider ships this type.
  if (chart.type === 'mapstyleJSON') return { sources: {}, layers: [] };
  return isVector(chart) ? vectorSpecs(chart, serverBase) : rasterSpecs(chart, serverBase);
}
