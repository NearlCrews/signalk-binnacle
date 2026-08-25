import {
  isTideStation,
  type TideStation,
  type TideStationKind,
  type TidesStore,
} from '$entities/tides';
import { createLayerHitHandlers, type LayerHitEvent, type LayerHitHandlers } from '$shared/map';
import { TIDES_HIT_LAYER, TIDES_LABEL_LAYER } from './tides-overlay-layers';

export interface TideStationSelectionEvent {
  kind: TideStationKind;
  station: TideStation;
  // A signalk-tides marker represents automatic plugin output, not a NOAA station id. Tapping it
  // keeps automatic mode and refreshes. Every NOAA catalog, selected, or current marker is manual.
  mode: 'automatic' | 'manual';
}

type TideHitHandlers = LayerHitHandlers;

function stationKind(value: unknown): TideStationKind | undefined {
  return value === 'tide' || value === 'current' ? value : undefined;
}

function featureIdentity(
  feature: NonNullable<LayerHitEvent['features']>[number],
): { kind: TideStationKind; stationId: string } | undefined {
  const properties = feature.properties ?? {};
  const kind = stationKind(properties.kind);
  const stationId = typeof properties.stationId === 'string' ? properties.stationId : undefined;
  if (kind && stationId) return { kind, stationId };

  // Stable GeoJSON feature ids preserve the identity if a renderer omits or coerces unrelated
  // properties. Split only at the first colon because provider station ids may contain punctuation.
  if (typeof feature.id !== 'string') return undefined;
  const separator = feature.id.indexOf(':');
  if (separator <= 0 || separator === feature.id.length - 1) return undefined;
  const idKind = stationKind(feature.id.slice(0, separator));
  return idKind ? { kind: idKind, stationId: feature.id.slice(separator + 1) } : undefined;
}

function renderedSelection(
  feature: NonNullable<LayerHitEvent['features']>[number],
  stationId: string,
): { station: TideStation; mode: TideStationSelectionEvent['mode'] } | undefined {
  const properties = feature.properties ?? {};
  const station = {
    id: stationId,
    name: properties.stationName,
    latitude: properties.stationLatitude,
    longitude: properties.stationLongitude,
  };
  const mode = properties.selectionMode;
  if (!isTideStation(station) || (mode !== 'automatic' && mode !== 'manual')) return undefined;
  return { station, mode };
}

// Lower wins: a visible label outranks a transparent touch circle, and a tide station outranks a
// current station within the same layer class.
function hitRank(feature: NonNullable<LayerHitEvent['features']>[number]): number {
  const layerRank = feature.layer?.id === TIDES_LABEL_LAYER ? 0 : 2;
  return layerRank + (featureIdentity(feature)?.kind === 'tide' ? 0 : 1);
}

// Layer-delegated listeners survive a base-style reset on the same MapLibre map. Retain their exact
// references, make reattachment idempotent, and resolve every untrusted feature through either its
// validated rendered snapshot or the current bounded store.
export function createTideHitHandlers(
  store: TidesStore,
  onSelect?: (selection: TideStationSelectionEvent) => void,
  interactionsAllowed: () => boolean = () => true,
): TideHitHandlers {
  const onTap = (event: LayerHitEvent): boolean => {
    if (!interactionsAllowed()) return false;
    const features = event.features ?? [];
    // The transparent touch circles render above labels. Prefer a visible label under the pointer,
    // then a tide station over a current station at the same spot: queryRenderedFeatures order is
    // source-driven rather than specified, so an overlap would otherwise resolve differently for the
    // same tap. Array sort is stable, so MapLibre's topmost-first order survives within one rank.
    const prioritizedFeatures = features
      .map((feature) => ({ feature, rank: hitRank(feature) }))
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.feature);
    for (const feature of prioritizedFeatures) {
      if (feature.geometry.type !== 'Point') continue;
      const identity = featureIdentity(feature);
      if (!identity) continue;
      const { kind, stationId } = identity;
      const rendered = renderedSelection(feature, stationId);
      const station = rendered?.station ?? store.resolveStation(kind, stationId);
      if (!station) continue;
      const requested = kind === 'tide' ? store.requestedTide : store.requestedCurrent;
      const manualSelection = requested.mode === 'manual' && requested.station.id === stationId;
      const pluginTide =
        !manualSelection &&
        kind === 'tide' &&
        store.source === 'signalk-tides' &&
        store.tide?.station.id === stationId;
      onSelect?.({
        kind,
        station,
        mode: rendered?.mode ?? (pluginTide ? 'automatic' : 'manual'),
      });
      return true;
    }
    return false;
  };
  // The offset prediction label is visibly part of the station marker and may extend beyond the
  // circular touch target. A single multi-layer listener makes both surfaces interactive without
  // dispatching twice when the label overlaps the marker.
  return createLayerHitHandlers([TIDES_HIT_LAYER, TIDES_LABEL_LAYER], onTap, {
    band: 'safety',
    interactionsAllowed,
  });
}
