import type { LatLon } from '$shared/geo';
import { DEG_TO_RAD } from '$shared/lib';
import { EARTH_RADIUS_M, haversineMeters, normalizeLonDeltaDeg } from './distance';

// The Mercator isometric-latitude difference between two latitudes (radians), the stretched-latitude
// term shared by the rhumb distance and bearing. Both run per waypoint leg on every course update.
function rhumbDPhi(lat1Rad: number, lat2Rad: number): number {
  return Math.log(Math.tan(Math.PI / 4 + lat2Rad / 2) / Math.tan(Math.PI / 4 + lat1Rad / 2));
}

const MERCATOR_MAX_LAT_RAD = (89.999999 * Math.PI) / 180;
const mercatorLatitudeRad = (latitude: number): number =>
  Math.max(-MERCATOR_MAX_LAT_RAD, Math.min(MERCATOR_MAX_LAT_RAD, latitude * DEG_TO_RAD));

// Rhumb-line (constant-bearing) distance: the line you actually steer over a short to medium leg.
export function rhumbDistanceMeters(from: LatLon, to: LatLon): number {
  const dLatRad = (to.latitude - from.latitude) * DEG_TO_RAD;
  const dLonRad = normalizeLonDeltaDeg(to.longitude - from.longitude) * DEG_TO_RAD;
  const lat1 = mercatorLatitudeRad(from.latitude);
  const lat2 = mercatorLatitudeRad(to.latitude);
  const dPhi = rhumbDPhi(lat1, lat2);
  const q = Math.abs(dPhi) > 1e-12 ? dLatRad / dPhi : Math.cos(lat1);
  return Math.hypot(dLatRad, q * dLonRad) * EARTH_RADIUS_M;
}

// Constant compass bearing from -> to, radians clockwise from true north in [0, 2pi).
export function rhumbBearingRad(from: LatLon, to: LatLon): number {
  const dLonRad = normalizeLonDeltaDeg(to.longitude - from.longitude) * DEG_TO_RAD;
  const lat1 = mercatorLatitudeRad(from.latitude);
  const lat2 = mercatorLatitudeRad(to.latitude);
  const dPhi = rhumbDPhi(lat1, lat2);
  return (Math.atan2(dLonRad, dPhi) + 2 * Math.PI) % (2 * Math.PI);
}

// Initial great-circle bearing from one point to another, used internally to compute the
// great-circle cross-track error.
function greatCircleBearingRad(from: LatLon, to: LatLon): number {
  const lat1 = from.latitude * DEG_TO_RAD;
  const lat2 = to.latitude * DEG_TO_RAD;
  const dLon = normalizeLonDeltaDeg(to.longitude - from.longitude) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
}

// Signed cross-track distance (meters) of `position` from the great-circle leg from -> to.
// Positive is to starboard of the leg (right of the direction of travel), negative to port.
// Test-only reference: the production fallback uses the rhumb-line rhumbCrossTrackErrorMeters; this
// great-circle version is kept to cross-check it and is intentionally not exported from the index.
export function crossTrackErrorMeters(from: LatLon, to: LatLon, position: LatLon): number {
  const d13 = haversineMeters(from.latitude, from.longitude, position.latitude, position.longitude);
  const theta13 = greatCircleBearingRad(from, position);
  const theta12 = greatCircleBearingRad(from, to);
  const ratio = Math.max(
    -1,
    Math.min(1, Math.sin(d13 / EARTH_RADIUS_M) * Math.sin(theta13 - theta12)),
  );
  // Starboard-positive, matching the server's calcValues.crossTrackError convention (reconciled
  // during live verification), so the computed fallback agrees with a provider value.
  return Math.asin(ratio) * EARTH_RADIUS_M;
}

// Signed cross-track distance (meters) of `position` from the rhumb-line (constant-bearing) leg
// from -> to, the line a helmsman actually steers. This is the rhumb-geometry sibling of
// crossTrackErrorMeters, kept consistent with rhumbDistanceMeters and rhumbBearingRad so the
// computed fallback (distance, bearing, XTE, and VMG) shares one geometry, matching how the server
// publishes a single internally-consistent calcMethod. Over the short to medium legs Binnacle
// follows, the rhumb leg is near-straight, so the perpendicular offset is approximated as
// d13 * sin(theta13 - theta12) using rhumb bearings: the along-leg component is dropped and only
// the across-leg projection is kept. Positive is to starboard of the leg, matching
// crossTrackErrorMeters and the server's convention, so steerSide reads the same sign.
export function rhumbCrossTrackErrorMeters(from: LatLon, to: LatLon, position: LatLon): number {
  const d13 = rhumbDistanceMeters(from, position);
  const theta13 = rhumbBearingRad(from, position);
  const theta12 = rhumbBearingRad(from, to);
  return d13 * Math.sin(theta13 - theta12);
}

// Velocity made good toward the mark: the boat's velocity vector projected onto the bearing to the
// mark. Positive closes the mark, negative opens it. SOG m/s, COG radians clockwise from north.
export function vmgMps(position: LatLon, mark: LatLon, sogMps: number, cogRad: number): number {
  const bearing = rhumbBearingRad(position, mark);
  return sogMps * Math.cos(cogRad - bearing);
}

// Seconds to cover `distanceMeters` at `speedMps`. Undefined for a non-positive speed (no ETA).
export function etaSeconds(distanceMeters: number, speedMps: number): number | undefined {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return undefined;
  if (!Number.isFinite(speedMps) || speedMps <= 0) return undefined;
  return distanceMeters / speedMps;
}

// The side to steer toward to close a cross-track error back onto the leg. The cross-track sign is
// starboard-positive (see crossTrackErrorMeters), so a positive error puts the boat to starboard of
// the track and the correction is to port, and vice versa. Zero or non-finite yields no side.
export function steerSide(crossTrackMeters: number): 'port' | 'starboard' | null {
  if (!Number.isFinite(crossTrackMeters) || crossTrackMeters === 0) return null;
  return crossTrackMeters > 0 ? 'port' : 'starboard';
}
