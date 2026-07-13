import { isFiniteNumber } from '$shared/lib';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export function isLatLon(value: unknown): value is LatLon {
  return (
    typeof value === 'object' &&
    value !== null &&
    isLatitude((value as LatLon).latitude) &&
    isLongitude((value as LatLon).longitude)
  );
}

// A finite latitude in [-90, 90] or longitude in [-180, 180]. The one place the coordinate ranges are
// spelled out, so a stored view, an untrusted API position, and any other caller share the bounds.
export function isLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

// GeoJSON coordinate order is longitude first; Signal K positions and the Course API use a
// {latitude, longitude} object. These two functions are the only place that crosses the two
// orderings, so a mismatch lives in exactly one tested spot.
export type LonLat = [number, number];

// A GeoJSON [lon, lat] coordinate pair. Shared by the route and track GeoJSON parsers, which all
// filter raw coordinate arrays down to numeric pairs before mapping them to LatLon.
export function isLonLat(value: unknown): value is LonLat {
  // Finite, not just number, matching isLatLon: JSON.parse turns an extreme literal into Infinity,
  // and a non-finite coordinate poisons every distance, bounds, and rendered line downstream. The
  // length guard rejects empty and single-element arrays; a GeoJSON position may legitimately carry
  // a third elevation element, so the upper bound is open and only indices 0 and 1 are read.
  return Array.isArray(value) && value.length >= 2 && isLongitude(value[0]) && isLatitude(value[1]);
}

export function lonLatToLatLon([longitude, latitude]: LonLat): LatLon {
  return { latitude, longitude };
}

export function latLonToLonLat(position: LatLon): LonLat {
  return [position.longitude, position.latitude];
}

// Round a position to a fixed number of decimal places. Computed and AI-drafted positions arrive as
// full-precision doubles (13 to 14 decimals), which the on-chart draw store refuses for excessive
// precision; the caller rounds to the store's limit before seeding. Six decimals is ~0.11 m and nine
// is ~0.1 mm, both far beyond GPS resolution, so the rounding is lossless for navigation.
export function roundLatLon(position: LatLon, decimals: number): LatLon {
  return {
    latitude: Number(position.latitude.toFixed(decimals)),
    longitude: Number(position.longitude.toFixed(decimals)),
  };
}

export function asNumber(value: unknown): number | undefined {
  // Finite only: a NaN reaching the store would flow into display math and data-driven expressions.
  return isFiniteNumber(value) ? value : undefined;
}
