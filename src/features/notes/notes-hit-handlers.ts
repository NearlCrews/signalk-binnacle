import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import { asPoiCategory } from '$entities/poi-icons';
import type { OverlayContext } from '$shared/map';
import { str } from '$shared/signalk';
import type { NoteSelection } from './notes-client';
import { CLUSTER_HIT_LAYERS, CLUSTER_RING_LAYER, LAYER_ID, SOURCE_ID } from './notes-layers';

// The overlay's map hit handlers: marker click to selection, cluster click to zoom, and the
// pointer cursor. Attach is idempotent because the handlers persist across a base-style swap (the
// map keeps its listeners), so a reattach, an add() with no preceding remove(), must not
// re-register them or every click would fire onSelect twice and the cursor handlers would leak.
export interface NoteHitHandlers {
  attach(ctx: OverlayContext): void;
  detach(ctx: OverlayContext): void;
}

export function createNoteHitHandlers(
  onSelect?: (selection: NoteSelection | undefined) => void,
  interactionsAllowed: () => boolean = () => true,
): NoteHitHandlers {
  let onClick: ((event: MapLayerMouseEvent) => void) | undefined;
  let onClusterClick: ((event: MapLayerMouseEvent) => void) | undefined;
  let onEnter: (() => void) | undefined;
  let onLeave: (() => void) | undefined;

  return {
    attach(ctx) {
      if (onClick) return;
      onClick = (event) => {
        if (!interactionsAllowed()) return;
        const feature = event.features?.[0];
        if (feature?.geometry.type !== 'Point') return;
        const props = feature.properties ?? {};
        const id = String(props.id ?? '');
        // A note with no id cannot be fetched for detail, so do not select it.
        if (!id) return;
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
      };
      onClusterClick = (event) => {
        if (!interactionsAllowed()) return;
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (typeof clusterId !== 'number' || feature?.geometry.type !== 'Point') return;
        const source = ctx.map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        if (!source) return;
        const center = feature.geometry.coordinates as [number, number];
        void source
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            ctx.map.easeTo({ center, zoom });
          })
          .catch(() => undefined);
      };
      onEnter = () => {
        if (!interactionsAllowed()) return;
        ctx.map.getCanvas().style.cursor = 'pointer';
      };
      onLeave = () => {
        ctx.map.getCanvas().style.cursor = '';
      };
      ctx.map.on('click', LAYER_ID, onClick);
      ctx.map.on('mouseenter', LAYER_ID, onEnter);
      ctx.map.on('mouseleave', LAYER_ID, onLeave);
      // Click only the ring (it covers the cluster and then some), so a click does not fire once
      // per stacked cluster layer; hover the ring and the icon so either shows the pointer cursor.
      ctx.map.on('click', CLUSTER_RING_LAYER, onClusterClick);
      for (const id of CLUSTER_HIT_LAYERS) {
        ctx.map.on('mouseenter', id, onEnter);
        ctx.map.on('mouseleave', id, onLeave);
      }
    },
    detach(ctx) {
      if (onClick) ctx.map.off('click', LAYER_ID, onClick);
      if (onEnter) ctx.map.off('mouseenter', LAYER_ID, onEnter);
      if (onLeave) ctx.map.off('mouseleave', LAYER_ID, onLeave);
      if (onClusterClick) ctx.map.off('click', CLUSTER_RING_LAYER, onClusterClick);
      for (const id of CLUSTER_HIT_LAYERS) {
        if (onEnter) ctx.map.off('mouseenter', id, onEnter);
        if (onLeave) ctx.map.off('mouseleave', id, onLeave);
      }
      // Null the refs so a genuine detach()/attach() cycle re-attaches, while a bare reattach
      // keeps the live handlers (attach guards on onClick).
      onClick = onEnter = onLeave = onClusterClick = undefined;
    },
  };
}
