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
  severityMatchExpression,
} from '$shared/map';
import { COURSE_VECTOR_SECONDS, geodesicDestination } from '$shared/nav';
import { createAisRefreshGate } from './ais-refresh';

const SOURCE_ID = 'binnacle-ais-vectors';
const LAYER_ID = 'binnacle-ais-vectors-line';
const BAND = 'traffic';

// GPS scatter on a stationary vessel can produce a small apparent SOG. Targets below this
// threshold (about 0.5 kt) are treated as stationary and show no vector.
const MIN_SOG_MPS = 0.25;

const VECTOR_OPACITY = 0.8;
const VECTOR_WIDTH = 2;

function lineColor(paint: MapThemePaint): ExpressionSpecification {
  return severityMatchExpression(paint.danger, paint.warning, rgbaCss(paint.aisTarget));
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
    const distanceMeters = sog * COURSE_VECTOR_SECONDS;
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

// True when the contacts carry a different id-to-severity mapping than the map holds. Assessment
// recomputes mint a fresh contacts array on every AIS flush while any contact is active, so the
// repaint-now decision must compare the rendered content, not the array identity.
function severitiesDiffer(
  severityById: ReadonlyMap<string, Severity>,
  contacts: Assessment['contacts'],
): boolean {
  if (severityById.size !== contacts.length) return true;
  for (const contact of contacts) {
    if (severityById.get(contact.id) !== contact.severity) return true;
  }
  return false;
}

export function createAisVectorsOverlay(
  targets: AisTargets,
  assessment: () => Assessment,
  now: () => number = Date.now,
): AisVectorsOverlay {
  let paint = mapThemePaint('day');
  let visible = true;
  const gate = createAisRefreshGate(targets, now);
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
      gate.reset();
      lastContacts = undefined;
      severityById.clear();
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
      // Hidden pays nothing: skip the rebuild entirely. The dirty check still fires on re-show,
      // since the version or the severities advance while hidden and no longer match.
      if (!visible) return;
      const contacts = assessment().contacts;
      let severitiesChanged = false;
      if (contacts !== lastContacts) {
        lastContacts = contacts;
        if (severitiesDiffer(severityById, contacts)) {
          severitiesChanged = true;
          severityById.clear();
          for (const contact of contacts) severityById.set(contact.id, contact.severity);
        }
      }
      if (!gate.shouldRefresh(severitiesChanged)) return;
      setSourceData(
        ctx.map,
        SOURCE_ID,
        featureCollection(buildFeatures(targets.list(), severityById)),
      );
    },
    // Guarded on getLayer: a theme or opacity change can land before add() attaches the layer, and
    // setPaintProperty throws on a missing one. The LayerManager re-applies both once add() resolves.
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', lineColor(paint));
      }
    },
    setVisible(ctx, isVisible) {
      visible = isVisible;
      setLayersVisibility(ctx.map, [LAYER_ID], isVisible);
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', opacity * VECTOR_OPACITY);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [LAYER_ID], [SOURCE_ID]);
    },
  };
}
