import { isLatitude, isLongitude, type LatLon } from './geo-guards';
import type { MapView } from './view';

// A tenth of a degree (about 11 km): position-keyed caches treat a cell as one spot, so GPS
// drift at anchor or a small pan maps to one key instead of refetching per fix.
const COORD_CELL_DEG = 0.1;

export function quantizeCellDeg(v: number): string {
  return (Math.round(v / COORD_CELL_DEG) * COORD_CELL_DEG).toFixed(1);
}

// A position rounded to `decimals` places as a "lat,lon" string, about 110 m at the default 3.
// Kept as a string so a position-keyed $derived halts on an unchanged cell: a fresh tuple each GPS
// tick would refetch (and burst provider 400s), but an equal string does not.
export function quantizeLatLonKey(pos: LatLon, decimals = 3): string {
  return `${pos.latitude.toFixed(decimals)},${pos.longitude.toFixed(decimals)}`;
}

// The inverse of quantizeLatLonKey: a "lat,lon" key back to the position it stood for, for a caller
// that keys a cache by the string. Undefined unless the key holds exactly two in-range coordinates,
// so a truncated or non-numeric key yields no position instead of a NaN or half-missing one.
export function parseLatLonKey(key: string): LatLon | undefined {
  const parts = key.split(',');
  if (parts.length !== 2) return undefined;
  // Number('') and Number(' ') are both 0, so an empty component would otherwise parse as Null Island.
  if (parts.some((part) => part.trim() === '')) return undefined;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!isLatitude(latitude) || !isLongitude(longitude)) return undefined;
  return { latitude, longitude };
}

// A viewport quantized to one tile cell at its zoom (roughly a quarter of a typical viewport
// width), so a viewport-keyed derivation re-runs when the chart meaningfully moves rather than at
// GPS rate while follow recenters on every fix. The quarter-zoom step lets a pinch settle into a
// new key without churning per animation frame.
export function quantizeViewCellKey(view: MapView): string {
  const cellDeg = 360 / 2 ** view.zoom;
  return `${Math.round(view.lat / cellDeg)}:${Math.round(view.lon / cellDeg)}:${Math.round(view.zoom * 4)}`;
}
