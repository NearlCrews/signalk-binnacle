import type { LineLayerSpecification } from 'maplibre-gl';

import type { OwnVessel } from '$entities/vessel';
import type { LatLon, LonLat } from '$shared/geo';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import {
  antimeridianLineGeometry,
  createSymbolOverlay,
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type Rgba,
  removeLayersAndSources,
  rgbaCss,
  type SymbolOverlay,
  setLayersVisibility,
  setMapImage,
  setSourceData,
} from '$shared/map';
import {
  COG_MIN_SOG_MPS,
  COURSE_VECTOR_SECONDS,
  createOwnShipReckoner,
  geodesicDestination,
  type ReckonedFix,
} from '$shared/nav';
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

// Frame scheduling and the clock for the cosmetic dead-reckoning loop, injectable for tests. The
// default is requestAnimationFrame where the host provides one; without it (the node test
// environment) the loop is off and every sync draws the raw fix, the pre-reckoning behavior. A
// hidden tab pausing requestAnimationFrame is correct here: the data pipeline stays on the worker
// timer, only the interpolation freezes.
export interface VesselMotion {
  schedule(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
  now(): number;
}

function defaultMotion(): VesselMotion | undefined {
  if (typeof requestAnimationFrame !== 'function') return undefined;
  return {
    schedule: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
  };
}

interface VectorInputs {
  lon: number;
  lat: number;
  cog: number;
  sog: number;
}

export function createVesselOverlay(
  vessel: OwnVessel,
  reviewActive: () => boolean = () => false,
  motion: VesselMotion | undefined = defaultMotion(),
): SymbolOverlay {
  const reckoner = createOwnShipReckoner();
  const clock = motion?.now ?? (() => performance.now());
  let overlayCtx: OverlayContext | undefined;
  let frameHandle: number | undefined;
  let layersVisible = true;
  let lastFixEpoch: number | undefined;
  let lastGate = -1;

  // The one icon feature, mutated in place each write: the frame loop repositions the boat at
  // display rate while underway, and rebuilding the collection per frame would be pure garbage
  // churn. Safe because this collection aliases nothing else, so MapLibre re-reading the retained
  // reference only ever sees the freshest coordinates.
  const iconCoordinates: LonLat = [0, 0];
  const iconProperties = { heading: 0, stale: false };
  const iconCollection = featureCollection<GeoJSON.Point>([
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: iconCoordinates },
      properties: iconProperties,
    },
  ]);
  const vectorFeature: GeoJSON.Feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] },
    properties: {},
  };
  const vectorCollection = featureCollection([vectorFeature]);

  let drawnLon = Number.NaN;
  let drawnLat = Number.NaN;
  let lastHeading: number | undefined;
  let lastStale: boolean | undefined;
  let iconEmpty = true;
  let lastVector: VectorInputs | undefined;

  // Heading drives icon-rotate (degrees), falling back to course over ground, then north.
  const resolveHeading = (): number => headingDegrees(vessel.headingRad, vessel.cogRad);

  // The fix as the reckoner consumes it: course and speed pass through only while every reckoning
  // input is fresh, so a stale declaration disables advancing rather than freezing a prediction.
  function reckonerFix(position: LatLon): ReckonedFix {
    const usable = !vessel.positionStale;
    return {
      latitude: position.latitude,
      longitude: position.longitude,
      cogRad: usable && !vessel.cogStale ? vessel.cogRad : undefined,
      sogMps: usable && !vessel.sogStale ? vessel.sogMps : undefined,
    };
  }

  // Re-anchor the reckoner on a fresh fix (the cell epoch advances per receipt, identical values
  // included) and on a validity flip between fixes: a staleness declaration arriving mid-horizon
  // must converge the drawn position back onto the last honest fix instead of reckoning on.
  function maybeAccept(nowMs: number): void {
    const position = vessel.position;
    if (!position) return;
    const fix = reckonerFix(position);
    const gate = (fix.cogRad === undefined ? 0 : 1) + (fix.sogMps === undefined ? 0 : 2);
    const epoch = vessel.positionEpochMs;
    if (epoch === lastFixEpoch && gate === lastGate) return;
    lastFixEpoch = epoch;
    lastGate = gate;
    reckoner.accept(fix, nowMs);
  }

  // The COG predictor's inputs when it should draw, undefined when it should hide. COG and SOG
  // only, never heading: the line is where the boat is going over ground, the icon is where it
  // points. Hidden on any stale input (a frozen prediction is a lie about the future) and below
  // the COG-meaningful speed floor, where GPS scatter owns the reported course. The origin is the
  // drawn (reckoned) position, so the line and the icon cannot shear apart.
  function vectorInputs(drawn: LonLat): VectorInputs | undefined {
    if (!vessel.position || vessel.positionStale) return undefined;
    const cog = vessel.cogRad;
    if (cog === undefined || vessel.cogStale) return undefined;
    const sog = vessel.sogMps;
    if (sog === undefined || vessel.sogStale || sog < COG_MIN_SOG_MPS) return undefined;
    return { lon: drawn[0], lat: drawn[1], cog, sog };
  }

  function syncVector(ctx: OverlayContext, drawn: LonLat): void {
    const inputs = vectorInputs(drawn);
    if (
      inputs?.lon === lastVector?.lon &&
      inputs?.lat === lastVector?.lat &&
      inputs?.cog === lastVector?.cog &&
      inputs?.sog === lastVector?.sog
    ) {
      return;
    }
    lastVector = inputs;
    if (!inputs) {
      setSourceData(ctx.map, VECTOR_SOURCE_ID, emptyFeatureCollection());
      return;
    }
    vectorFeature.geometry = antimeridianLineGeometry([
      [inputs.lon, inputs.lat],
      geodesicDestination(inputs.lat, inputs.lon, inputs.cog, inputs.sog * COURSE_VECTOR_SECONDS),
    ]);
    setSourceData(ctx.map, VECTOR_SOURCE_ID, vectorCollection);
  }

  // The one writer for both sources. Accepts any fresh fix, then draws the reckoned position with
  // the current heading and staleness, skipping the write when nothing changed.
  function draw(nowMs: number): void {
    const ctx = overlayCtx;
    if (!ctx) return;
    const position = vessel.position;
    if (!position) {
      if (!iconEmpty) {
        iconEmpty = true;
        drawnLon = Number.NaN;
        drawnLat = Number.NaN;
        setSourceData(ctx.map, SOURCE_ID, emptyFeatureCollection());
      }
      if (lastVector) {
        lastVector = undefined;
        setSourceData(ctx.map, VECTOR_SOURCE_ID, emptyFeatureCollection());
      }
      reckoner.reset();
      lastFixEpoch = undefined;
      lastGate = -1;
      return;
    }
    maybeAccept(nowMs);
    const drawn = reckoner.position(nowMs) ?? latLonToLonLat(position);
    const heading = resolveHeading();
    const stale = vessel.positionStale;
    if (
      iconEmpty ||
      drawn[0] !== drawnLon ||
      drawn[1] !== drawnLat ||
      heading !== lastHeading ||
      stale !== lastStale
    ) {
      iconEmpty = false;
      drawnLon = drawn[0];
      drawnLat = drawn[1];
      lastHeading = heading;
      lastStale = stale;
      iconCoordinates[0] = drawn[0];
      iconCoordinates[1] = drawn[1];
      iconProperties.heading = heading;
      iconProperties.stale = stale;
      setSourceData(ctx.map, SOURCE_ID, iconCollection);
    }
    syncVector(ctx, drawn);
  }

  function frame(nowMs: number): void {
    frameHandle = undefined;
    if (!overlayCtx || !layersVisible) return;
    draw(nowMs);
    scheduleIfActive(nowMs);
  }

  function scheduleIfActive(nowMs: number): void {
    if (!motion || frameHandle !== undefined || !overlayCtx || !layersVisible) return;
    if (!reckoner.active(nowMs)) return;
    frameHandle = motion.schedule(frame);
  }

  function stopLoop(): void {
    if (motion && frameHandle !== undefined) {
      motion.cancel(frameHandle);
      frameHandle = undefined;
    }
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
    // Seeds the source at add time only; every later write goes through draw, which owns the
    // reckoned position, so the base sync must never refresh over it.
    features: buildFeatures,
    shouldRefresh: () => false,
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
      overlayCtx = ctx;
      iconEmpty = vessel.position === undefined;
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
      overlayCtx = ctx;
      // While the frame loop is animating it owns both sources; drawing here too would double-write
      // every mapped frame, because each sync's later timestamp defeats the change check.
      if (frameHandle === undefined) {
        const nowMs = clock();
        draw(nowMs);
        scheduleIfActive(nowMs);
      }
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
      layersVisible = visible;
      if (!visible) stopLoop();
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
      stopLoop();
      overlayCtx = undefined;
      if (ctx.map.getLayer(STALE_LAYER_ID)) ctx.map.removeLayer(STALE_LAYER_ID);
      if (ctx.map.hasImage(STALE_ICON_ID)) ctx.map.removeImage(STALE_ICON_ID);
      removeLayersAndSources(ctx.map, [VECTOR_LAYER_ID], [VECTOR_SOURCE_ID]);
      overlay.remove(ctx);
    },
    reset() {
      stopLoop();
      // A re-add rebuilds the sources from the raw fix, so every memo must forget the drawn state:
      // NaN never equals itself, which forces the first draw after a re-add to rewrite both
      // sources, and the cleared epoch re-accepts the current fix (snapping once, invisibly, on a
      // style swap).
      drawnLon = Number.NaN;
      drawnLat = Number.NaN;
      lastHeading = undefined;
      lastStale = undefined;
      iconEmpty = vessel.position === undefined;
      lastVector = { lon: Number.NaN, lat: Number.NaN, cog: Number.NaN, sog: Number.NaN };
      lastReviewActive = undefined;
      lastFixEpoch = undefined;
      lastGate = -1;
      reckoner.reset();
      overlay.reset?.();
    },
  };
}
