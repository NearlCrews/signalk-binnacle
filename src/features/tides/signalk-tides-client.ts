import {
  TIDE_WINDOW_HOURS,
  type TideEvent,
  type TideReading,
  type TideStation,
} from '$entities/tides';
import { isLatitude, isLongitude } from '$shared/geo';
import { HOUR_MS, hasControlCharacters } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import { fetchAuthedJson } from '$shared/signalk';

// The signalk-tides plugin (npm package signalk-tides, plugin id "tides") registers a "tides"
// resource that answers GET /signalk/v2/api/resources/tides with tide extremes for the vessel's
// position. The 1.x response is { station: { name, position: { latitude, longitude } }, extremes:
// [{ time, type: "High" | "Low", value }] }; the 2.x response is { station: { id, name, latitude,
// longitude }, extremes: [{ time, label: "High" | "Low", level, high, low }] }. Both carry heights
// in meters and ISO timestamps, so the parse accepts either shape.
export const SIGNALK_TIDES_PLUGIN_ID = 'tides';

const RESOURCE_PATH = '/signalk/v2/api/resources/tides';
// The plugin answers with about a week of extremes. Trim to the CO-OPS window (the current UTC
// day plus 48 hours) so the panel's curve and next-event readouts read the same whichever source
// served them.
const SYNTHETIC_STATION = 'Local tides (signalk-tides)';
const MAX_EVENTS = 200;
const MAX_STATION_ID_LENGTH = 128;
const MAX_STATION_NAME_LENGTH = 256;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

export interface SignalkTidesOptions {
  origin?: string;
  token?: string;
  now?: () => number;
}

// Not the same as isFiniteNumber from $shared/lib: the string branch is intentional because the
// v1 signalk-tides API returns height and level values as strings, not numbers.
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function eventKind(raw: Record<string, unknown>): 'high' | 'low' | undefined {
  const label = raw.type ?? raw.label;
  if (typeof label === 'string') {
    const lower = label.toLowerCase();
    if (lower === 'high') return 'high';
    if (lower === 'low') return 'low';
  }
  if (raw.high === true) return 'high';
  if (raw.low === true) return 'low';
  return undefined;
}

function parseExtremes(raw: unknown): TideEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: TideEvent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const kind = eventKind(record);
    const heightMeters = toFiniteNumber(record.value ?? record.level);
    const timeMs = typeof record.time === 'string' ? Date.parse(record.time) : Number.NaN;
    if (
      !kind ||
      heightMeters === undefined ||
      Math.abs(heightMeters) > 100 ||
      !Number.isFinite(timeMs)
    ) {
      continue;
    }
    events.push({ timeMs, heightMeters, kind });
    if (events.length >= MAX_EVENTS) break;
  }
  return events.sort((a, b) => a.timeMs - b.timeMs);
}

function parseStation(raw: unknown, lat: number, lon: number): TideStation {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const position =
    record.position && typeof record.position === 'object'
      ? (record.position as Record<string, unknown>)
      : undefined;
  const rawLatitude = toFiniteNumber(record.latitude ?? position?.latitude);
  const rawLongitude = toFiniteNumber(record.longitude ?? position?.longitude);
  const latitude = isLatitude(rawLatitude) ? rawLatitude : undefined;
  const longitude = isLongitude(rawLongitude) ? rawLongitude : undefined;
  return {
    id: cleanText(record.id, MAX_STATION_ID_LENGTH) ?? SIGNALK_TIDES_PLUGIN_ID,
    name: cleanText(record.name, MAX_STATION_NAME_LENGTH) ?? SYNTHETIC_STATION,
    latitude: latitude ?? lat,
    longitude: longitude ?? lon,
  };
}

// CAVEAT: the Resources API merges multiple providers of one type with a shallow Object.assign,
// so this top-level parse assumes the single signalk-tides provider; a second tides provider on
// one server would corrupt the merged shape upstream of us.
// Parse a tides-resource body into a TideReading, or undefined when it carries no usable events
// in the window, so the loader can fall back to CO-OPS. Exported for tests.
export function parseTidesResource(
  body: unknown,
  lat: number,
  lon: number,
  nowMs: number,
): TideReading | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  // From today's UTC midnight, not from nowMs, matching the CO-OPS day window so a persisted
  // reading replays identically from either source; upcomingEvents trims to now at render time.
  const now = new Date(nowMs);
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const windowEnd = windowStart + TIDE_WINDOW_HOURS * HOUR_MS;
  const events = parseExtremes(record.extremes).filter(
    (event) => event.timeMs >= windowStart && event.timeMs <= windowEnd,
  );
  if (events.length === 0) return undefined;
  const station = parseStation(record.station, lat, lon);
  return {
    station,
    distanceMeters: haversineMeters(lat, lon, station.latitude, station.longitude),
    events,
  };
}

// Fetch the plugin's tide reading for the vessel's position. Never throws: any failure (plugin
// mid-start, no position yet, auth, network) returns undefined so the loader falls back to CO-OPS
// rather than surfacing an error a working fallback would have absorbed.
export async function fetchSignalkTidesReading(
  lat: number,
  lon: number,
  options: SignalkTidesOptions = {},
): Promise<TideReading | undefined> {
  const body = await fetchAuthedJson<unknown>(
    `${options.origin ?? ''}${RESOURCE_PATH}`,
    options.token,
  );
  if (body === undefined) return undefined;
  return parseTidesResource(body, lat, lon, options.now?.() ?? Date.now());
}
