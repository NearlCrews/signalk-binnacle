import type { LineLayerSpecification } from 'maplibre-gl';
import { isLatLon, latLonToLonLat } from '$shared/geo';
import { MINUTE_MS } from '$shared/lib';
import {
  antimeridianLineGeometry,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import {
  columnIndex,
  fetchHistoryValuesAcrossProviders,
  HISTORY_RESOLUTION_SECONDS,
  HISTORY_WINDOW_SECONDS,
  type HistoryProviders,
  type HistoryValues,
  SK_PATHS,
} from '$shared/signalk';

const SOURCE_ID = 'binnacle-track-history';
const LAYER_ID = 'binnacle-track-history-line';
const BAND = 'track';
// Dashed and faded so the server-recorded past stays visually behind the live track line.
const LINE_WIDTH = 2;
const LINE_OPACITY = 0.6;
const DASH = [2, 2];
const REFRESH_MS = 15 * MINUTE_MS;
// A break longer than this between positions starts a new line segment, so a day at the dock
// followed by a sail does not draw a straight line across the gap.
const GAP_SECONDS = 15 * 60;

interface Deps {
  fetchValues: typeof fetchHistoryValuesAcrossProviders;
  now: () => number;
}

export interface HistoryTrackOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The vessel's last 24 hours from the server's v2 History API, drawn as a dashed line under the
// live track. Registration is unconditional; every fetch is gated on a provider being known, so
// a stock server pays one empty source and nothing else. Hidden by default in the layer panel:
// showing it is the opt-in that starts the queries.
export function createHistoryTrackOverlay(
  origin: string,
  getToken: () => string | undefined,
  providers: () => HistoryProviders | undefined,
  deps: Deps = { fetchValues: fetchHistoryValuesAcrossProviders, now: Date.now },
): HistoryTrackOverlay {
  let paint = mapThemePaint('day');
  let visible = true;
  let fetching = false;
  let nextFetchAt = 0;

  function toFeature(values: HistoryValues): GeoJSON.FeatureCollection {
    const iPos = columnIndex(values, SK_PATHS.position);
    const lines: Array<Array<[number, number]>> = [];
    let line: Array<[number, number]> = [];
    let lastSeconds: number | undefined;
    for (const row of values.rows) {
      const position = iPos >= 0 ? row[iPos + 1] : undefined;
      if (!isLatLon(position)) continue;
      const seconds = Date.parse(row[0]) / 1000;
      // A malformed timestamp yields NaN, which would poison every later gap comparison (NaN
      // compares false) and silently disable gap-splitting for the rest of the track.
      if (!Number.isFinite(seconds)) continue;
      if (lastSeconds !== undefined && seconds - lastSeconds > GAP_SECONDS) {
        if (line.length > 1) lines.push(line);
        line = [];
      }
      line.push(latLonToLonLat(position));
      lastSeconds = seconds;
    }
    if (line.length > 1) lines.push(line);
    return featureCollection(
      lines.map((coordinates) => ({
        type: 'Feature',
        geometry: antimeridianLineGeometry(coordinates),
        properties: {},
      })),
    );
  }

  async function refresh(ctx: OverlayContext): Promise<void> {
    const known = providers();
    if (!known || known.ids.length === 0 || fetching) return;
    fetching = true;
    try {
      const got = await deps.fetchValues(origin, getToken(), known, {
        paths: [SK_PATHS.position],
        durationSeconds: HISTORY_WINDOW_SECONDS,
        resolutionSeconds: HISTORY_RESOLUTION_SECONDS,
      });
      if (got) setSourceData(ctx.map, SOURCE_ID, toFeature(got.values));
      // A failed query retries on the same cadence; the drawn line stays until then.
      nextFetchAt = deps.now() + REFRESH_MS;
    } finally {
      fetching = false;
    }
  }

  return {
    id: 'track-history',
    title: 'Track history (24 h)',
    description: "Your boat's path over the last 24 hours.",
    band: BAND,
    supportsOpacity: true,
    defaultVisible: false,
    available: () => (providers()?.ids.length ?? 0) > 0,
    unavailableHint: 'Track history needs a Signal K history provider plugin on the server.',
    layerIds: [LAYER_ID],
    add(ctx) {
      nextFetchAt = 0;
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      if (!ctx.map.getLayer(LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.trackSolid,
            'line-width': LINE_WIDTH,
            'line-opacity': LINE_OPACITY,
            'line-dasharray': DASH,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
    },
    sync(ctx) {
      if (!visible) return;
      const now = deps.now();
      if (now < nextFetchAt) return;
      nextFetchAt = now + REFRESH_MS;
      void refresh(ctx);
    },
    setVisible(ctx, next) {
      visible = next;
      setLayersVisibility(ctx.map, [LAYER_ID], next);
      // First show fetches immediately rather than waiting out the refresh window.
      if (next) nextFetchAt = 0;
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', LINE_OPACITY * opacity);
      }
    },
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', paint.trackSolid);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [LAYER_ID], [SOURCE_ID]);
    },
  };
}
