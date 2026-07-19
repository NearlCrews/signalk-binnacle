import {
  type CurrentEvent,
  TIDE_WINDOW_HOURS,
  type TideEvent,
  type TideStation,
} from '$entities/tides';
import { isLatitude, isLongitude } from '$shared/geo';
import {
  DEG_TO_RAD,
  hasControlCharacters,
  isFiniteNumber,
  isRecord,
  readBoundedJson,
  withTimeout,
} from '$shared/lib';

// NOAA CO-OPS, the US tide and tidal-current authority. Public domain, key-free, CORS-open. The
// metadata API lists stations; the datagetter returns predictions for one station.
const MDAPI = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json';
const DATAGETTER = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MAX_STATIONS = 20_000;
const MAX_EVENTS = 200;
const MAX_STATION_ID_LENGTH = 128;
const MAX_STATION_NAME_LENGTH = 256;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

function safeStationId(value: unknown): value is string {
  return (
    cleanText(value, MAX_STATION_ID_LENGTH) !== undefined &&
    /^[A-Za-z0-9_-]+$/.test(value as string)
  );
}

function coopsUrl(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params)}`;
}

// Prediction times arrive as 'YYYY-MM-DD HH:MM' with no zone marker. The URLs request
// time_zone=gmt, so they parse as UTC here; a browser-local parse would shift every epoch
// comparison by the zone offset whenever the device timezone differs from the station's.
// Display formatting (formatClockTime) renders them in the device's local time.
function parseGmtTime(value: string): number {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

// A UTC calendar date as YYYY[sep]MM[sep]DD. The CO-OPS begin_date (no separator, interpreted in
// the requested time_zone=gmt) and the tides session-cache rollover key (dashed) both build from
// this one source, so the fetch window and the cache roll over at the same UTC-midnight instant.
export function utcYmd(ms: number, sep = ''): string {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}${sep}${month}${sep}${day}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, withTimeout());
  if (!response.ok) throw new Error(`CO-OPS ${response.status}`);
  const data = await readBoundedJson<unknown>(response);
  // The datagetter answers 200 with an { error } body for an unknown station or out-of-range
  // request, which the service worker would otherwise cache as if it were data. Treat it as a
  // failure so a no-data response is never stored or rendered as predictions.
  if (data && typeof data === 'object' && 'error' in data) throw new Error('CO-OPS error response');
  return data;
}

async function fetchStations(
  type: 'tidepredictions' | 'currentpredictions',
): Promise<TideStation[]> {
  const data = await fetchJson(coopsUrl(MDAPI, { type }));
  if (!isRecord(data) || !Array.isArray(data.stations) || data.stations.length > MAX_STATIONS) {
    throw new Error('Invalid CO-OPS station response');
  }
  return data.stations.flatMap((station) => {
    if (!isRecord(station)) return [];
    const id = safeStationId(station.id) ? station.id : undefined;
    const name = cleanText(station.name, MAX_STATION_NAME_LENGTH);
    if (!id || !name || !isLatitude(station.lat) || !isLongitude(station.lng)) return [];
    return [{ id, name, latitude: station.lat, longitude: station.lng }];
  });
}

export function fetchTideStations(): Promise<TideStation[]> {
  return fetchStations('tidepredictions');
}

export function fetchCurrentStations(): Promise<TideStation[]> {
  return fetchStations('currentpredictions');
}

export async function fetchTideEvents(
  stationId: string,
  now: () => number = Date.now,
): Promise<TideEvent[]> {
  if (!safeStationId(stationId)) throw new RangeError('Invalid CO-OPS station id');
  // interval=hilo returns just the high and low turning points; units=metric puts the height in
  // meters, which is already SI.
  const url = coopsUrl(DATAGETTER, {
    product: 'predictions',
    interval: 'hilo',
    datum: 'MLLW',
    units: 'metric',
    time_zone: 'gmt',
    format: 'json',
    begin_date: utcYmd(now()),
    range: String(TIDE_WINDOW_HOURS),
    station: stationId,
  });
  const data = await fetchJson(url);
  if (!isRecord(data) || !Array.isArray(data.predictions) || data.predictions.length > MAX_EVENTS) {
    throw new Error('Invalid CO-OPS tide prediction response');
  }
  return data.predictions.flatMap((p) => {
    if (!isRecord(p) || typeof p.t !== 'string' || typeof p.v !== 'string') return [];
    const timeMs = parseGmtTime(p.t);
    const heightMeters = Number.parseFloat(p.v);
    if (
      !isFiniteNumber(timeMs) ||
      !isFiniteNumber(heightMeters) ||
      Math.abs(heightMeters) > 100 ||
      (p.type !== 'H' && p.type !== 'L')
    ) {
      return [];
    }
    return [{ timeMs, heightMeters, kind: p.type === 'H' ? 'high' : 'low' } as TideEvent];
  });
}

export async function fetchCurrentEvents(
  stationId: string,
  now: () => number = Date.now,
): Promise<CurrentEvent[]> {
  if (!safeStationId(stationId)) throw new RangeError('Invalid CO-OPS station id');
  // units=metric returns Velocity_Major in cm/s (not knots, and not m/s), so divide by 100 for SI
  // m/s. It is signed (flood positive, ebb negative), but speed is a magnitude here: the flood-or-ebb
  // kind and the set in degrees carry the direction, so store the absolute value. The set is the mean
  // flood or ebb direction; slack has no direction and zero velocity.
  const url = coopsUrl(DATAGETTER, {
    product: 'currents_predictions',
    units: 'metric',
    time_zone: 'gmt',
    format: 'json',
    begin_date: utcYmd(now()),
    range: String(TIDE_WINDOW_HOURS),
    interval: 'MAX_SLACK',
    station: stationId,
  });
  const data = await fetchJson(url);
  const currentPredictions = isRecord(data) ? data.current_predictions : undefined;
  const cp = isRecord(currentPredictions) ? currentPredictions.cp : undefined;
  if (!Array.isArray(cp) || cp.length > MAX_EVENTS) {
    throw new Error('Invalid CO-OPS current prediction response');
  }
  return cp.flatMap((c) => {
    if (!isRecord(c) || typeof c.Time !== 'string') return [];
    const timeMs = parseGmtTime(c.Time);
    if (
      !isFiniteNumber(timeMs) ||
      !isFiniteNumber(c.Velocity_Major) ||
      Math.abs(c.Velocity_Major) > 10_000 ||
      (c.Type !== 'flood' && c.Type !== 'ebb' && c.Type !== 'slack')
    ) {
      return [];
    }
    const kind: CurrentEvent['kind'] =
      c.Type === 'flood' ? 'flood' : c.Type === 'ebb' ? 'ebb' : 'slack';
    const directionDeg =
      kind === 'flood' ? c.meanFloodDir : kind === 'ebb' ? c.meanEbbDir : undefined;
    // CO-OPS reports the set in degrees true; store it in radians (SI).
    const directionRad =
      isFiniteNumber(directionDeg) && directionDeg >= 0 && directionDeg <= 360
        ? directionDeg * DEG_TO_RAD
        : undefined;
    return [{ timeMs, velocityMps: Math.abs(c.Velocity_Major) / 100, directionRad, kind }];
  });
}
