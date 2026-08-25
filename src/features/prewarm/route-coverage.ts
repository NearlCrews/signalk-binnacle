import { chartSourceById, tileCountInBbox } from 'signalk-chart-sources';
import type { RouteWaypoint } from '$entities/route';
import {
  type Bbox4,
  bboxContainsPoint,
  splitAtAntimeridian,
  unwrapEast,
  wrapLongitude,
} from '$shared/geo';
import { nauticalMilesToMeters } from '$shared/lib';
import { antimeridianLineGeometry } from '$shared/map';
import { geodesicDestination, rhumbBearingRad, rhumbDistanceMeters } from '$shared/nav';
import { type DetailKey, rangeForPreset } from './detail-level';
import type { SavedRegionDto } from './regions-client';

// An advisory, noncertifying check of the active route's corridor against the READY saved offline
// areas. It samples the corridor (the route line plus its two edges at the chosen half-width) and
// classifies each sample against the ready areas, the catalog coverage of each area's selected
// charts, and the requested detail. It is an approximation by construction: sampling can miss a
// hole narrower than the sample spacing, and it says nothing about chart quality, datum, or
// provider health. The copy beside the result must say it does not certify navigation or passage
// safety, and provider readiness stays a separate readout.

export const COVERAGE_CORRIDOR_CHOICES_NM = [1, 5, 10] as const;
export const DEFAULT_COVERAGE_CORRIDOR_NM = 5;

// Sampling resolution: half the corridor width along the route, bounded so a very long route stays
// cheap. At the budget cap the spacing grows, which the approximation note above already covers.
const MAX_COVERAGE_SAMPLES = 1200;

export type CoverageVerdict = 'complete' | 'partial' | 'unknown';
type CoverageGapKind = 'uncovered' | 'insufficient-detail';

export interface RouteCoverageReport {
  verdict: CoverageVerdict;
  // Present only for the unknown verdict: why the corridor could not be evaluated.
  unknownReason?: string;
  corridorNm: number;
  detail: DetailKey;
  sampleCount: number;
  uncoveredCount: number;
  detailShortCount: number;
  // Read-only highlight geometry: one feature per contiguous gap run, properties.kind carrying the
  // CoverageGapKind, geometry already split at the antimeridian for drawing.
  gaps: GeoJSON.Feature[];
}

// covered < insufficient-detail < uncovered, so a segment takes its worst sample's class.
const COVERED = 0;
const DETAIL_SHORT = 1;
const UNCOVERED = 2;
type SampleClass = typeof COVERED | typeof DETAIL_SHORT | typeof UNCOVERED;

// A saved region's box in the one or two in-range parts that cover the same ground. Chart Locker
// boxes drawn across the seam arrive either unwrapped (east past 180) or in the west-greater-than-
// east crossing convention; both normalize through the shared splitter.
function regionParts(bbox: SavedRegionDto['bbox']): Bbox4[] {
  const [west, south, east, north] = bbox;
  return splitAtAntimeridian([west, south, unwrapEast(west, east), north]);
}

// Whether one of the region's selected charts covers this point at all, per the catalog's own
// bounds. chartSourceById rather than requireCatalogSource: a saved area can legitimately name a
// source the catalog no longer carries, and that reads as no coverage, not a crash.
function sourceCoversPoint(
  sourceIds: readonly string[],
  latitude: number,
  longitude: number,
  zooms: readonly [number, number],
): boolean {
  const eps = 1e-6;
  const probe: [number, number, number, number] = [
    longitude - eps,
    latitude - eps,
    longitude + eps,
    latitude + eps,
  ];
  return sourceIds.some((id) => {
    const source = chartSourceById(id);
    return source !== undefined && tileCountInBbox(source, probe, [zooms[0], zooms[1]]) > 0;
  });
}

// A ready area with its seam split done once. The split is per AREA, not per sample point, and a
// route check samples thousands of points against every area: recomputing it inside the loop was
// three splits per point per area.
interface ReadyRegion {
  region: SavedRegionDto;
  parts: Bbox4[];
}

function classifyPoint(
  latitude: number,
  longitude: number,
  regions: readonly ReadyRegion[],
  requiredMaxzoom: number,
): SampleClass {
  const lon = wrapLongitude(longitude);
  const point = { latitude, longitude: lon };
  let best: SampleClass = UNCOVERED;
  for (const { region, parts } of regions) {
    if (!parts.some((part) => bboxContainsPoint(part, point))) continue;
    if (!sourceCoversPoint(region.sourceIds, latitude, lon, [region.minzoom, region.maxzoom])) {
      continue;
    }
    if (region.maxzoom >= requiredMaxzoom) return COVERED;
    best = DETAIL_SHORT;
  }
  return best;
}

interface RouteCoverageInput {
  waypoints: readonly RouteWaypoint[];
  // null when the saved-area list could not be loaded; the check then reports unknown rather than
  // pretending an unreadable list means no coverage.
  regions: readonly SavedRegionDto[] | null;
  corridorNm: number;
  detail: DetailKey;
}

