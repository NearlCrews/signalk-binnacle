import type { LatLon } from '$shared/geo';
import { clamp } from '$shared/lib';
import { emptyFeatureCollection, featureCollection } from '$shared/map';
import { geodesicDestination, haversineMeters, rhumbBearingRad } from '$shared/nav';
import type { MarineRadarStore } from './marine-radar-store.svelte';
import { clockwiseRadarSpan, FULL_CIRCLE_RADIANS, radarAngleInRange } from './radar-angle';
import { radarRectValue, validateRadarRect } from './radar-rect-model';
import { radarSectorValue, validateRadarSector } from './radar-sector-model';
import type {
  ControlDefinition,
  RadarAreaDraft,
  RadarRectValue,
  RadarSectorValue,
  RadarZoneValue,
} from './radar-types';
import { radarZoneValue, validateRadarZone } from './radar-zone-model';

const ARC_STEPS = 48;
const MIN_RECT_WIDTH_METERS = 0.001;

function localPoint(
  center: LatLon,
  point: LatLon,
): { x: number; y: number; distance: number; bearing: number } {
  const distance = haversineMeters(
    center.latitude,
    center.longitude,
    point.latitude,
    point.longitude,
  );
  const bearing = rhumbBearingRad(center, point);
  return {
    x: distance * Math.sin(bearing),
    y: distance * Math.cos(bearing),
    distance,
    bearing,
  };
}

export function updateRadarAreaFromChart(
  draft: RadarAreaDraft,
  definition: ControlDefinition,
  center: LatLon,
  heading: number | undefined,
  point: LatLon,
): RadarAreaDraft {
  const local = localPoint(center, point);
  const relativeBearing = radarAngleInRange(local.bearing - (heading ?? 0), definition.range);
  const maxDistance = definition.maxDistance ?? Number.POSITIVE_INFINITY;

  if (draft.type === 'sector' && 'value' in draft.value && !('startDistance' in draft.value)) {
    const value: RadarSectorValue =
      draft.chartStep === 0
        ? { ...draft.value, value: relativeBearing }
        : { ...draft.value, endValue: relativeBearing };
    return {
      ...draft,
      value,
      chartEditing: draft.chartStep === 0,
      chartStep: draft.chartStep === 0 ? 1 : 0,
    };
  }

  if (draft.type === 'zone' && 'startDistance' in draft.value) {
    const distance = Math.min(local.distance, maxDistance);
    if (draft.chartStep === 0) {
      const value: RadarZoneValue = {
        ...draft.value,
        value: relativeBearing,
        startDistance: distance,
        endDistance: distance,
      };
      return { ...draft, value, chartStep: 1 };
    }
    const secondIsOuter = distance >= draft.value.startDistance;
    const value: RadarZoneValue = secondIsOuter
      ? {
          ...draft.value,
          endValue: relativeBearing,
          endDistance: distance,
        }
      : {
          ...draft.value,
          value: relativeBearing,
          endValue: draft.value.value,
          startDistance: distance,
          endDistance: draft.value.startDistance,
        };
    return { ...draft, value, chartEditing: false, chartStep: 0 };
  }

  if (draft.type === 'rect' && 'x1' in draft.value) {
    const x = clamp(local.x, -maxDistance, maxDistance);
    const y = clamp(local.y, -maxDistance, maxDistance);
    if (draft.chartStep === 0) {
      const value: RadarRectValue = {
        ...draft.value,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
      };
      return { ...draft, value, chartStep: 1 };
    }
    if (draft.chartStep === 1) {
      const edgeLength = Math.hypot(x - draft.value.x1, y - draft.value.y1);
      const seededWidth =
        draft.value.width > MIN_RECT_WIDTH_METERS
          ? draft.value.width
          : clamp(Math.max(5, edgeLength * 0.05), MIN_RECT_WIDTH_METERS, maxDistance);
      const value: RadarRectValue = {
        ...draft.value,
        x2: x,
        y2: y,
        width: seededWidth,
      };
      return { ...draft, value, chartStep: 2 };
    }
    const dx = draft.value.x2 - draft.value.x1;
    const dy = draft.value.y2 - draft.value.y1;
    const edgeLength = Math.hypot(dx, dy);
    const width =
      edgeLength <= MIN_RECT_WIDTH_METERS
        ? draft.value.width
        : Math.abs(((x - draft.value.x1) * dy - (y - draft.value.y1) * dx) / edgeLength);
    const value: RadarRectValue = {
      ...draft.value,
      width: clamp(width, MIN_RECT_WIDTH_METERS, maxDistance),
    };
    return { ...draft, value, chartEditing: false, chartStep: 0 };
  }

  return { ...draft, chartEditing: false, chartStep: 0 };
}

