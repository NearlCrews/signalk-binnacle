import type { TideStation } from '$entities/tides';
import { lowerBound } from '$shared/lib';
import { haversineMeters } from '$shared/nav';

interface RankedStation {
  station: TideStation;
  distanceMeters: number;
}

// Meters per degree of latitude, set slightly under the true minimum (~110,567 at the equator) so
// the search window rounds outward and never excludes a station on the radius boundary.
const LAT_METERS_PER_DEG = 110_000;

// Stations sorted by latitude, memoized per list identity: the loader replaces the array wholesale
// on each refresh, so a fetched list is indexed exactly once and dropped with the list itself.
const SORTED_BY_LAT = new WeakMap<TideStation[], TideStation[]>();

function sortedByLat(stations: TideStation[]): TideStation[] {
  let sorted = SORTED_BY_LAT.get(stations);
  if (!sorted) {
    sorted = [...stations].sort((a, b) => a.latitude - b.latitude);
    SORTED_BY_LAT.set(stations, sorted);
  }
  return sorted;
}

const stationLatitude = (station: TideStation): number => station.latitude;

// The stations within maxDistMeters of the position, nearest first, capped at k. The haversine
// runs only over the latitude band that can possibly be in range: binary search finds the band's
// start in the memoized latitude-sorted copy, and the scan stops at the band's end, so a
// nationwide list (thousands of stations) costs O(log n) plus the handful actually nearby.
export function nearestStations(
  stations: TideStation[],
  lat: number,
  lon: number,
  k: number,
  maxDistMeters: number,
): RankedStation[] {
  if (k <= 0) return [];
  const sorted = sortedByLat(stations);
  const latWindowDeg = maxDistMeters / LAT_METERS_PER_DEG;
  const ranked: RankedStation[] = [];
  for (let i = lowerBound(sorted, stationLatitude, lat - latWindowDeg); i < sorted.length; i += 1) {
    const station = sorted[i];
    if (station.latitude > lat + latWindowDeg) break;
    const distanceMeters = haversineMeters(lat, lon, station.latitude, station.longitude);
    if (distanceMeters <= maxDistMeters) ranked.push({ station, distanceMeters });
  }
  ranked.sort((a, b) => a.distanceMeters - b.distanceMeters);

  // Persisted catalogs can outlive a provider cleanup. Deduplicate after ranking so a conflicting
  // old record keeps the occurrence nearest to the requested position.
  const seenIds = new Set<string>();
  const unique: RankedStation[] = [];
  for (const candidate of ranked) {
    if (seenIds.has(candidate.station.id)) continue;
    seenIds.add(candidate.station.id);
    unique.push(candidate);
    if (unique.length >= k) break;
  }
  return unique;
}
