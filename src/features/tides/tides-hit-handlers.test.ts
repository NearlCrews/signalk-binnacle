import type { MapLayerMouseEvent } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createTideHitHandlers, type TideStationSelectionEvent } from './tides-hit-handlers';
import { TIDES_HIT_LAYER, TIDES_LABEL_LAYER } from './tides-overlay-layers';

type HitFeature = NonNullable<MapLayerMouseEvent['features']>[number];

function stationFeature(kind: 'tide' | 'current', layerId: string): HitFeature {
  return {
    type: 'Feature',
    id: `${kind}:${kind === 'tide' ? 'T1' : 'C1'}`,
    layer: { id: layerId },
    geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
    properties: {
      stationId: kind === 'tide' ? 'T1' : 'C1',
      stationName: kind === 'tide' ? 'Tide station' : 'Current station',
      stationLatitude: 27.7,
      stationLongitude: -82.7,
      kind,
      selectionMode: 'manual',
    },
  } as unknown as HitFeature;
}

function clickWith(features: HitFeature[]): MapLayerMouseEvent {
  return {
    features,
    point: { x: 10, y: 10 },
    type: 'click',
  } as unknown as MapLayerMouseEvent;
}

function selectionFor(features: HitFeature[]): TideStationSelectionEvent | undefined {
  const map = createFakeMap();
  const onSelect = vi.fn();
  createTideHitHandlers(new TidesStore(), onSelect).attach(fakeOverlayContext(map));
  map.emitLayer('click', TIDES_HIT_LAYER, clickWith(features));
  return onSelect.mock.calls[0]?.[0] as TideStationSelectionEvent | undefined;
}

describe('tide hit handlers', () => {
  it('prefers the tide station when markers overlap, whatever order they arrive in', () => {
    const tide = stationFeature('tide', TIDES_HIT_LAYER);
    const current = stationFeature('current', TIDES_HIT_LAYER);

    expect(selectionFor([current, tide])?.kind).toBe('tide');
    expect(selectionFor([tide, current])?.kind).toBe('tide');
  });

  it('still prefers a visible label over a transparent touch circle', () => {
    const currentLabel = stationFeature('current', TIDES_LABEL_LAYER);
    const tideMarker = stationFeature('tide', TIDES_HIT_LAYER);

    expect(selectionFor([tideMarker, currentLabel])?.kind).toBe('current');
  });
});