export function checkRouteCoverage(input: RouteCoverageInput): RouteCoverageReport {
  const { waypoints, regions, corridorNm, detail } = input;
  const base = {
    corridorNm,
    detail,
    sampleCount: 0,
    uncoveredCount: 0,
    detailShortCount: 0,
    gaps: [] as GeoJSON.Feature[],
  };
  if (waypoints.length < 2) {
    return { ...base, verdict: 'unknown', unknownReason: 'The route has fewer than two points.' };
  }
  if (regions === null) {
    return { ...base, verdict: 'unknown', unknownReason: 'Saved areas could not be loaded.' };
  }
  const ready: ReadyRegion[] = regions
    .filter((region) => region.status === 'ready')
    .map((region) => ({ region, parts: regionParts(region.bbox) }));
  const requiredMaxzoom = rangeForPreset(detail)[1];
  const corridorM = nauticalMilesToMeters(corridorNm);

  // Total rhumb length first, so the along-route spacing respects the sample budget.
  let totalM = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    totalM += rhumbDistanceMeters(waypoints[i - 1].position, waypoints[i].position);
  }
  if (!(totalM > 0)) {
    return { ...base, verdict: 'unknown', unknownReason: 'The route has no length.' };
  }
  const stepM = Math.max(corridorM / 2, totalM / MAX_COVERAGE_SAMPLES);

  let sampleCount = 0;
  let uncoveredCount = 0;
  let detailShortCount = 0;
  // Contiguous gap runs, merged as they are found so the overlay draws one feature per run.
  const runs: Array<{ kind: CoverageGapKind; coordinates: [number, number][] }> = [];
  let previousClass: SampleClass | undefined;
  let previousPoint: [number, number] | undefined;

  const record = (cls: SampleClass, lon: number, lat: number): void => {
    sampleCount += 1;
    if (cls === UNCOVERED) uncoveredCount += 1;
    else if (cls === DETAIL_SHORT) detailShortCount += 1;
    const point: [number, number] = [wrapLongitude(lon), lat];
    if (previousPoint !== undefined && previousClass !== undefined) {
      const segmentClass = Math.max(cls, previousClass) as SampleClass;
      if (segmentClass !== COVERED) {
        const kind: CoverageGapKind =
          segmentClass === UNCOVERED ? 'uncovered' : 'insufficient-detail';
        const last = runs.at(-1);
        if (last && last.kind === kind && last.coordinates.at(-1) === previousPoint) {
          last.coordinates.push(point);
        } else {
          runs.push({ kind, coordinates: [previousPoint, point] });
        }
      }
    }
    previousClass = cls;
    previousPoint = point;
  };

  for (let i = 1; i < waypoints.length; i += 1) {
    const from = waypoints[i - 1].position;
    const to = waypoints[i].position;
    const legM = rhumbDistanceMeters(from, to);
    if (!(legM > 0)) continue;
    const bearing = rhumbBearingRad(from, to);
    // Interpolate on latitude and the seam-unwrapped longitude, matching the short visual leg the
    // route overlay draws.
    let deltaLon = to.longitude - from.longitude;
    if (deltaLon > 180) deltaLon -= 360;
    if (deltaLon < -180) deltaLon += 360;
    const steps = Math.max(1, Math.ceil(legM / stepM));
    for (let s = 0; s <= steps; s += 1) {
      // Leg interiors sample s >= 1 only, so shared waypoints are not double-counted; the very
      // first waypoint of the route is the one s = 0 that must be recorded.
      if (s === 0 && i > 1) continue;
      const t = s / steps;
      const lat = from.latitude + (to.latitude - from.latitude) * t;
      const lon = from.longitude + deltaLon * t;
      // The corridor at this point: the route line and its two edges abeam.
      const port = geodesicDestination(lat, wrapLongitude(lon), bearing - Math.PI / 2, corridorM);
      const starboard = geodesicDestination(
        lat,
        wrapLongitude(lon),
        bearing + Math.PI / 2,
        corridorM,
      );
      const cls = Math.max(
        classifyPoint(lat, lon, ready, requiredMaxzoom),
        classifyPoint(port[1], port[0], ready, requiredMaxzoom),
        classifyPoint(starboard[1], starboard[0], ready, requiredMaxzoom),
      ) as SampleClass;
      record(cls, lon, lat);
    }
  }

  const gaps: GeoJSON.Feature[] = runs.map((run) => ({
    type: 'Feature',
    geometry: antimeridianLineGeometry(run.coordinates),
    properties: { kind: run.kind },
  }));

  const verdict: CoverageVerdict = uncoveredCount + detailShortCount === 0 ? 'complete' : 'partial';
  return {
    ...base,
    verdict,
    sampleCount,
    uncoveredCount,
    detailShortCount,
    gaps,
  };
}
