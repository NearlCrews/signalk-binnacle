import { isLatitude, isLongitude } from '$shared/geo';
import { cleanBoundedText, isRecord } from '$shared/lib';
import type { TideStation } from './tides-types';

export const MAX_TIDE_STATION_ID_LENGTH = 128;
export const MAX_TIDE_STATION_NAME_LENGTH = 256;
// The highest tide range anywhere on earth is the Bay of Fundy's, near 17 m; 100 m is far past any
// real reading, so a value beyond it is a provider fault (a sentinel, a unit mix-up), not water.
export const MAX_PLAUSIBLE_TIDE_HEIGHT_M = 100;
// One reading's event list is bounded so a runaway provider response cannot grow the panel without
// limit. 200 covers well over a week of highs and lows at any station.
export const MAX_TIDE_EVENTS = 200;

// A station snapshot crosses the MapLibre feature boundary before a click returns it. Revalidate
// that rendered copy with the same text and coordinate bounds used by both prediction providers.
export function isTideStation(value: unknown): value is TideStation {
  if (!isRecord(value)) return false;
  const id = cleanBoundedText(value.id, MAX_TIDE_STATION_ID_LENGTH);
  const name = cleanBoundedText(value.name, MAX_TIDE_STATION_NAME_LENGTH);
  return (
    id === value.id &&
    name === value.name &&
    isLatitude(value.latitude) &&
    isLongitude(value.longitude)
  );
}
