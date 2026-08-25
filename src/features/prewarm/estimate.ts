/** Pure estimate helpers for the regions panel: project the tile count with the shared enumerator and
 * multiply by the per-source byte average from the cache stats, gated against the regions-free budget.
 * This is planning data, not a mathematical upper bound. The companion still enforces actual tile and
 * byte limits while saving. */

import {
  CHART_SOURCES,
  type ChartSource,
  estimateBytes,
  type LngLatBbox,
  tileCountInBbox,
  type ZoomRange,
} from 'signalk-chart-sources';
import { boundsOfPoints, isLatitude, unwrapEast, wrapLongitude } from '$shared/geo';
import { formatBytes } from '$shared/lib';
import { BASEMAP_SOURCE_ID } from '$shared/map';
import type { CacheStats, WarmStatus } from './regions-client.js';

// The region list includes the basemap, while the position-warm list and the new-box auto-select
// exclude it: it is global and large.

/**
 * A time-dynamic source, which the catalog marks with maxAgeSeconds. Weather radar and hazard
 * overlays go stale in minutes, so downloading them for later is worse than useless: the tiles are
 * wrong before anyone reads them, and the companion cache refuses to warm them anyway. Offering them
 * here would let a region spend its byte budget on tiles that are never stored.
 */
function isVolatile(source: ChartSource): boolean {
  return source.maxAgeSeconds !== undefined;
}

/** The registry sources offered for a region download, including the vector basemap so a region can
 * pin the base layer for offline geometry. */
export function regionSources(): ChartSource[] {
  return CHART_SOURCES.filter(
    (s) => !isVolatile(s) && (s.upstream.mode !== 'style' || s.id === BASEMAP_SOURCE_ID),
  );
}

/** The sources offered for position warm: never the basemap (warming a whole basemap per GPS fix is
 * wrong), never any other style source, and never a time-dynamic one. */
export function positionWarmSources(): ChartSource[] {
  return CHART_SOURCES.filter((s) => !isVolatile(s) && s.upstream.mode !== 'style');
}

/** Sources that cover the drawn bbox: region sources where tileCountInBbox > 0. Sources with no
 * bounds are global and always included for a non-empty bbox; the basemap (global, no bounds) covers
 * any non-empty box. */
export function coveringSources(bbox: LngLatBbox, zoomRange: ZoomRange): ChartSource[] {
  // A zero-area box covers nothing, and the enumerator rejects one outright (it used to expand
  // silently to worldwide coverage, which is where the estimate for a mis-drawn rectangle came
  // from). This runs inside the draw library's finish callback, where a throw would escape into its
  // event dispatch, so the degenerate case is answered here rather than raised.
  if (!hasArea(bbox)) return [];
  return regionSources().filter((s) => tileCountInBbox(s, bbox, zoomRange) > 0);
}

/** Whether a box covers real ground. A tap without a drag, or a drag along one axis, yields a ring
 * whose corners share a longitude or a latitude. */
function hasArea([west, south, east, north]: LngLatBbox): boolean {
  return west !== east && south !== north;
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

type DownloadGateReason =
  | 'administrator-access'
  | 'draw-area'
  | 'storage-loading'
  | 'choose-charts'
  | 'estimate-error'
  | 'insufficient-space';

/** The one reason the region builder cannot proceed, in the same order the navigator encounters the
 * workflow. Keeping this decision pure prevents a disabled Download button from drifting away from
 * its explanation as new gates are added. */
export function downloadGateReason(opts: {
  bbox: LngLatBbox | null;
  sources: string[];
  accessBlocked: boolean;
  stats: CacheStats | null;
  estimate: number | null;
}): DownloadGateReason | null {
  if (opts.accessBlocked) return 'administrator-access';
  if (opts.bbox === null) return 'draw-area';
  if (opts.stats === null) return 'storage-loading';
  if (opts.sources.length === 0) return 'choose-charts';
  if (opts.estimate === null) return 'estimate-error';
  if (exceedsRegionsFree(opts.estimate, opts.stats)) return 'insufficient-space';
  return null;
}

/** The bbox of a drawn rectangle ring. Longitude is wrapped before finding its shortest enclosing
 * interval, so a rectangle spanning 170 through 190 degrees returns [170, ..., -170, ...]. */
export function bboxFromRectangle(ring: Array<[number, number]>): LngLatBbox {
  if (ring.length === 0) throw new RangeError('rectangle ring must not be empty');
  const points: Array<{ latitude: number; longitude: number }> = [];
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !isLatitude(lat)) {
      throw new RangeError('rectangle coordinates must be finite geographic coordinates');
    }
    // The shared wrap folds 180 onto -180, the same meridian. A drawn rectangle's east edge is a
    // distinct corner from its west one, so a box drawn to exactly +180 restores it here.
    let longitude = wrapLongitude(lng);
    if (longitude === -180 && lng > 0) longitude = 180;
    points.push({ latitude: lat, longitude });
  }
  const bbox = boundsOfPoints(points);
  if (bbox === undefined) throw new RangeError('rectangle ring must not be empty');
  return bbox;
}

/** A GeoJSON rectangle ring for a bbox. East is unwrapped when the box crosses the antimeridian so
 * Terra Draw seeds the short rectangle instead of drawing nearly the whole world. */
export function rectangleRingFromBbox(bbox: LngLatBbox): Array<[number, number]> {
  const [west, south, east, north] = bbox;
  const drawEast = unwrapEast(west, east);
  return [
    [west, south],
    [drawEast, south],
    [drawEast, north],
    [west, north],
    [west, south],
  ];
}

type EstimateResult = { ok: true; bytes: number } | { ok: false; message: string };

/** Convert strict package estimate failures into a render-safe state at the panel boundary. */
export function estimateRegionBytes(
  sources: readonly string[],
  bbox: LngLatBbox,
  zoomRange: ZoomRange,
  perSourceAvgBytes: Readonly<Record<string, number>>,
): EstimateResult {
  try {
    return { ok: true, bytes: estimateBytes(sources, bbox, zoomRange, perSourceAvgBytes) };
  } catch (cause) {
    if (!(cause instanceof TypeError || cause instanceof RangeError)) throw cause;
    return {
      ok: false,
      message:
        'Could not calculate the download estimate. Retry the storage check, or redraw the area.',
    };
  }
}

/** The single gate predicate shared by RegionsController's gate and its own test. Returns true only
 * when a box is drawn, at least one source is selected, administrator access is available, and the
 * estimate fits the regions-free budget. */
export function canDownloadRegion(opts: {
  bbox: LngLatBbox | null;
  sources: string[];
  accessBlocked: boolean;
  stats: CacheStats;
  zoomRange: ZoomRange;
}): boolean {
  if (opts.bbox === null || opts.sources.length === 0 || opts.accessBlocked) return false;
  const estimate = estimateRegionBytes(
    opts.sources,
    opts.bbox,
    opts.zoomRange,
    opts.stats.perSourceAvgBytes,
  );
  return estimate.ok && !exceedsRegionsFree(estimate.bytes, opts.stats);
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
