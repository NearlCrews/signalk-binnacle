import { type LatLon, latLonToLonLat } from '$shared/geo';
import {
  emptyFeatureCollection,
  featureCollection,
  type OverlayContext,
  setSourceData,
} from '$shared/map';
import { SELECT_SOURCE } from './notes-layers';

// The selection ring around a highlighted marker. Position-driven so a list selection rings a
// marker without a rendered map feature and without moving the map; the app owns what is
// highlighted (a hovered or a selected POI) and drives draw().
export interface SelectRing {
  draw(ctx: OverlayContext, position: LatLon | undefined): void;
  // Invalidate the change-detection cache so the next draw repopulates from scratch. The manager
  // calls the overlay's reset on a base-style swap, which recreates the selection source empty;
  // add() resets too so a later same-position highlight redraws its ring.
  reset(): void;
}

export function createSelectRing(): SelectRing {
  // The "lat,lon" of the ring last drawn (empty when cleared), so a redundant source rewrite is
  // skipped when the highlighted position has not changed.
  let lastRingKey = '';
  return {
    draw(ctx, position) {
      const key = position ? `${position.latitude},${position.longitude}` : '';
      if (key === lastRingKey) return;
      lastRingKey = key;
      const data = position
        ? featureCollection([
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: latLonToLonLat(position) },
              properties: {},
            },
          ])
        : emptyFeatureCollection();
      setSourceData(ctx.map, SELECT_SOURCE, data);
    },
    reset() {
      lastRingKey = '';
    },
  };
}
