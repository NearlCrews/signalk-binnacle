/** Pure estimate helpers for the regions panel: project the tile count with the shared enumerator and
 * multiply by the per-source byte average from the cache stats, gated against the regions-free budget.
 * The estimate is a ceiling (a warm negative-caches 404s at zero bytes, so the real footprint is
 * smaller). DEFAULT_TILE_BYTES and estimateBytes are hoisted into the shared package so the panel and
 * the companion plugin share one implementation and the server-side budget re-validation agrees. */

import {
  type Bbox,
  CHART_SOURCES,
  type ChartSource,
  DEFAULT_TILE_BYTES,
  estimateBytes,
  tileCountInBbox,
  type ZoomRange,
} from 'signalk-chart-sources';
import { formatBytes } from '$shared/lib';
import type { CacheStats, WarmStatus } from './regions-client.js';

/** Re-exported from the shared package so the panel, the plugin, and any caller share one estimate. */
export { DEFAULT_TILE_BYTES, estimateBytes };

/** The basemap source id; the region list includes it, the position-warm list and the new-box
 * auto-select exclude it (it is global and large). */
const BASEMAP_SOURCE_ID = 'basemap';

/** The registry sources offered for a region download, including the vector basemap so a region can
 * pin the base layer for offline geometry. */
export function regionSources(): ChartSource[] {
  return CHART_SOURCES.filter((s) => s.upstream.mode !== 'style' || s.id === BASEMAP_SOURCE_ID);
}

/** The sources offered for position warm: never the basemap (warming a whole basemap per GPS fix is
 * wrong) and never any other style source. */
export function positionWarmSources(): ChartSource[] {
  return CHART_SOURCES.filter((s) => s.upstream.mode !== 'style');
}

/** Sources that cover the drawn bbox: region sources where tileCountInBbox > 0. Sources with no
 * bounds are global and always included for a non-empty bbox; the basemap (global, no bounds) covers
 * any non-empty box. */
export function coveringSources(bbox: Bbox, zoomRange: ZoomRange): ChartSource[] {
  return regionSources().filter((s) => tileCountInBbox(s, bbox, zoomRange) > 0);
}

/** Room for new real-region pins. Prefers the server-computed regionsFreeBytes (which already accounts
 * for the position-warm reserve P), falling back to a local floor at 0 that mirrors the container's
 * (R - P) - real_pinned. */
export function regionsFreeBytes(stats: CacheStats): number {
  return Math.max(
    0,
    stats.regionsFreeBytes ??
      Math.max(
        0,
        (stats.regionsBudgetBytes ?? 0) -
          (stats.positionWarmBudgetBytes ?? 0) -
          Math.max(0, (stats.pinnedBytes ?? 0) - (stats.positionWarmBytes ?? 0)),
      ),
  );
}

/** True when the estimate exceeds regionsFreeBytes (Download is disabled while true). */
export function exceedsRegionsFree(estimate: number, stats: CacheStats): boolean {
  return estimate > regionsFreeBytes(stats);
}

/** The [minLng, minLat, maxLng, maxLat] of a drawn rectangle ring of [lng, lat] points. A manual
 * scan, not a spread into Math.min/max (unbounded in arg count), matching tides-display. */
export function bboxFromRectangle(ring: Array<[number, number]>): Bbox {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** The single gate predicate shared by the panel and its test. Returns true only when a box is
 * drawn, at least one source is selected, the user can write, and the estimate fits the regions-free
 * budget. */
export function canDownloadRegion(opts: {
  bbox: Bbox | null;
  sources: string[];
  writeBlocked: boolean;
  stats: CacheStats;
  zoomRange: ZoomRange;
}): boolean {
  if (opts.bbox === null || opts.sources.length === 0 || opts.writeBlocked) return false;
  return !exceedsRegionsFree(
    estimateBytes(opts.sources, opts.bbox, opts.zoomRange, opts.stats.perSourceAvgBytes),
    opts.stats,
  );
}

/** A poll status is terminal when the job is no longer running. A null status means the job is
 * gone (the container restarted and lost the in-memory job); treat it as gone and offer a re-warm. */
export function isTerminal(status: WarmStatus | null): boolean {
  return status === null || status.state !== 'running';
}

/** Format the per-source scroll totals for the cache-management breakdown: each source's bytes through
 * formatBytes, so the panel renders them with the same value-and-unit shape as every other stat. An
 * absent bySource yields an empty list. */
export function formatBySource(
  stats: CacheStats,
): Array<{ source: string; value: string; unit: string }> {
  return (stats.bySource ?? []).map((row) => {
    const b = formatBytes(row.bytes);
    return { source: row.source, value: b.value, unit: b.unit };
  });
}
