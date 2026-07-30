import { describe, expect, it } from 'vitest';
import type { TideStation } from '$entities/tides';
import { nearestStations } from './station-proximity';

const station = (id: string, lat: number, lon: number): TideStation => ({
  id,
  name: id,
  latitude: lat,
  longitude: lon,
});

describe('station-proximity', () => {
  it('returns nothing for an empty station list', () => {
    expect(nearestStations([], 0, 0, 3, 500_000)).toEqual([]);
  });

  it('drops stations beyond the max distance and sorts nearest first', () => {
    const stations = [station('far', 5, 5), station('near', 0.1, 0.1), station('mid', 1, 1)];
    const ranked = nearestStations(stations, 0, 0, 3, 200_000);
    expect(ranked.map((r) => r.station.id)).toEqual(['near', 'mid']);
  });

  it('caps the result at k', () => {
    const stations = [station('a', 0.1, 0), station('b', 0.2, 0), station('c', 0.3, 0)];
    expect(nearestStations(stations, 0, 0, 2, 1e7)).toHaveLength(2);
  });

  it('deduplicates old catalog rows by id and keeps the nearest occurrence', () => {
    const farther = station('duplicate', 0.2, 0);
    const nearer = station('duplicate', 0.05, 0);
    const ranked = nearestStations([farther, station('other', 0.1, 0), nearer], 0, 0, 3, 1e7);

    expect(ranked.map((result) => result.station.id)).toEqual(['duplicate', 'other']);
    expect(ranked[0].station).toBe(nearer);
  });
});
