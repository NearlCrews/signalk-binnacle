import type { ExpressionSpecification, LineLayerSpecification } from 'maplibre-gl';

import type { AisTargets, AisTargetView } from '$entities/ais';
import type { Assessment, Severity } from '$entities/collision';
import { latLonToLonLat } from '$shared/geo';
import {
  antimeridianLineGeometry,
  ensureGeoJsonSource,
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  rgbaCss,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { geodesicDestination } from '$shared/nav';

const SOURCE_ID = 'binnacle-ais-vectors';
const LAYER_ID = 'binnacle-ais-vectors-line';
const BAND = 'traffic';

// Project each target 10 minutes along its COG at its SOG.
const VECTOR_MINUTES = 10;
const VECTOR_SECONDS = VECTOR_MINUTES * 60;
// GPS scatter on a stationary vessel can produce a small apparent SOG. Targets below this
// threshold (about 0.5 kt) are treated as stationary and show no vector.
const MIN_SOG_MPS = 0.25;

const VECTOR_OPACITY = 0.8;
const VECTOR_WIDTH = 2;

function lineColor(paint: MapThemePaint): ExpressionSpecification {
  return [
    'match',
    ['get', 'severity'],
    'danger',
    paint.danger,
    'warning',
    paint.warning,
    rgbaCss(paint.aisTarget),
  ];
}

export function buildFeatures(
  targets: AisTargetView[],
  severityById: Map<string, Severity>,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (const target of targets) {
    if (target.cogRad === undefined) continue;
    const sog = target.sogMps ?? 0;
    if (sog < MIN_SOG_MPS) continue;
    const distanceMeters = sog * VECTOR_SECONDS;
    const origin: [number, number] = latLonToLonLat(target.position);
    const tip = geodesicDestination(
      target.position.latitude,
      target.position.longitude,
      target.cogRad,
      distanceMeters,
    );
    features.push({
      type: 'Feature',
      geometry: antimeridianLineGeometry([origin, tip]),
      properties: { severity: severityById.get(target.id) ?? 'clear' },
    });
  }
  return features;
}

export interface AisVectorsOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export function createAisVectorsOverlay(
  targets: AisTargets,
  assessment: () => Assessment,
): AisVectorsOverlay {
  let paint = mapThemePaint('day');
  let visible = true;
  let lastVersion = -1;
  let lastContacts: Assessment['contacts'] | undefined;
  const severityById = new Map<string, Severity>();

  return {
    id: 'ais-vectors',
    title: 'AIS course vectors',
    description: 'A line ahead of each AIS vessel showing where it is heading and how fast.',
    band: BAND,
    supportsOpacity: true,
    layerIds: [LAYER_ID],
    add(ctx) {
      lastVersion = -1;
      lastContacts = undefined;
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      if (!ctx.map.getLayer(LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': lineColor(paint),
            'line-width': VECTOR_WIDTH,
            'line-opacity': VECTOR_OPACITY,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
    },
    sync(ctx) {
      // Hidden pays nothing: skip the rebuild entirely. The dirty check still fires on re-show, since
      // the version or the contacts reference advance while hidden and no longer match.
      if (!visible) return;
      const version = targets.version;
      const contacts = assessment().contacts;
      if (version === lastVersion && contacts === lastContacts) return;
      lastVersion = version;
      lastContacts = contacts;
      severityById.clear();
      for (const contact of contacts) severityById.set(contact.id, contact.severity);
      setSourceData(
        ctx.map,
        SOURCE_ID,
        featureCollection(buildFeatures(targets.list(), severityById)),
      );
    },
    applyTheme(ctx, next) {
      paint = next;
      ctx.map.setPaintProperty(LAYER_ID, 'line-color', lineColor(paint));
    },
    setVisible(ctx, isVisible) {
      visible = isVisible;
      setLayersVisibility(ctx.map, [LAYER_ID], isVisible);
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', opacity * VECTOR_OPACITY);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [LAYER_ID], [SOURCE_ID]);
    },
  };
}
