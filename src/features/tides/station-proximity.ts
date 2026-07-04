import type { TideStation } from '$entities/tides';
import { haversineMeters } from '$shared/nav';

export interface RankedStation {
  station: TideStation;
  distanceMeters: number;
}

// Meters per degree of latitude, set slightly under the true minimum (~110,567 at the equator) so
// the prefilter window rounds outward and never excludes a station on the radius boundary.
const LAT_METERS_PER_DEG = 110_000;

// The stations within maxDistMeters of the position, nearest first, capped at k. A cheap latitude
// window skips the haversine and the per-station allocation for the bulk of a nationwide list
// (thousands of stations, of which only a handful are within any practical radius).
export function nearestStations(
  stations: TideStation[],
  lat: number,
  lon: number,
  k: number,
  maxDistMeters: number,
): RankedStation[] {
  const latWindowDeg = maxDistMeters / LAT_METERS_PER_DEG;
  const ranked: RankedStation[] = [];
  for (const station of stations) {
    if (Math.abs(station.latitude - lat) > latWindowDeg) continue;
    const distanceMeters = haversineMeters(lat, lon, station.latitude, station.longitude);
    if (distanceMeters <= maxDistMeters) ranked.push({ station, distanceMeters });
  }
  return ranked.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, k);
}
