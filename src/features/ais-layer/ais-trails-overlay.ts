import type { LineLayerSpecification } from 'maplibre-gl';

import {
  type Bbox4,
  bboxContains,
  lngLatBoundsToBbox4,
  padBbox,
  VIEWPORT_FETCH_PAD_FRACTION,
} from '$shared/geo';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  rgbaCss,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { type AisTrail, fetchAisTrails } from './ais-trails-client';

const SOURCE_ID = 'binnacle-ais-trails';
const LAYER_ID = 'binnacle-ais-trails-line';
const BAND = 'traffic';
// A wake is a quiet aid behind the AIS symbols: thin and faded so the targets stay the focus, in
// the theme's AIS color so night-red stays in the red band. The opacity slider scales from this.
const TRAIL_OPACITY = 0.45;
const TRAIL_WIDTH = 1.5;
// Fetch only once the viewport has been still this long, so a pan or pinch does not spray requests.
const SETTLE_MS = 400;
// A still viewport refreshes the wakes on this cadence, which also paces retries after a failure.
// The plugin accumulates points at a one-minute default resolution, so fetching fresher buys
// nothing.
const REFETCH_MS = 30_000;
// Consecutive failed refetch cycles before frozen wakes clear (a few minutes of staleness).
const MAX_STALE_FETCHES = 4;

export interface AisTrailsOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// Faded recent-track wakes behind the AIS symbols, served by the tracks plugin
// (@signalk/tracks-plugin). Registration is unconditional: isAvailable gates every fetch and
// render, so a stock server without the plugin pays one empty source and nothing else. The own
// vessel's context is excluded; Binnacle's track feature draws that line.
export function createAisTrailsOverlay(
  base: string,
  getToken: () => string | undefined,
  isAvailable: () => boolean,
  selfContext?: () => string | undefined,
): AisTrailsOverlay {
  let paint = mapThemePaint('day');
  // Starts true to match the layer-manager default; the register-time setVisible corrects it.
  let visible = true;
  let fetching = false;
  let failedFetches = 0;
  let nextFetchAt = 0;
  let fetchedBbox: Bbox4 | undefined;
  let lastMoveAt = 0;
  let lastZoom: number | undefined;
  let lastLng: number | undefined;
  let lastLat: number | undefined;
  // Signature of the trail set last handed to setData ('' for none), so an unchanged steady-state
  // refetch skips the GeoJSON rebuild and a failed fetch keeps the wakes on screen.
  let renderedSignature = '';

  function setData(ctx: OverlayContext, data: GeoJSON.FeatureCollection): void {
    setSourceData(ctx.map, SOURCE_ID, data);
  }

  function render(ctx: OverlayContext, trails: AisTrail[]): void {
    const self = selfContext?.();
    const shown = self ? trails.filter((trail) => trail.context !== self) : trails;
    // Context, point count, and both end points per trail: enough to see a vessel move (the tail
    // advances) or the retained window slide (the head changes), at a fraction of a deep compare.
    let signature = '';
    for (const t of shown) {
      signature += `${t.context};${t.line.length};${t.line[0]};${t.line[t.line.length - 1]}|`;
    }
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    setData(
      ctx,
      featureCollection(
        shown.map(
          (trail): GeoJSON.Feature => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: trail.line },
            properties: { context: trail.context },
          }),
        ),
      ),
    );
  }

  function clearRendered(ctx: OverlayContext): void {
    if (renderedSignature === '') return;
    renderedSignature = '';
    setData(ctx, emptyFeatureCollection());
  }

  function recordFailedFetch(ctx: OverlayContext): void {
    failedFetches += 1;
    if (failedFetches >= MAX_STALE_FETCHES) clearRendered(ctx);
  }

  return {
    id: 'ais-trails',
    title: 'AIS trails',
    description: 'The recent track each AIS vessel has left behind.',
    band: BAND,
    supportsOpacity: true,
    available: isAvailable,
    unavailableHint: 'AIS trails need the signalk-tracks history plugin running on the server.',
    layerIds: [LAYER_ID],
    add(ctx) {
      // Reset so a reattach (a base-style swap recreates the emptied source) refetches and
      // repopulates instead of staying blank behind a stale signature.
      renderedSignature = '';
      fetchedBbox = undefined;
      nextFetchAt = 0;
      lastZoom = undefined;
      lastLng = undefined;
      lastLat = undefined;
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      if (!ctx.map.getLayer(LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': rgbaCss(paint.aisTarget),
            'line-width': TRAIL_WIDTH,
            'line-opacity': TRAIL_OPACITY,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
    },
    sync(ctx) {
      // Hidden pays nothing: no network fetch, no GeoJSON rebuild.
      if (!visible) return;
      if (!isAvailable()) {
        // The plugin can be disabled mid-session; clear any shown wakes so nothing stale lingers.
        clearRendered(ctx);
        return;
      }
      const now = Date.now();
      const zoom = ctx.map.getZoom();
      const center = ctx.map.getCenter();
      if (zoom !== lastZoom || center.lng !== lastLng || center.lat !== lastLat) {
        lastZoom = zoom;
        lastLng = center.lng;
        lastLat = center.lat;
        lastMoveAt = now;
        return;
      }
      if (now - lastMoveAt < SETTLE_MS) return;
      if (fetching) return;
      const viewport: Bbox4 = lngLatBoundsToBbox4(ctx.map.getBounds());
      // Inside the last padded fetch and within the cadence: the shown wakes are current enough.
      // A viewport that left that area fetches as soon as it settles.
      if (now < nextFetchAt && fetchedBbox && bboxContains(fetchedBbox, viewport)) return;
      fetching = true;
      // Claim the cadence and the area up front, so a failed fetch backs off for a full interval
      // instead of retrying every frame (the notes cooldown pattern).
      nextFetchAt = now + REFETCH_MS;
      const fetchBbox = padBbox(viewport, VIEWPORT_FETCH_PAD_FRACTION);
      fetchedBbox = fetchBbox;
      void fetchAisTrails(base, getToken(), fetchBbox)
        .then((trails) => {
          if (trails) {
            failedFetches = 0;
            render(ctx, trails);
            return;
          }
          // undefined is a transient failure or an absent plugin: keep the wakes already shown,
          // but not forever. Live targets keep advancing while frozen wakes silently age, so
          // after a few consecutive failed cycles (a couple of minutes) the wakes clear rather
          // than presenting hours-old history as recent.
          recordFailedFetch(ctx);
        })
        .catch(() => {
          recordFailedFetch(ctx);
        })
        .finally(() => {
          fetching = false;
        });
    },
    applyTheme(ctx, next) {
      paint = next;
      ctx.map.setPaintProperty(LAYER_ID, 'line-color', rgbaCss(paint.aisTarget));
    },
    setVisible(ctx, isVisible) {
      visible = isVisible;
      setLayersVisibility(ctx.map, [LAYER_ID], isVisible);
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', opacity * TRAIL_OPACITY);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [LAYER_ID], [SOURCE_ID]);
    },
  };
}
