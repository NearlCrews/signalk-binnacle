import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type {
  CurrentReading,
  NearbyTideStation,
  TideReading,
  TideStation,
  TideStationKind,
  TideStationSelection,
  TidesStore,
} from '$entities/tides';
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
import { createTideHitHandlers, type TideStationSelectionEvent } from './tides-hit-handlers';
import {
  TIDES_CURRENT_LAYER,
  TIDES_GLYPH_LAYER,
  TIDES_HIT_LAYER,
  TIDES_LABEL_LAYER,
  TIDES_LAYERS,
  TIDES_SELECTED_LAYER,
  TIDES_SOURCE_ID,
  TIDES_TIDE_LAYER,
  TIDES_VISUAL_LAYERS,
} from './tides-overlay-layers';

// The overlay id, which is also the layer's persisted LayerSettings key. The starter profiles
// raise it by literal (a feature must not import a sibling feature), pinned by the
// starter-overlay-ids seam test in widgets/chart-canvas.
export const TIDES_OVERLAY_ID = 'tides';

interface TidesOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

interface RenderStation {
  kind: TideStationKind;
  station: TideStation;
  selected: boolean;
  loaded: boolean;
  reading?: TideReading | CurrentReading;
}

interface TideFeatureProperties {
  stationId: string;
  stationName: string;
  stationLatitude: number;
  stationLongitude: number;
  kind: TideStationKind;
  selectionMode: TideStationSelectionEvent['mode'];
  selected: boolean;
  loaded: boolean;
  glyph: 'T' | 'C';
  label: string;
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
  const tag = next.kind === 'flood' ? 'Flood' : next.kind === 'ebb' ? 'Ebb' : 'Slack';
  return `${reading.station.name}\n${tag} ${formatCurrentRate(next.velocityMps)} ${formatClockTime(next.timeMs)}`;
}

function addCandidate(
  stations: Map<string, RenderStation>,
  kind: TideStationKind,
  station: TideStation,
): RenderStation {
  const key = `${kind}:${station.id}`;
  const existing = stations.get(key);
  if (existing) return existing;
  const candidate = { kind, station, selected: false, loaded: false };
  stations.set(key, candidate);
  return candidate;
}

function addNearby(
  stations: Map<string, RenderStation>,
  kind: TideStationKind,
  nearby: NearbyTideStation[],
): void {
  for (const candidate of nearby) addCandidate(stations, kind, candidate.station);
}

function addSelected(
  stations: Map<string, RenderStation>,
  kind: TideStationKind,
  selection: TideStationSelection,
): void {
  if (selection.mode === 'manual') {
    addCandidate(stations, kind, selection.station).selected = true;
  }
}

function addReading(
  stations: Map<string, RenderStation>,
  kind: TideStationKind,
  reading: TideReading | CurrentReading | undefined,
): void {
  if (!reading) return;
  const candidate = addCandidate(stations, kind, reading.station);
  candidate.loaded = true;
  candidate.reading = reading;
}

function collectRenderStations(store: TidesStore): Map<string, RenderStation> {
  const stations = new Map<string, RenderStation>();
  addNearby(stations, 'tide', store.nearbyTideStations);
  addNearby(stations, 'current', store.nearbyCurrentStations);
  addSelected(stations, 'tide', store.requestedTide);
  addSelected(stations, 'current', store.requestedCurrent);
  addReading(stations, 'tide', store.tide);
  addReading(stations, 'current', store.current);
  return stations;
}

function renderStationFeatures(
  store: TidesStore,
  stations: Map<string, RenderStation>,
  nowMs: number,
  mode: UnitsMode,
): GeoJSON.FeatureCollection {
  return featureCollection(
    [...stations.values()].map((candidate) => {
      let label = '';
      if (candidate.reading) {
        label =
          candidate.kind === 'tide'
            ? tideLabel(candidate.reading as TideReading, nowMs, mode)
            : currentLabel(candidate.reading as CurrentReading, nowMs);
      }
      return {
        type: 'Feature' as const,
        id: `${candidate.kind}:${candidate.station.id}`,
        geometry: {
          type: 'Point' as const,
          coordinates: latLonToLonLat(candidate.station),
        },
        properties: {
          stationId: candidate.station.id,
          stationName: candidate.station.name,
          stationLatitude: candidate.station.latitude,
          stationLongitude: candidate.station.longitude,
          kind: candidate.kind,
          // A requested manual station wins even when it shares the retained signalk-tides id.
          // Otherwise only the plugin's live tide reading represents automatic selection.
          selectionMode:
            candidate.selected ||
            candidate.kind !== 'tide' ||
            store.source !== 'signalk-tides' ||
            store.tide?.station.id !== candidate.station.id
              ? 'manual'
              : 'automatic',
          selected: candidate.selected,
          loaded: candidate.loaded,
          glyph: candidate.kind === 'tide' ? 'T' : 'C',
          label,
        },
      } satisfies GeoJSON.Feature<GeoJSON.Point, TideFeatureProperties>;
    }),
  );
}

