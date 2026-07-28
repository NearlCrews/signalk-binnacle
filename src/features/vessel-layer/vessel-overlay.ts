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
} from '$shared/map';
import { VESSEL_ICON_ID, vesselIconImage } from './vessel-icon';

const SOURCE_ID = 'binnacle-own-vessel';
const LAYER_ID = 'binnacle-own-vessel-symbol';
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day own-vessel color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').ownVessel;

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

  // Heading drives icon-rotate (degrees), falling back to course over ground, then north.
  const resolveHeading = (): number => headingDegrees(vessel.headingRad, vessel.cogRad);

  function buildFeatures(): GeoJSON.FeatureCollection {
    const position = vessel.position;
    if (!position) return emptyFeatureCollection();
    return featureCollection([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: latLonToLonLat(position) },
        properties: { heading: resolveHeading() },
      },
    ]);
  }

  function shouldRefresh(): boolean {
    const position = vessel.position;
    const lon = position?.longitude;
    const lat = position?.latitude;
    const heading = position ? resolveHeading() : undefined;
    if (lon === lastLon && lat === lastLat && heading === lastHeading) return false;
    lastLon = lon;
    lastLat = lat;
    lastHeading = heading;
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
    overlay.setOpacity?.(ctx, acceptedOpacity * (reviewActive() ? REVIEW_DIM_OPACITY : 1));
  }

  return {
    ...overlay,
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
    reset() {
      lastReviewActive = undefined;
      overlay.reset?.();
    },
  };
}
