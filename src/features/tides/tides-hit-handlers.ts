import type { MapLayerMouseEvent } from 'maplibre-gl';
import type { TideStation, TideStationKind, TidesStore } from '$entities/tides';
import { createLayerHitHandlers, type LayerHitHandlers } from '$shared/map';
import { TIDES_HIT_LAYER } from './tides-overlay-layers';

export interface TideStationSelectionEvent {
  kind: TideStationKind;
  station: TideStation;
  // A signalk-tides marker represents automatic plugin output, not a NOAA station id. Tapping it
  // keeps automatic mode and refreshes. Every NOAA catalog, selected, or current marker is manual.
  mode: 'automatic' | 'manual';
}

export type TideHitHandlers = LayerHitHandlers;

function stationKind(value: unknown): TideStationKind | undefined {
  return value === 'tide' || value === 'current' ? value : undefined;
}

// Layer-delegated listeners survive a base-style reset on the same MapLibre map. Retain their exact
// references, make reattachment idempotent, and resolve every untrusted feature id through the store.
export function createTideHitHandlers(
  store: TidesStore,
  onSelect?: (selection: TideStationSelectionEvent) => void,
): TideHitHandlers {
  const onClick = (event: MapLayerMouseEvent): void => {
    const feature = event.features?.[0];
    if (feature?.geometry.type !== 'Point') return;
    const properties = feature.properties ?? {};
    const stationId = typeof properties.stationId === 'string' ? properties.stationId : undefined;
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
        kind === 'tide' && store.source === 'signalk-tides' && store.tide?.station.id === stationId;
      onSelect?.({ kind, station, mode: pluginTide ? 'automatic' : 'manual' });
    }
  };
  return createLayerHitHandlers(TIDES_HIT_LAYER, onClick);
}
