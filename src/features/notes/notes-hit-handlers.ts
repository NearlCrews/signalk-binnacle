import type { GeoJSONSource } from 'maplibre-gl';
import { asPoiCategory } from '$entities/poi-icons';
import {
  createLayerHitHandlers,
  type LayerHitEvent,
  type LayerHitHandlers,
  type OverlayContext,
} from '$shared/map';
import { str } from '$shared/signalk';
import type { NoteSelection } from './notes-client';
import { CLUSTER_HIT_LAYERS, LAYER_ID, SOURCE_ID } from './notes-layers';

// The overlay's map hit handlers: marker click to selection, cluster click to zoom, and the
// pointer cursor. Attach is idempotent because the handlers persist across a base-style swap (the
// map keeps its listeners), so a reattach, an add() with no preceding remove(), must not
// re-register them or every click would fire onSelect twice and the cursor handlers would leak.
export interface NoteHitHandlers {
  attach(ctx: OverlayContext): void;
  detach(ctx: OverlayContext): void;
  refreshInteractionState(): void;
}

export function createNoteHitHandlers(
  onSelect?: (selection: NoteSelection | undefined) => void,
  interactionsAllowed: () => boolean = () => true,
): NoteHitHandlers {
  let ctxRef: OverlayContext | undefined;
  let attachmentGeneration = 0;
  const markerHit: LayerHitHandlers = createLayerHitHandlers(
    LAYER_ID,
    (event: LayerHitEvent) => {
      const feature = event.features?.[0];
      if (feature?.geometry.type !== 'Point') return false;
      const props = feature.properties ?? {};
      const id = String(props.id ?? '');
      // A note with no id cannot be fetched for detail, so do not select it.
      if (!id) return false;
      // The category rides on the rendered feature, so validate it against the known set rather
      // than trusting the string into PoiCategory: an out-of-vocabulary value would key the label
      // and icon records to nothing instead of falling back.
      const category = asPoiCategory(String(props.category ?? ''));
      const [longitude, latitude] = feature.geometry.coordinates as [number, number];
      onSelect?.({
        id,
        name: String(props.name ?? 'Point of interest'),
        category,
        position: { latitude, longitude },
        description: str(props.description),
        skIcon: str(props.skIcon),
        ownedByBinnacle: props.ownedByBinnacle === true,
        attribution: str(props.attribution) ?? str(props.source),
        url: str(props.url),
      });
      return true;
    },
    {
      band: 'routes',
      interactionsAllowed,
      withinBandOrder: 1,
    },
  );
  // One multi-layer listener covers the stacked cluster icon and ring without double dispatch.
  const clusterHit: LayerHitHandlers = createLayerHitHandlers(
    CLUSTER_HIT_LAYERS,
    (event: LayerHitEvent) => {
      for (const feature of event.features ?? []) {
        const clusterId = feature.properties?.cluster_id;
        if (typeof clusterId !== 'number' || feature.geometry.type !== 'Point') continue;
        const ctx = ctxRef;
        const source = ctx?.map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        if (!ctx || !source) return false;
        const center = feature.geometry.coordinates as [number, number];
        const generation = attachmentGeneration;
        void source
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            if (
              generation !== attachmentGeneration ||
              ctxRef !== ctx ||
              !interactionsAllowed() ||
              ctx.map.getSource(SOURCE_ID) !== source ||
              !Number.isFinite(zoom)
            ) {
              return;
            }
            ctx.map.easeTo({ center, zoom });
          })
          .catch(() => undefined);
        return true;
      }
      return false;
    },
    {
      band: 'routes',
      interactionsAllowed,
    },
  );

  return {
    attach(ctx) {
      if (ctxRef) return;
      attachmentGeneration += 1;
      ctxRef = ctx;
      markerHit.attach(ctx);
      clusterHit.attach(ctx);
    },
    detach(ctx) {
      if (!ctxRef) return;
      attachmentGeneration += 1;
      markerHit.detach(ctx);
      clusterHit.detach(ctx);
      ctxRef = undefined;
    },
    refreshInteractionState() {
      markerHit.refreshInteractionState();
      clusterHit.refreshInteractionState();
    },
  };
}
