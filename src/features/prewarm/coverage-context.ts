import { chartSourceById } from 'signalk-chart-sources';
import type { RouteWaypoint } from '$entities/route';
import type { SavedRegionDto } from './regions-client';
import type { RouteCoverageReport } from './route-coverage';

export interface CoverageRoute {
  id: string;
  name: string;
  waypoints: RouteWaypoint[];
}

export interface RouteCoverageAssessment {
  report: RouteCoverageReport;
  routeId: string;
  geometryKey: string;
  areasKey: string;
  catalogKey: string;
  checkedAt: number;
}

export function routeCoverageGeometryKey(waypoints: readonly RouteWaypoint[]): string {
  return JSON.stringify(waypoints.map(({ position }) => [position.longitude, position.latitude]));
}

export function routeCoverageAreasKey(regions: readonly SavedRegionDto[] | null): string {
  if (regions === null) return 'unknown';
  return JSON.stringify(
    [...regions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((region) => ({
        id: region.id,
        bbox: region.bbox,
        status: region.status,
        minzoom: region.minzoom,
        maxzoom: region.maxzoom,
        sourceIds: [...region.sourceIds].sort(),
        unavailableSourceIds: [...region.unavailableSourceIds].sort(),
        lastDownloadedAt: region.lastDownloadedAt,
      })),
  );
}

export function routeCoverageCatalogKey(regions: readonly SavedRegionDto[] | null): string {
  if (regions === null) return 'unknown';
  const ids = [...new Set(regions.flatMap((region) => region.sourceIds))].sort();
  return JSON.stringify(ids.map((id) => [id, chartSourceById(id) ?? null]));
}
