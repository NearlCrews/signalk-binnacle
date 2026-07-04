import type { CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { CurrentReading, TideReading, TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import { latLonToLonLat } from '$shared/geo';
import { formatClockTime, MINUTE_MS, type UnitsMode } from '$shared/lib';
import {
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import {
  formatCurrentRate,
  formatTideHeight,
  nextCurrentEvent,
  nextTideEvent,
} from './tides-display';

const SOURCE_ID = 'binnacle-tides';
const CIRCLE_LAYER = 'binnacle-tides-circle';
const LABEL_LAYER = 'binnacle-tides-label';
const LAYERS = [CIRCLE_LAYER, LABEL_LAYER];

interface TidesOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The marker label: the station name, then the next high or low with its height and time.
function tideLabel(reading: TideReading, nowMs: number, mode: UnitsMode): string {
  const next = nextTideEvent(reading.events, nowMs);
  if (!next) return reading.station.name;
  const tag = next.kind === 'high' ? 'High' : 'Low';
  return `${reading.station.name}\n${tag} ${formatTideHeight(next.heightMeters, mode)} ${formatClockTime(next.timeMs)}`;
}

function currentLabel(reading: CurrentReading, nowMs: number): string {
  const next = nextCurrentEvent(reading.events, nowMs);
  if (!next) return reading.station.name;
  const tag = next.kind === 'flood' ? 'Flood' : 'Ebb';
  return `${reading.station.name}\n${tag} ${formatCurrentRate(next.velocityMps)} ${formatClockTime(next.timeMs)}`;
}

function features(
  tide: TideReading | undefined,
  current: CurrentReading | undefined,
  nowMs: number,
  mode: UnitsMode,
): GeoJSON.FeatureCollection {
  const list: GeoJSON.Feature[] = [];
  if (tide) {
    list.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: latLonToLonLat(tide.station) },
      properties: { label: tideLabel(tide, nowMs, mode) },
    });
  }
  if (current) {
    list.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: latLonToLonLat(current.station),
      },
      properties: { label: currentLabel(current, nowMs) },
    });
  }
  return featureCollection(list);
}

// A small overlay marking the nearest tide and tidal-current stations, each labeled with its next
// event. It is driven by the store (the loader pushes readings in), not by the viewport, and only
// rebuilds when the readings change. Point and text layers, so they theme cleanly to night-red.
// The clock is injectable so a test can drive the minute rollover without real time, matching the
// CollisionMute pattern; production callers take the Date.now default.
export function createTidesOverlay(
  store: TidesStore,
  units: UnitsStore,
  now: () => number = Date.now,
): TidesOverlay {
  let theme: Theme = 'day';
  let lastTide: TideReading | undefined;
  let lastCurrent: CurrentReading | undefined;
  let seeded = false;
  // The minute the labels were last baked for. The "next event" text depends on the clock, not
  // just the readings, so a label is refreshed when the minute turns over rather than showing a
  // past event for hours on a stationary boat. The unit preference is baked in the same way, so
  // a mode flip refreshes the labels too.
  let lastLabelMinute = -1;
  let lastMode: UnitsMode | undefined;

  return {
    id: 'tides',
    title: 'Tide stations',
    description: 'Markers for nearby tide and current stations you can tap for predictions.',
    band: 'safety',
    category: 'reference',
    region: 'US',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: LAYERS,
    reset() {
      // The manager calls this on a base-style swap, which recreated the source emptied, so the next
      // sync repopulates the stations rather than early-returning on unchanged readings.
      seeded = false;
      lastTide = undefined;
      lastCurrent = undefined;
      lastLabelMinute = -1;
      lastMode = undefined;
    },
    add(ctx) {
      const paint = mapThemePaint(theme);
      const before = ctx.beforeIdFor('safety');
      ensureGeoJsonSource(ctx.map, SOURCE_ID);

      const circle: CircleLayerSpecification = {
        id: CIRCLE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': 6,
          'circle-color': paint.tide,
          'circle-stroke-color': paint.background,
          'circle-stroke-width': 2,
        },
      };
      if (!ctx.map.getLayer(CIRCLE_LAYER)) ctx.map.addLayer(circle, before);

      const label: SymbolLayerSpecification = {
        id: LABEL_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 12,
        },
        paint: {
          'text-color': paint.tide,
          'text-halo-color': paint.background,
          'text-halo-width': 1.2,
        },
      };
      if (!ctx.map.getLayer(LABEL_LAYER)) ctx.map.addLayer(label, before);
    },
    sync(ctx) {
      const tide = store.tide;
      const current = store.current;
      const mode = units.mode;
      const nowMs = now();
      const minute = Math.floor(nowMs / MINUTE_MS);
      if (
        seeded &&
        tide === lastTide &&
        current === lastCurrent &&
        minute === lastLabelMinute &&
        mode === lastMode
      ) {
        return;
      }
      seeded = true;
      lastTide = tide;
      lastCurrent = current;
      lastLabelMinute = minute;
      lastMode = mode;
      setSourceData(ctx.map, SOURCE_ID, features(tide, current, nowMs, mode));
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(CIRCLE_LAYER, 'circle-opacity', opacity);
      ctx.map.setPaintProperty(CIRCLE_LAYER, 'circle-stroke-opacity', opacity);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-opacity', opacity);
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      ctx.map.setPaintProperty(CIRCLE_LAYER, 'circle-color', paint.tide);
      ctx.map.setPaintProperty(CIRCLE_LAYER, 'circle-stroke-color', paint.background);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-color', paint.tide);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-halo-color', paint.background);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, [SOURCE_ID]);
    },
  };
}
