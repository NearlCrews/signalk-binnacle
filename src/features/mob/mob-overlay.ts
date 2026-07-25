import type {
  CircleLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { MobStore } from '$entities/mob';
import type { OwnVessel } from '$entities/vessel';
import { type LatLon, latLonToLonLat } from '$shared/geo';
import {
  antimeridianLineGeometry,
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

const SRC = 'binnacle-mob';
const LINE_LAYER = 'binnacle-mob-line';
const MARKER_LAYER = 'binnacle-mob-marker';
const LABEL_LAYER = 'binnacle-mob-label';
const LAYERS = [LINE_LAYER, MARKER_LAYER, LABEL_LAYER];

// The chart pins this with the collision ring so no chart layer or traffic can ever hide an
// active MOB mark; exported so the pinned list references the same constant.
export const MOB_OVERLAY_ID = 'mob';

function features(mark: LatLon | undefined, vessel: LatLon | undefined): GeoJSON.FeatureCollection {
  if (!mark) return emptyFeatureCollection();
  const out: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: latLonToLonLat(mark) },
      properties: {},
    },
  ];
  if (vessel) {
    out.push({
      type: 'Feature',
      geometry: antimeridianLineGeometry([latLonToLonLat(vessel), latLonToLonLat(mark)]),
      properties: { line: true },
    });
  }
  return featureCollection(out);
}

export interface MobOverlay extends OverlayModule, Syncable {}

// The man-overboard mark: an alarm-colored marker labeled MOB and a straight line from the boat
// back to it, the on-chart counterpart of the strip's bearing and range.
export function createMobOverlay(mob: MobStore, vessel: OwnVessel): MobOverlay {
  let paint = mapThemePaint('day');
  let lastMark: LatLon | undefined;
  let lastVessel: LatLon | undefined;
  let needsRedraw = false;

  // Invalidate the change-detection cache so the next sync repopulates from scratch. The manager
  // calls this on a base-style swap, which recreates the source empty; add() calls it so a fresh
  // add draws too.
  function reset(): void {
    needsRedraw = true;
  }

  return {
    id: MOB_OVERLAY_ID,
    title: 'Man overboard',
    band: 'vessel',
    supportsOpacity: false,
    layerIds: LAYERS,
    add(ctx) {
      const { map } = ctx;
      const before = ctx.beforeIdFor('vessel');
      ensureGeoJsonSource(map, SRC);
      if (!map.getLayer(LINE_LAYER)) {
        const layer: LineLayerSpecification = {
          id: LINE_LAYER,
          type: 'line',
          source: SRC,
          filter: ['has', 'line'],
          paint: { 'line-color': paint.danger, 'line-width': 2 },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(MARKER_LAYER)) {
        const layer: CircleLayerSpecification = {
          id: MARKER_LAYER,
          type: 'circle',
          source: SRC,
          filter: ['!', ['has', 'line']],
          paint: {
            'circle-radius': 9,
            'circle-color': paint.danger,
            'circle-stroke-color': paint.markerGlyph,
            'circle-stroke-width': 2,
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(LABEL_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: LABEL_LAYER,
          type: 'symbol',
          source: SRC,
          filter: ['!', ['has', 'line']],
          layout: {
            'text-field': 'MOB',
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-offset': [0, 1.4],
            'text-optional': true,
          },
          paint: {
            'text-color': paint.danger,
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
      const mark = mob.position;
      const boat = vessel.position;
      if (!needsRedraw && mark === lastMark && boat === lastVessel) return;
      needsRedraw = false;
      lastMark = mark;
      lastVessel = boat;
      setSourceData(ctx.map, SRC, features(mark, boat));
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    applyTheme(ctx, next) {
      paint = next;
      ctx.map.setPaintProperty(LINE_LAYER, 'line-color', paint.danger);
      ctx.map.setPaintProperty(MARKER_LAYER, 'circle-color', paint.danger);
      ctx.map.setPaintProperty(MARKER_LAYER, 'circle-stroke-color', paint.markerGlyph);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-color', paint.danger);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-halo-color', paint.background);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, [SRC]);
    },
  };
}
