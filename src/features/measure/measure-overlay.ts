import type {
  CircleLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { MeasureStore } from '$entities/measure';
import { type LatLon, latLonToLonLat } from '$shared/geo';
import { formatMetersOrNm, type UnitsMode } from '$shared/lib';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayModule,
  removeLayersAndSources,
  type Syncable,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { normalizeLonDeltaDeg } from '$shared/nav';

const SRC = 'binnacle-measure';
const LINE_LAYER = 'binnacle-measure-line';
const VERTEX_LAYER = 'binnacle-measure-vertex';
const LABEL_LAYER = 'binnacle-measure-label';
const LAYERS = [LINE_LAYER, VERTEX_LAYER, LABEL_LAYER];

function features(measure: MeasureStore, mode: UnitsMode): GeoJSON.FeatureCollection {
  const points = measure.points;
  if (points.length === 0) return emptyFeatureCollection();
  const coordinates: [number, number][] = [];
  for (const point of points) {
    const [longitude, latitude] = latLonToLonLat(point);
    const priorLongitude = coordinates.at(-1)?.[0];
    coordinates.push([
      priorLongitude === undefined
        ? longitude
        : priorLongitude + normalizeLonDeltaDeg(longitude - priorLongitude),
      latitude,
    ]);
  }
  const out: GeoJSON.Feature[] = coordinates.map((position, index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: position },
    properties:
      // The running total rides on the last vertex, so the chart answers "how far" at the
      // cursor without a glance down at the strip.
      index === coordinates.length - 1 && coordinates.length > 1
        ? { label: formatMetersOrNm(measure.totalMeters, mode) }
        : {},
  }));
  if (coordinates.length > 1) {
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { line: true },
    });
  }
  return featureCollection(out);
}

export interface MeasureOverlay extends OverlayModule, Syncable {}

// The on-chart measurement: tapped vertices, the dashed line through them, and the running total
// labeled at the last point. Renders nothing while no measurement is in progress.
export function createMeasureOverlay(
  measure: MeasureStore,
  units: { mode: UnitsMode },
): MeasureOverlay {
  let paint = mapThemePaint('day');
  let lastPoints: readonly LatLon[] | undefined;
  // The total label bakes in the unit preference, so a mode flip redraws like a point change.
  let lastMode: UnitsMode | undefined;

  // Invalidate the change-detection cache so the next sync repopulates from scratch. The manager
  // calls this on a base-style swap, which recreates the source empty; add() calls it so a fresh
  // add draws too.
  function reset(): void {
    lastPoints = undefined;
  }

  return {
    id: 'measure',
    title: 'Measure',
    band: 'routes',
    listed: false,
    supportsOpacity: true,
    layerIds: LAYERS,
    add(ctx) {
      const { map } = ctx;
      const before = ctx.beforeIdFor('routes');
      ensureGeoJsonSource(map, SRC);
      if (!map.getLayer(LINE_LAYER)) {
        const layer: LineLayerSpecification = {
          id: LINE_LAYER,
          type: 'line',
          source: SRC,
          filter: ['has', 'line'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.select,
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(VERTEX_LAYER)) {
        const layer: CircleLayerSpecification = {
          id: VERTEX_LAYER,
          type: 'circle',
          source: SRC,
          filter: ['!', ['has', 'line']],
          paint: {
            'circle-radius': 5,
            'circle-color': paint.select,
            'circle-stroke-color': paint.markerGlyph,
            'circle-stroke-width': 1.5,
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(LABEL_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: LABEL_LAYER,
          type: 'symbol',
          source: SRC,
          filter: ['has', 'label'],
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-offset': [0, 1.3],
            'text-optional': true,
          },
          paint: {
            'text-color': paint.select,
            'text-halo-color': paint.background,
            'text-halo-width': 1.5,
          },
        };
        map.addLayer(layer, before);
      }
      reset();
    },
    reset,
    sync(ctx) {
      const points = measure.points;
      const mode = units.mode;
      if (points === lastPoints && mode === lastMode) return;
      lastPoints = points;
      lastMode = mode;
      setSourceData(ctx.map, SRC, features(measure, mode));
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(LINE_LAYER, 'line-opacity', opacity);
      ctx.map.setPaintProperty(VERTEX_LAYER, 'circle-opacity', opacity);
      ctx.map.setPaintProperty(VERTEX_LAYER, 'circle-stroke-opacity', opacity);
      // text-opacity fades the halo with the glyphs, so the label needs no halo-specific handling.
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-opacity', opacity);
    },
    applyTheme(ctx, next) {
      paint = next;
      ctx.map.setPaintProperty(LINE_LAYER, 'line-color', paint.select);
      ctx.map.setPaintProperty(VERTEX_LAYER, 'circle-color', paint.select);
      ctx.map.setPaintProperty(VERTEX_LAYER, 'circle-stroke-color', paint.markerGlyph);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-color', paint.select);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-halo-color', paint.background);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, [SRC]);
    },
  };
}
