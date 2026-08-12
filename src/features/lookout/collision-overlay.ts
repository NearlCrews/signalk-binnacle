import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSourceSpecification,
} from 'maplibre-gl';
import type { CollisionAssessment, DangerContact } from '$entities/collision';
import { latLonToLonLat } from '$shared/geo';
import {
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
  severityMatchExpression,
} from '$shared/map';

const SOURCE_ID = 'binnacle-collision';
const LAYER_ID = 'binnacle-collision-ring';

// Ring geometry per severity, named so the danger and warning grading is one source. The warning
// values double as the match fallback for an unknown severity.
const RING_RADIUS = { danger: 20, warning: 16 } as const;
const RING_STROKE_WIDTH = { danger: 3, warning: 2 } as const;

// The overlay id. The chart pins this just beneath the vessel so an active alarm can never be hidden;
// exported so the pinned list references the same constant instead of a literal that could drift.
export const COLLISION_OVERLAY_ID = 'collision';

interface CollisionOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The ring features for the current contacts, built once so add() and sync() share the same mapping.
function contactsToFeatures(contacts: readonly DangerContact[]): GeoJSON.FeatureCollection {
  return featureCollection(
    contacts.map((contact) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: latLonToLonLat(contact.position),
      },
      properties: { severity: contact.severity },
    })),
  );
}

// The ring reuses its warning grade as the fallback, so an ungraded target still reads as traffic
// worth seeing rather than disappearing. Shared by the ring radius, stroke width, and stroke color.
const severityMatch = <T extends number | string>(danger: T, warning: T) =>
  severityMatchExpression(danger, warning, warning);

// A graded ring around each dangerous AIS target, colored by severity from the theme.
function strokeColor(paint: MapThemePaint): ExpressionSpecification {
  return severityMatch(paint.danger, paint.warning);
}

export function createCollisionOverlay(collision: CollisionAssessment): CollisionOverlay {
  // The assessment is a memoized derived value, so its contacts array keeps the same identity
  // until traffic, the own fix, or the thresholds actually change. A reference check is the
  // dirty check, with no per-frame string to build in the animation loop.
  let lastContacts: readonly DangerContact[] | undefined;

  return {
    id: COLLISION_OVERLAY_ID,
    title: 'Collision risk',
    band: 'safety',
    // The overlay is pinned beneath the vessel and an active alarm must never be user-dimmable.
    supportsOpacity: false,
    layerIds: [LAYER_ID],
    add(ctx) {
      lastContacts = undefined;
      const contacts = collision.assessment.contacts;
      if (!ctx.map.getSource(SOURCE_ID)) {
        const source: GeoJSONSourceSpecification = {
          type: 'geojson',
          data: contactsToFeatures(contacts),
        };
        ctx.map.addSource(SOURCE_ID, source);
      }
      if (!ctx.map.getLayer(LAYER_ID)) {
        const layer: CircleLayerSpecification = {
          id: LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': severityMatch(RING_RADIUS.danger, RING_RADIUS.warning),
            'circle-color': 'transparent',
            'circle-stroke-width': severityMatch(
              RING_STROKE_WIDTH.danger,
              RING_STROKE_WIDTH.warning,
            ),
            'circle-stroke-color': strokeColor(mapThemePaint('day')),
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('safety'));
      }
      lastContacts = contacts;
    },
    sync(ctx) {
      const contacts = collision.assessment.contacts;
      if (contacts === lastContacts) return;
      lastContacts = contacts;
      setSourceData(ctx.map, SOURCE_ID, contactsToFeatures(contacts));
    },
    applyTheme(ctx, paint) {
      ctx.map.setPaintProperty(LAYER_ID, 'circle-stroke-color', strokeColor(paint));
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [LAYER_ID], visible);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [LAYER_ID], [SOURCE_ID]);
    },
  };
}
