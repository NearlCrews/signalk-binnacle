import { type Bbox4, bboxContainsPoint, type LatLon } from '$shared/geo';

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
  bounds?: Bbox4;
  minzoom?: number;
  maxzoom?: number;
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
  // Undeclared bounds mean worldwide coverage by the charts API contract.
  const covering = visibleCharts.filter(
    (chart) =>
      chart.bounds === undefined || bboxContainsPoint(chart.bounds, input.center as LatLon),
  );
  if (covering.length === 0) return 'out-of-coverage';
  // Below every covering chart's minzoom nothing of them is drawn yet: coverage in the zoom
  // dimension is coverage too.
  const inRange = covering.filter((chart) => zoom >= (chart.minzoom ?? 0));
  if (inRange.length === 0) return 'out-of-coverage';
  const overzoomed = inRange.every((chart) => chart.maxzoom !== undefined && zoom > chart.maxzoom);
  return overzoomed ? 'active-overzoomed' : 'active';
}
