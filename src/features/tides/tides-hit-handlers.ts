import type { MapLayerMouseEvent } from 'maplibre-gl';
import type { TideStation, TideStationKind, TidesStore } from '$entities/tides';
import type { OverlayContext } from '$shared/map';
import { TIDES_HIT_LAYER } from './tides-overlay-layers';

export interface TideStationSelectionEvent {
  kind: TideStationKind;
  station: TideStation;
  // A signalk-tides marker represents automatic plugin output, not a NOAA station id. Tapping it
  // keeps automatic mode and refreshes. Every NOAA catalog, selected, or current marker is manual.
  mode: 'automatic' | 'manual';
}

export interface TideHitHandlers {
  attach(ctx: OverlayContext): void;
  detach(ctx: OverlayContext): void;
}

function stationKind(value: unknown): TideStationKind | undefined {
  return value === 'tide' || value === 'current' ? value : undefined;
}

// Layer-delegated listeners survive a base-style reset on the same MapLibre map. Retain their exact
// references, make reattachment idempotent, and resolve every untrusted feature id through the store.
export function createTideHitHandlers(
  store: TidesStore,
  onSelect?: (selection: TideStationSelectionEvent) => void,
): TideHitHandlers {
  let onClick: ((event: MapLayerMouseEvent) => void) | undefined;
  let onEnter: (() => void) | undefined;
  let onLeave: (() => void) | undefined;

  return {
    attach(ctx) {
      if (onClick) return;
      onClick = (event) => {
        const feature = event.features?.[0];
        if (feature?.geometry.type !== 'Point') return;
        const properties = feature.properties ?? {};
        const stationId =
          typeof properties.stationId === 'string' ? properties.stationId : undefined;
        const kind = stationKind(properties.kind);
        // Validate every property the renderer promises before using any of them. selected and
        // loaded are not trusted as authority; they only prove this is one of this overlay's shapes.
        if (
          !stationId ||
          !kind ||
          typeof properties.selected !== 'boolean' ||
          typeof properties.loaded !== 'boolean'
        ) {
          return;
        }
        const station = store.resolveStation(kind, stationId);
        if (station) {
          const pluginTide =
            kind === 'tide' &&
            store.source === 'signalk-tides' &&
            store.tide?.station.id === stationId;
          onSelect?.({ kind, station, mode: pluginTide ? 'automatic' : 'manual' });
        }
      };
      onEnter = () => {
        ctx.map.getCanvas().style.cursor = 'pointer';
      };
      onLeave = () => {
        ctx.map.getCanvas().style.cursor = '';
      };
      ctx.map.on('click', TIDES_HIT_LAYER, onClick);
      ctx.map.on('mouseenter', TIDES_HIT_LAYER, onEnter);
      ctx.map.on('mouseleave', TIDES_HIT_LAYER, onLeave);
    },
    detach(ctx) {
      if (onClick) ctx.map.off('click', TIDES_HIT_LAYER, onClick);
      if (onEnter) ctx.map.off('mouseenter', TIDES_HIT_LAYER, onEnter);
      if (onLeave) ctx.map.off('mouseleave', TIDES_HIT_LAYER, onLeave);
      if (ctx.map.getCanvas().style.cursor === 'pointer') ctx.map.getCanvas().style.cursor = '';
      onClick = onEnter = onLeave = undefined;
    },
  };
}
