import { type Bbox4, bboxContainsPoint, type LatLon } from '$shared/geo';
import type { ChartCoverageInfo, ChartLayerInfo } from './types';

// The ambient chart-trust grade for the current view: whether a usable nautical chart actually
// covers what the navigator is looking at, or the surface is a reference base map, out of the
// enabled charts' coverage, past native detail, or degraded by a failure. A reference base map is
// never called a chart, and cached data is never called passage-ready; this only grades the view.
export type ChartViewStatusKind =
  | 'active'
  | 'active-overzoomed'
  | 'reference-only'
  | 'out-of-coverage'
  | 'source-failed'
  | 'base-unavailable';

export interface ChartViewChart {
  visible: boolean;
  bounds?: Readonly<Bbox4>;
  minzoom?: number;
  maxzoom?: number;
}

// Whether any visible layer is a real navigation chart, the one predicate behind both the Charts
// tab's no-chart-on explanation and the region-aware chart prompt. Depth shading carries neither
// field, so it correctly never counts as a chart.
export function hasVisibleNavigationChart(
  items: readonly {
    visible: boolean;
    chart?: unknown;
    chartCoverage?: unknown;
  }[],
): boolean {
  return items.some(
    (item) => item.visible && (item.chart !== undefined || item.chartCoverage !== undefined),
  );
}

// The projection from listed layers to the badge's chart entries, so the counting rule lives in
// one testable place. A charts-API or user chart contributes its own bounds; a navigation-chart
// overlay contributes ONE ENTRY PER COVERAGE BOX, since a chart-display service's single bounds
// is its near-worldwide envelope and a per-box entry is what lets out-of-coverage fire between
// regions. The boxes share one zoom range, so the overzoom grade stays correct across entries.
export function chartViewCharts(
  items: readonly {
    visible: boolean;
    chart?: Pick<ChartLayerInfo, 'bounds' | 'minzoom' | 'maxzoom'>;
    chartCoverage?: ChartCoverageInfo;
  }[],
): ChartViewChart[] {
  const charts: ChartViewChart[] = [];
  for (const item of items) {
    if (item.chart) {
      charts.push({
        visible: item.visible,
        bounds: item.chart.bounds,
        minzoom: item.chart.minzoom,
        maxzoom: item.chart.maxzoom,
      });
      continue;
    }
    const info = item.chartCoverage;
    if (!info) continue;
    if (info.coverage === undefined) {
      charts.push({ visible: item.visible, minzoom: info.minzoom, maxzoom: info.maxzoom });
      continue;
    }
    for (const box of info.coverage) {
      charts.push({
        visible: item.visible,
        bounds: box,
        minzoom: info.minzoom,
        maxzoom: info.maxzoom,
      });
    }
  }
  return charts;
}

export interface ChartViewInput {
  // The base style never arrived and the one-layer offline fallback is standing in.
  baseStyleFallback: boolean;
  chartsLoadState: 'loading' | 'ready' | 'partial' | 'error';
  charts: readonly ChartViewChart[];
  center: LatLon | undefined;
  zoom: number | undefined;
}

export function chartViewStatus(input: ChartViewInput): ChartViewStatusKind {
  if (input.baseStyleFallback) return 'base-unavailable';
  const visibleCharts = input.charts.filter((chart) => chart.visible);
  if (visibleCharts.length === 0) {
    // With nothing enabled, a failed chart endpoint is the reason there is nothing to enable.
    return input.chartsLoadState === 'error' ? 'source-failed' : 'reference-only';
  }
  if (!input.center || input.zoom === undefined) return 'reference-only';
  const zoom = input.zoom;
  // MapLibre's unwrapped center longitude escapes [-180, 180) after panning across the
  // antimeridian, exactly where the Aleutian and island-EEZ chart boxes sit, so containment
  // normalizes it first.
  const center: LatLon = {
    latitude: input.center.latitude,
    longitude: ((((input.center.longitude + 180) % 360) + 360) % 360) - 180,
  };
  // Undeclared bounds mean worldwide coverage by the charts API contract.
  const covering = visibleCharts.filter(
    (chart) => chart.bounds === undefined || bboxContainsPoint(chart.bounds, center),
  );
  if (covering.length === 0) return 'out-of-coverage';
  // Below every covering chart's minzoom nothing of them is drawn yet: coverage in the zoom
  // dimension is coverage too.
  const inRange = covering.filter((chart) => zoom >= (chart.minzoom ?? 0));
  if (inRange.length === 0) return 'out-of-coverage';
  const overzoomed = inRange.every((chart) => chart.maxzoom !== undefined && zoom > chart.maxzoom);
  return overzoomed ? 'active-overzoomed' : 'active';
}
