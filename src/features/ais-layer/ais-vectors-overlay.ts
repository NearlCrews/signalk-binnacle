import type { ExpressionSpecification, LineLayerSpecification } from 'maplibre-gl';

import type { AisTargets, AisTargetView } from '$entities/ais';
import type { Assessment, Severity } from '$entities/collision';
import { latLonToLonLat } from '$shared/geo';
import {
  antimeridianLineGeometry,
  emptyFeatureCollection,
  ensureSource,
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
import { createSeverityTracker, severityForRank } from './ais-severity';

const SOURCE_ID = 'binnacle-ais-vectors';
const LAYER_ID = 'binnacle-ais-vectors-line';
const BAND = 'traffic';

// The feature-state key carrying a target's current grade, so a severity flip recolors its vector
// without rebuilding the source; the identically named data property is the fallback for an id
// whose state was never written.
const SEVERITY_STATE_KEY = 'severity';

// GPS scatter on a stationary vessel can produce a small apparent SOG. Targets below this
// threshold (about 0.5 kt) are treated as stationary and show no vector.
const MIN_SOG_MPS = 0.25;

const VECTOR_OPACITY = 0.8;
const VECTOR_WIDTH = 2;

function lineColor(paint: MapThemePaint): ExpressionSpecification {
  const match = severityMatchExpression(paint.danger, paint.warning, rgbaCss(paint.aisTarget));
  // The shared match keys on the data property; swap its input (['match', input, ...] position 1,
  // fixed by the expression grammar) for the feature-state read with the property as fallback.
  (match as unknown[])[1] = [
    'coalesce',
    ['feature-state', SEVERITY_STATE_KEY],
    ['get', SEVERITY_STATE_KEY],
  ];
  return match;
}

export function buildFeatures(
  targets: AisTargetView[],
  severityFor: (id: string) => Severity,
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
      properties: { id: target.id, severity: severityFor(target.id) },
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
  now: () => number = Date.now,
): AisVectorsOverlay {
  let paint = mapThemePaint('day');
  let visible = true;
  const gate = createAisRefreshGate(targets, now);
  const tracker = createSeverityTracker(assessment);
  // Every id whose feature-state was ever written, with the grade it holds: the guard against
  // re-writing an unchanged state, and the sweep list that clears state for pruned targets.
  const stated = new Map<string, Severity>();

  const severityFor = (id: string): Severity => severityForRank(tracker.rankFor(id));

  return {
    id: 'ais-vectors',
    title: 'AIS course vectors',
    description: 'A line ahead of each AIS vessel showing where it is heading and how fast.',
    band: BAND,
    supportsOpacity: true,
    layerIds: [LAYER_ID],
    add(ctx) {
      gate.reset();
      tracker.reset();
      stated.clear();
      // promoteId keys feature-state by the target's context id, the same id the features carry.
      ensureSource(ctx.map, SOURCE_ID, {
        type: 'geojson',
        promoteId: 'id',
        data: emptyFeatureCollection(),
      });
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
      // Hidden pays nothing: skip the whole pass. The grading and dirty checks still catch up on
      // re-show, since the tracker and gate state have not consumed what changed while hidden.
      if (!visible) return;
      // Grade changes repaint through feature-state on this very pass, unthrottled: a departure
      // writes clear rather than removing the state, so the color never falls back to a stale
      // data property on a quiet bus. State removal happens only when the target itself is gone.
      tracker.sync((id, rank) => {
        const severity = severityForRank(rank);
        if (stated.get(id) === severity) return;
        stated.set(id, severity);
        ctx.map.setFeatureState({ source: SOURCE_ID, id }, { [SEVERITY_STATE_KEY]: severity });
      });
      if (!gate.shouldRefresh()) return;
      setSourceData(
        ctx.map,
        SOURCE_ID,
        featureCollection(buildFeatures(targets.list(), severityFor)),
      );
      // Ride the throttled rebuild for hygiene: drop the state of ids whose targets were pruned.
      if (stated.size) {
        for (const id of stated.keys()) {
          if (targets.find(id)) continue;
          stated.delete(id);
          ctx.map.removeFeatureState({ source: SOURCE_ID, id });
        }
      }
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
