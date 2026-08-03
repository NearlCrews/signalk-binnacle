import type { ChartGroup } from 'signalk-chart-sources';
import { requireCatalogSource, type XyzCatalogSource } from '$shared/map';

// Seascape (https://openwaters.io/charts/seascape): a free, globally merged bathymetry service, CC BY
// 4.0. Depths are not reduced to a chart datum and do not account for tides or water level; every
// overlay built on this data carries a "for reference only" description for that reason.

export const SEASCAPE_GROUP: ChartGroup = { id: 'seascape', title: 'Seascape bathymetry' };

export interface SeascapeVectorSource {
  id: string;
  tiles: string[];
  maxzoom: number;
  attribution: string;
}

// tileSize is a raster-dem concern. MapLibre reads it when sizing DEM tiles and ignores it on a
// vector source, so only the DEM descriptor carries it.
export interface SeascapeDemSource extends SeascapeVectorSource {
  tileSize: number;
}

/**
 * Read a Seascape source from the shared catalog. The tile template, tile size, zoom ceiling, and
 * attribution are upstream facts the catalog owns and its scheduled monitor checks against the live
 * TileJSON on every run. This module used to keep its own copy of the attribution, which silently
 * fell out of date when Seascape rewrote its credit line; reading it means that cannot recur.
 *
 * These two feed MapLibre raster-dem and vector sources rather than the raster-overlay band, so they
 * take the narrower shapes above instead of the shared catalogSource.
 */
const seascapeSource = (source: XyzCatalogSource): SeascapeVectorSource => ({
  id: source.id,
  tiles: [source.upstream.urlTemplate],
  maxzoom: source.maxzoom,
  attribution: source.attribution,
});

// Terrarium-encoded elevation, {z}/{x}/{y}.webp tiles, global coverage. The catalog's tileSize 512
// matches how Seascape's own style.json declares this source (a MapLibre raster-dem default).
const dem = requireCatalogSource('seascape-dem', 'xyz');
export const SEASCAPE_DEM_SOURCES: SeascapeDemSource[] = [
  { ...seascapeSource(dem), tileSize: dem.tileSize },
];

// contours, soundings, and drying source-layers, {z}/{x}/{y}.pbf tiles, global coverage. Past the
// catalog's maxzoom there are no new tiles; MapLibre overzooms the last generation, matching
// Seascape's own upstream style rather than a defect in this integration.
export const SEASCAPE_VECTOR_SOURCES: SeascapeVectorSource[] = [
  seascapeSource(requireCatalogSource('seascape-vector', 'xyz')),
];