function arcBearings(start: number, end: number): number[] {
  const span = clockwiseRadarSpan(start, end);
  if (span <= 0) return [];
  const steps = Math.min(
    ARC_STEPS,
    Math.max(2, Math.ceil((ARC_STEPS * span) / FULL_CIRCLE_RADIANS)),
  );
  return Array.from({ length: steps + 1 }, (_, index) => start + (span * index) / steps);
}

function polarArea(
  center: LatLon,
  heading: number,
  value: RadarSectorValue | RadarZoneValue,
  innerDistance: number,
  outerDistance: number,
): GeoJSON.Polygon {
  const bearings = arcBearings(value.value, value.endValue);
  if (bearings.length === 0) {
    return { type: 'Polygon', coordinates: [[]] };
  }
  const outer = bearings.map((bearing) =>
    geodesicDestination(center.latitude, center.longitude, heading + bearing, outerDistance),
  );
  const inner =
    innerDistance <= 0
      ? [[center.longitude, center.latitude] as [number, number]]
      : [...bearings]
          .reverse()
          .map((bearing) =>
            geodesicDestination(
              center.latitude,
              center.longitude,
              heading + bearing,
              innerDistance,
            ),
          );
  return { type: 'Polygon', coordinates: [[...outer, ...inner, outer[0]]] };
}

function rectGeometry(center: LatLon, value: RadarRectValue): GeoJSON.Polygon | undefined {
  const dx = value.x2 - value.x1;
  const dy = value.y2 - value.y1;
  const edgeLength = Math.hypot(dx, dy);
  if (edgeLength <= MIN_RECT_WIDTH_METERS || value.width <= 0) return undefined;
  const perpendicularX = dy / edgeLength;
  const perpendicularY = -dx / edgeLength;
  const corners = [
    [value.x1, value.y1],
    [value.x2, value.y2],
    [value.x2 + perpendicularX * value.width, value.y2 + perpendicularY * value.width],
    [value.x1 + perpendicularX * value.width, value.y1 + perpendicularY * value.width],
  ];
  const coordinates = corners.map(([x, y]) =>
    geodesicDestination(center.latitude, center.longitude, Math.atan2(x, y), Math.hypot(x, y)),
  );
  return { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] };
}

function areaFeature(
  controlId: string,
  kind: RadarAreaDraft['type'],
  enabled: boolean,
  active: boolean,
  geometry: GeoJSON.Polygon,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: { controlId, kind, enabled, active },
    geometry,
  };
}

export function radarAreaFeatures(
  store: MarineRadarStore,
  center: LatLon | undefined,
  heading: number | undefined,
  radarRange: number | undefined = store.selected?.range,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!center) return emptyFeatureCollection<GeoJSON.Polygon>();
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const definition of store.capabilities) {
    const active = store.areaDraft?.controlId === definition.id;
    const draft = active ? store.areaDraft : undefined;
    if (definition.type === 'zone') {
      const value =
        draft?.type === 'zone' && 'startDistance' in draft.value
          ? draft.value
          : radarZoneValue(store.controlEntries[definition.id]);
      if (!value || heading === undefined || validateRadarZone(definition, value)) continue;
      features.push(
        areaFeature(
          definition.id,
          'zone',
          value.enabled,
          active,
          polarArea(center, heading, value, value.startDistance, value.endDistance),
        ),
      );
    } else if (definition.type === 'sector') {
      const value =
        draft?.type === 'sector' && 'value' in draft.value && !('startDistance' in draft.value)
          ? draft.value
          : radarSectorValue(store.controlEntries[definition.id]);
      if (
        !value ||
        heading === undefined ||
        radarRange === undefined ||
        !Number.isFinite(radarRange) ||
        radarRange <= 0 ||
        validateRadarSector(definition, value)
      )
        continue;
      features.push(
        areaFeature(
          definition.id,
          'sector',
          value.enabled,
          active,
          polarArea(center, heading, value, 0, radarRange),
        ),
      );
    } else if (definition.type === 'rect') {
      const value =
        draft?.type === 'rect' && 'x1' in draft.value
          ? draft.value
          : radarRectValue(store.controlEntries[definition.id]);
      if (!value || validateRadarRect(definition, value)) continue;
      const geometry = rectGeometry(center, value);
      if (geometry)
        features.push(areaFeature(definition.id, 'rect', value.enabled, active, geometry));
    }
  }
  return featureCollection(features);
}

export function radarAreaChartInstruction(draft: RadarAreaDraft): string {
  if (draft.type === 'sector')
    return draft.chartStep === 0 ? 'Tap the sector start bearing.' : 'Tap the sector end bearing.';
  if (draft.type === 'zone')
    return draft.chartStep === 0 ? 'Tap the inner start corner.' : 'Tap the outer end corner.';
  if (draft.chartStep === 0) return 'Tap the rectangle first corner.';
  if (draft.chartStep === 1) return 'Tap the rectangle second corner.';
  return 'Tap either side of the edge to set the rectangle width.';
}
