import type { LineLayerSpecification } from 'maplibre-gl';

import type { OwnVessel } from '$entities/vessel';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import {
  antimeridianLineGeometry,
  createSymbolOverlay,
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type Rgba,
  removeLayersAndSources,
  rgbaCss,
  type SymbolOverlay,
  setLayersVisibility,
  setMapImage,
  setSourceData,
} from '$shared/map';
import { COG_MIN_SOG_MPS, COURSE_VECTOR_SECONDS, geodesicDestination } from '$shared/nav';
import { staleVesselBadgeImage, VESSEL_ICON_ID, vesselIconImage } from './vessel-icon';

const SOURCE_ID = 'binnacle-own-vessel';
const LAYER_ID = 'binnacle-own-vessel-symbol';
const STALE_LAYER_ID = 'binnacle-own-vessel-stale';
const STALE_ICON_ID = 'binnacle-vessel-stale-badge';
const VECTOR_SOURCE_ID = 'binnacle-own-vessel-vector';
const VECTOR_LAYER_ID = 'binnacle-own-vessel-vector-line';
// The AIS vector styling, so the own-ship predictor reads as the same vocabulary.
const VECTOR_OPACITY = 0.8;
const VECTOR_WIDTH = 2;
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day own-vessel color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').ownVessel;
const DEFAULT_STALE_COLOR = mapThemePaint('day').warning;

// The overlay id. The chart pins this on top so a chart or traffic can never hide the boat; exported
// so the pinned list references the same constant instead of a literal that could drift on a rename.
export const OWN_VESSEL_OVERLAY_ID = 'own-vessel';
const REVIEW_DIM_OPACITY = 0.35;

interface VectorInputs {
  lon: number;
  lat: number;
  cog: number;
  sog: number;
}

export function createVesselOverlay(
  vessel: OwnVessel,
  reviewActive: () => boolean = () => false,
): SymbolOverlay {
  let lastLon: number | undefined;
  let lastLat: number | undefined;
  let lastHeading: number | undefined;
  let lastStale: boolean | undefined;
  let lastVector: VectorInputs | undefined;

  // Heading drives icon-rotate (degrees), falling back to course over ground, then north.
  const resolveHeading = (): number => headingDegrees(vessel.headingRad, vessel.cogRad);

  // The COG predictor's inputs when it should draw, undefined when it should hide. COG and SOG
  // only, never heading: the line is where the boat is going over ground, the icon is where it
  // points. Hidden on any stale input (a frozen prediction is a lie about the future) and below
  // the COG-meaningful speed floor, where GPS scatter owns the reported course.
  function vectorInputs(): VectorInputs | undefined {
    const position = vessel.position;
    if (!position || vessel.positionStale) return undefined;
    const cog = vessel.cogRad;
    if (cog === undefined || vessel.cogStale) return undefined;
    const sog = vessel.sogMps;
    if (sog === undefined || vessel.sogStale || sog < COG_MIN_SOG_MPS) return undefined;
    return { lon: position.longitude, lat: position.latitude, cog, sog };
  }

  function buildVectorFeatures(inputs: VectorInputs): GeoJSON.FeatureCollection {
    const origin: [number, number] = [inputs.lon, inputs.lat];
    const tip = geodesicDestination(
      inputs.lat,
      inputs.lon,
      inputs.cog,
      inputs.sog * COURSE_VECTOR_SECONDS,
    );
    return featureCollection([
      { type: 'Feature', geometry: antimeridianLineGeometry([origin, tip]), properties: {} },
    ]);
  }

  function syncVector(ctx: Parameters<SymbolOverlay['sync']>[0]): void {
    const inputs = vectorInputs();
    if (
      inputs?.lon === lastVector?.lon &&
      inputs?.lat === lastVector?.lat &&
      inputs?.cog === lastVector?.cog &&
      inputs?.sog === lastVector?.sog
    ) {
      return;
    }
    lastVector = inputs;
    setSourceData(
      ctx.map,
      VECTOR_SOURCE_ID,
      inputs ? buildVectorFeatures(inputs) : emptyFeatureCollection(),
    );
  }

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
    if (ctx.map.getLayer(VECTOR_LAYER_ID)) {
      ctx.map.setPaintProperty(VECTOR_LAYER_ID, 'line-opacity', opacity * VECTOR_OPACITY);
    }
    if (ctx.map.getLayer(STALE_LAYER_ID)) {
      ctx.map.setPaintProperty(STALE_LAYER_ID, 'icon-opacity', opacity);
    }
  }

  return {
    ...overlay,
    layerIds: [VECTOR_LAYER_ID, LAYER_ID, STALE_LAYER_ID],
    async add(ctx) {
      await overlay.add(ctx);
      ensureGeoJsonSource(ctx.map, VECTOR_SOURCE_ID);
      if (!ctx.map.getLayer(VECTOR_LAYER_ID)) {
        const vectorLayer: LineLayerSpecification = {
          id: VECTOR_LAYER_ID,
          type: 'line',
          source: VECTOR_SOURCE_ID,
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': rgbaCss(DEFAULT_COLOR),
            'line-width': VECTOR_WIDTH,
            'line-opacity': VECTOR_OPACITY,
          },
        };
        // Inserted before the symbol layer, so the predictor stays beneath the own-ship icon.
        ctx.map.addLayer(vectorLayer, LAYER_ID);
      }
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
      syncVector(ctx);
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
      setLayersVisibility(ctx.map, [VECTOR_LAYER_ID, LAYER_ID, STALE_LAYER_ID], visible);
    },
    applyTheme(ctx, paint) {
      overlay.applyTheme?.(ctx, paint);
      setMapImage(ctx.map, STALE_ICON_ID, staleVesselBadgeImage(paint.warning), 2);
      if (ctx.map.getLayer(VECTOR_LAYER_ID)) {
        ctx.map.setPaintProperty(VECTOR_LAYER_ID, 'line-color', rgbaCss(paint.ownVessel));
      }
    },
    remove(ctx) {
      if (ctx.map.getLayer(STALE_LAYER_ID)) ctx.map.removeLayer(STALE_LAYER_ID);
      if (ctx.map.hasImage(STALE_ICON_ID)) ctx.map.removeImage(STALE_ICON_ID);
      removeLayersAndSources(ctx.map, [VECTOR_LAYER_ID], [VECTOR_SOURCE_ID]);
      overlay.remove(ctx);
    },
    reset() {
      lastStale = undefined;
      lastReviewActive = undefined;
      // NaN never equals itself, so the first sync after a re-add always rewrites the vector
      // source: the rebuilt source starts empty while the memo still holds the last drawn state.
      lastVector = { lon: Number.NaN, lat: Number.NaN, cog: Number.NaN, sog: Number.NaN };
      overlay.reset?.();
    },
  };
}
