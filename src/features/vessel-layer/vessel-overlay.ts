import type { OwnVessel } from '$entities/vessel';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import {
  createSymbolOverlay,
  emptyFeatureCollection,
  featureCollection,
  mapThemePaint,
  type Rgba,
  type SymbolOverlay,
  setLayersVisibility,
  setMapImage,
} from '$shared/map';
import { staleVesselBadgeImage, VESSEL_ICON_ID, vesselIconImage } from './vessel-icon';

const SOURCE_ID = 'binnacle-own-vessel';
const LAYER_ID = 'binnacle-own-vessel-symbol';
const STALE_LAYER_ID = 'binnacle-own-vessel-stale';
const STALE_ICON_ID = 'binnacle-vessel-stale-badge';
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day own-vessel color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').ownVessel;
const DEFAULT_STALE_COLOR = mapThemePaint('day').warning;

// The overlay id. The chart pins this on top so a chart or traffic can never hide the boat; exported
// so the pinned list references the same constant instead of a literal that could drift on a rename.
export const OWN_VESSEL_OVERLAY_ID = 'own-vessel';
const REVIEW_DIM_OPACITY = 0.35;

export function createVesselOverlay(
  vessel: OwnVessel,
  reviewActive: () => boolean = () => false,
): SymbolOverlay {
  let lastLon: number | undefined;
  let lastLat: number | undefined;
  let lastHeading: number | undefined;
  let lastStale: boolean | undefined;

  // Heading drives icon-rotate (degrees), falling back to course over ground, then north.
  const resolveHeading = (): number => headingDegrees(vessel.headingRad, vessel.cogRad);

  function buildFeatures(): GeoJSON.FeatureCollection {
    const position = vessel.position;
    if (!position) return emptyFeatureCollection();
    return featureCollection([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: latLonToLonLat(position) },
        properties: { heading: resolveHeading(), stale: vessel.positionStale },
      },
    ]);
  }

  function shouldRefresh(): boolean {
    const position = vessel.position;
    const lon = position?.longitude;
    const lat = position?.latitude;
    const heading = position ? resolveHeading() : undefined;
    const stale = vessel.positionStale;
    if (lon === lastLon && lat === lastLat && heading === lastHeading && stale === lastStale) {
      return false;
    }
    lastLon = lon;
    lastLat = lat;
    lastHeading = heading;
    lastStale = stale;
    return true;
  }

  const overlay = createSymbolOverlay({
    id: OWN_VESSEL_OVERLAY_ID,
    title: 'Own vessel',
    band: 'vessel',
    sourceId: SOURCE_ID,
    layerId: LAYER_ID,
    iconId: VESSEL_ICON_ID,
    iconImage: vesselIconImage,
    pixelRatio: 2,
    defaultColor: DEFAULT_COLOR,
    paintColor: (paint) => paint.ownVessel,
    features: buildFeatures,
    shouldRefresh,
  });
  let acceptedOpacity = 1;
  let lastReviewActive: boolean | undefined;

  function applyOpacity(ctx: Parameters<NonNullable<SymbolOverlay['setOpacity']>>[0]): void {
    const opacity = acceptedOpacity * (reviewActive() ? REVIEW_DIM_OPACITY : 1);
    overlay.setOpacity?.(ctx, opacity);
    if (ctx.map.getLayer(STALE_LAYER_ID)) {
      ctx.map.setPaintProperty(STALE_LAYER_ID, 'icon-opacity', opacity);
    }
  }

  return {
    ...overlay,
    layerIds: [LAYER_ID, STALE_LAYER_ID],
    async add(ctx) {
      await overlay.add(ctx);
      setMapImage(ctx.map, STALE_ICON_ID, staleVesselBadgeImage(DEFAULT_STALE_COLOR), 2);
      if (!ctx.map.getLayer(STALE_LAYER_ID)) {
        ctx.map.addLayer(
          {
            id: STALE_LAYER_ID,
            type: 'symbol',
            source: SOURCE_ID,
            filter: ['==', ['get', 'stale'], true],
            layout: {
              'icon-image': STALE_ICON_ID,
              'icon-rotation-alignment': 'viewport',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          },
          ctx.beforeIdFor('vessel'),
        );
      }
    },
    sync(ctx) {
      overlay.sync(ctx);
      const reviewing = reviewActive();
      if (reviewing === lastReviewActive) return;
      lastReviewActive = reviewing;
      applyOpacity(ctx);
    },
    setOpacity(ctx, opacity) {
      acceptedOpacity = opacity;
      applyOpacity(ctx);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [LAYER_ID, STALE_LAYER_ID], visible);
    },
    applyTheme(ctx, paint) {
      overlay.applyTheme?.(ctx, paint);
      setMapImage(ctx.map, STALE_ICON_ID, staleVesselBadgeImage(paint.warning), 2);
    },
    remove(ctx) {
      if (ctx.map.getLayer(STALE_LAYER_ID)) ctx.map.removeLayer(STALE_LAYER_ID);
      if (ctx.map.hasImage(STALE_ICON_ID)) ctx.map.removeImage(STALE_ICON_ID);
      overlay.remove(ctx);
    },
    reset() {
      lastStale = undefined;
      lastReviewActive = undefined;
      overlay.reset?.();
    },
  };
}
