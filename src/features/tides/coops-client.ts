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
  const data = (await fetchJson(`${MDAPI}?type=${type}`)) as {
    stations?: Array<{ id: string; name: string; lat: number; lng: number }>;
  };
  return (data.stations ?? [])
    .flatMap((station) => {
      const id = cleanText(station.id, MAX_STATION_ID_LENGTH);
      const name = cleanText(station.name, MAX_STATION_NAME_LENGTH);
      if (!id || !name || !isLatitude(station.lat) || !isLongitude(station.lng)) return [];
      return [{ id, name, latitude: station.lat, longitude: station.lng }];
    })
    .slice(0, MAX_STATIONS);
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
  // interval=hilo returns just the high and low turning points; units=metric puts the height in
  // meters, which is already SI.
  const url = `${DATAGETTER}?product=predictions&interval=hilo&datum=MLLW&units=metric&time_zone=gmt&format=json&begin_date=${utcYmd(now())}&range=${TIDE_WINDOW_HOURS}&station=${stationId}`;
  const data = (await fetchJson(url)) as {
    predictions?: Array<{ t: string; v: string; type: string }>;
  };
  return (data.predictions ?? [])
    .flatMap((p) => {
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
    })
    .slice(0, MAX_EVENTS);
}

export async function fetchCurrentEvents(
  stationId: string,
  now: () => number = Date.now,
): Promise<CurrentEvent[]> {
  // units=metric returns Velocity_Major in cm/s (not knots, and not m/s), so divide by 100 for SI
  // m/s. It is signed (flood positive, ebb negative), but speed is a magnitude here: the flood-or-ebb
  // kind and the set in degrees carry the direction, so store the absolute value. The set is the mean
  // flood or ebb direction; slack has no direction and zero velocity.
  const url = `${DATAGETTER}?product=currents_predictions&units=metric&time_zone=gmt&format=json&begin_date=${utcYmd(now())}&range=${TIDE_WINDOW_HOURS}&interval=MAX_SLACK&station=${stationId}`;
  const data = (await fetchJson(url)) as {
    current_predictions?: {
      cp?: Array<{
        Type: string;
        Time: string;
        Velocity_Major: number;
        meanFloodDir?: number;
        meanEbbDir?: number;
      }>;
    };
  };
  const cp = data.current_predictions?.cp ?? [];
  return cp
    .flatMap((c) => {
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
    })
    .slice(0, MAX_EVENTS);
}