export function tideStationFeatures(
  store: TidesStore,
  nowMs: number,
  mode: UnitsMode,
): GeoJSON.FeatureCollection {
  return renderStationFeatures(store, collectRenderStations(store), nowMs, mode);
}

// Render the bounded nearby NOAA catalog plus any selected or loaded station that has moved outside
// it. A transparent 44 px circle owns hit testing; visual opacity zero and hidden state also hide
// that hit layer so an invisible tide overlay never intercepts the chart.
export function createTidesOverlay(
  store: TidesStore,
  units: UnitsStore,
  onSelect?: (selection: TideStationSelectionEvent) => void,
  now: () => number = Date.now,
  interactionsAllowed: () => boolean = () => true,
): TidesOverlay {
  let theme: Theme = 'day';
  let lastCatalogTide: NearbyTideStation[] | undefined;
  let lastCatalogCurrent: NearbyTideStation[] | undefined;
  let lastRequestedTide: TideStationSelection | undefined;
  let lastRequestedCurrent: TideStationSelection | undefined;
  let lastTide: TideReading | undefined;
  let lastCurrent: CurrentReading | undefined;
  let seeded = false;
  let visible = true;
  let opacity = 1;
  let lastLabelMinute = -1;
  let lastMode: UnitsMode | undefined;
  const hit = createTideHitHandlers(
    store,
    onSelect,
    () => visible && opacity > 0 && interactionsAllowed(),
  );

  const syncHitVisibility = (ctx: OverlayContext): void => {
    setLayersVisibility(ctx.map, [TIDES_HIT_LAYER], visible && opacity > 0);
    // The label is also an interaction surface. Hide it at zero opacity so invisible text cannot
    // retain a delegated hit region or pointer cursor.
    setLayersVisibility(ctx.map, [TIDES_LABEL_LAYER], visible && opacity > 0);
    hit.refreshInteractionState();
  };

  return {
    id: TIDES_OVERLAY_ID,
    title: 'Tide stations',
    description: 'Markers for nearby tide and current stations you can tap for predictions.',
    band: 'safety',
    category: 'reference',
    region: 'US',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: TIDES_LAYERS,
    reset() {
      // Map listeners survive a style swap. Keep them attached, but force the recreated source to
      // repopulate even when store identities have not changed.
      seeded = false;
      lastCatalogTide = undefined;
      lastCatalogCurrent = undefined;
      lastRequestedTide = undefined;
      lastRequestedCurrent = undefined;
      lastTide = undefined;
      lastCurrent = undefined;
      lastLabelMinute = -1;
      lastMode = undefined;
    },
    add(ctx) {
      const paint = mapThemePaint(theme);
      const before = ctx.beforeIdFor('safety');
      ensureGeoJsonSource(ctx.map, TIDES_SOURCE_ID);

      const selected: CircleLayerSpecification = {
        id: TIDES_SELECTED_LAYER,
        type: 'circle',
        source: TIDES_SOURCE_ID,
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'circle-radius': 11,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': paint.select,
          'circle-stroke-width': 3,
        },
      };
      if (!ctx.map.getLayer(TIDES_SELECTED_LAYER)) ctx.map.addLayer(selected, before);

      const tideMarker: CircleLayerSpecification = {
        id: TIDES_TIDE_LAYER,
        type: 'circle',
        source: TIDES_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'tide'],
        paint: {
          'circle-radius': 7,
          'circle-color': paint.tide,
          'circle-stroke-color': paint.background,
          'circle-stroke-width': 2,
        },
      };
      if (!ctx.map.getLayer(TIDES_TIDE_LAYER)) ctx.map.addLayer(tideMarker, before);

      const currentMarker: CircleLayerSpecification = {
        id: TIDES_CURRENT_LAYER,
        type: 'circle',
        source: TIDES_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'current'],
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': paint.tide,
          'circle-stroke-width': 2,
        },
      };
      if (!ctx.map.getLayer(TIDES_CURRENT_LAYER)) ctx.map.addLayer(currentMarker, before);

      const glyphColor = [
        'match',
        ['get', 'kind'],
        'tide',
        paint.markerGlyph,
        paint.tide,
      ] as ExpressionSpecification;
      const glyph: SymbolLayerSpecification = {
        id: TIDES_GLYPH_LAYER,
        type: 'symbol',
        source: TIDES_SOURCE_ID,
        layout: {
          'text-field': ['get', 'glyph'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 9,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': glyphColor },
      };
      if (!ctx.map.getLayer(TIDES_GLYPH_LAYER)) ctx.map.addLayer(glyph, before);

      const label: SymbolLayerSpecification = {
        id: TIDES_LABEL_LAYER,
        type: 'symbol',
        source: TIDES_SOURCE_ID,
        filter: ['!=', ['get', 'label'], ''],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.25],
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
      if (!ctx.map.getLayer(TIDES_LABEL_LAYER)) ctx.map.addLayer(label, before);

      const hitTarget: CircleLayerSpecification = {
        id: TIDES_HIT_LAYER,
        type: 'circle',
        source: TIDES_SOURCE_ID,
        paint: {
          // A 22 px radius is a 44 px touch target. Near-transparent color keeps it invisible while
          // the minimal alpha keeps MapLibre from optimizing it out of rendered-feature hit testing.
          // The separate layout-visibility gate controls whether it intercepts input.
          'circle-radius': 22,
          'circle-color': 'rgba(0,0,0,0.01)',
        },
      };
      if (!ctx.map.getLayer(TIDES_HIT_LAYER)) ctx.map.addLayer(hitTarget, before);
      hit.attach(ctx);
      syncHitVisibility(ctx);
    },
    sync(ctx) {
      if (!ctx.map.getSource(TIDES_SOURCE_ID)) {
        seeded = false;
        return;
      }
      const nearbyTideStations = store.nearbyTideStations;
      const nearbyCurrentStations = store.nearbyCurrentStations;
      const requestedTide = store.requestedTide;
      const requestedCurrent = store.requestedCurrent;
      const tide = store.tide;
      const current = store.current;
      const mode = units.mode;
      const nowMs = now();
      const minute = Math.floor(nowMs / MINUTE_MS);
      if (
        seeded &&
        nearbyTideStations === lastCatalogTide &&
        nearbyCurrentStations === lastCatalogCurrent &&
        requestedTide === lastRequestedTide &&
        requestedCurrent === lastRequestedCurrent &&
        tide === lastTide &&
        current === lastCurrent &&
        minute === lastLabelMinute &&
        mode === lastMode
      ) {
        return;
      }
      seeded = true;
      lastCatalogTide = nearbyTideStations;
      lastCatalogCurrent = nearbyCurrentStations;
      lastRequestedTide = requestedTide;
      lastRequestedCurrent = requestedCurrent;
      lastTide = tide;
      lastCurrent = current;
      lastLabelMinute = minute;
      lastMode = mode;
      const stations = collectRenderStations(store);
      setSourceData(ctx.map, TIDES_SOURCE_ID, renderStationFeatures(store, stations, nowMs, mode));
    },
    setVisible(ctx, isVisible) {
      visible = isVisible;
      setLayersVisibility(ctx.map, TIDES_VISUAL_LAYERS, isVisible);
      syncHitVisibility(ctx);
    },
    setOpacity(ctx, nextOpacity) {
      opacity = nextOpacity;
      ctx.map.setPaintProperty(TIDES_SELECTED_LAYER, 'circle-stroke-opacity', nextOpacity);
      ctx.map.setPaintProperty(TIDES_TIDE_LAYER, 'circle-opacity', nextOpacity);
      ctx.map.setPaintProperty(TIDES_TIDE_LAYER, 'circle-stroke-opacity', nextOpacity);
      ctx.map.setPaintProperty(TIDES_CURRENT_LAYER, 'circle-stroke-opacity', nextOpacity);
      ctx.map.setPaintProperty(TIDES_GLYPH_LAYER, 'text-opacity', nextOpacity);
      ctx.map.setPaintProperty(TIDES_LABEL_LAYER, 'text-opacity', nextOpacity);
      syncHitVisibility(ctx);
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      ctx.map.setPaintProperty(TIDES_SELECTED_LAYER, 'circle-stroke-color', paint.select);
      ctx.map.setPaintProperty(TIDES_TIDE_LAYER, 'circle-color', paint.tide);
      ctx.map.setPaintProperty(TIDES_TIDE_LAYER, 'circle-stroke-color', paint.background);
      ctx.map.setPaintProperty(TIDES_CURRENT_LAYER, 'circle-stroke-color', paint.tide);
      ctx.map.setPaintProperty(TIDES_GLYPH_LAYER, 'text-color', [
        'match',
        ['get', 'kind'],
        'tide',
        paint.markerGlyph,
        paint.tide,
      ]);
      ctx.map.setPaintProperty(TIDES_LABEL_LAYER, 'text-color', paint.tide);
      ctx.map.setPaintProperty(TIDES_LABEL_LAYER, 'text-halo-color', paint.background);
    },
    remove(ctx) {
      visible = false;
      hit.detach(ctx);
      removeLayersAndSources(ctx.map, TIDES_LAYERS, [TIDES_SOURCE_ID]);
    },
  };
}
