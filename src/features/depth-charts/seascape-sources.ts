import { type ChartGroup, chartSourceById } from 'signalk-chart-sources';

// Seascape (https://openwaters.io/charts/seascape): a free, globally merged bathymetry service, CC BY
// 4.0. Depths are not reduced to a chart datum and do not account for tides or water level; every
// overlay built on this data carries a "for reference only" description for that reason.

export const SEASCAPE_GROUP: ChartGroup = { id: 'seascape', title: 'Seascape bathymetry' };

export interface SeascapeDemSource {
  id: string;
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
}

export interface SeascapeVectorSource {
  id: string;
  tiles: string[];
  maxzoom: number;
  attribution: string;
}

/**
 * Read a Seascape source from the shared catalog. The tile template, tile size, zoom ceiling, and
 * attribution are upstream facts the catalog owns and its scheduled monitor checks against the live
 * TileJSON on every run. This module used to keep its own copy of the attribution, which silently
 * fell out of date when Seascape rewrote its credit line; reading it means that cannot recur.
 *
 * These two feed MapLibre raster-dem and vector sources rather than the raster-overlay band, so they
 * take the narrower shape above instead of the shared catalogSource.
 */
const seascapeSource = (id: string): SeascapeDemSource => {
  const source = chartSourceById(id);
  if (source?.upstream.mode !== 'xyz') {
    throw new TypeError(`Missing XYZ chart source metadata for ${id}`);
  }
  return {
    id: source.id,
    tiles: [source.upstream.urlTemplate],
    tileSize: source.tileSize,
    maxzoom: source.maxzoom,
    attribution: source.attribution,
  };
};

// Terrarium-encoded elevation, {z}/{x}/{y}.webp tiles, global coverage. The catalog's tileSize 512
// matches how Seascape's own style.json declares this source (a MapLibre raster-dem default).
export const SEASCAPE_DEM_SOURCES: SeascapeDemSource[] = [seascapeSource('seascape-dem')];

// contours, soundings, and drying source-layers, {z}/{x}/{y}.pbf tiles, global coverage. Past the
// catalog's maxzoom there are no new tiles; MapLibre overzooms the last generation, matching
// Seascape's own upstream style rather than a defect in this integration.
export const SEASCAPE_VECTOR_SOURCES: SeascapeVectorSource[] = [seascapeSource('seascape-vector')];
