import { isLatitude, isLongitude } from '$shared/geo';
import { hasControlCharacters, isRecord } from '$shared/lib';
import type { TideStation } from './tides-types';

export const MAX_TIDE_STATION_ID_LENGTH = 128;
export const MAX_TIDE_STATION_NAME_LENGTH = 256;

export function cleanTideStationText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

// A station snapshot crosses the MapLibre feature boundary before a click returns it. Revalidate
// that rendered copy with the same text and coordinate bounds used by both prediction providers.
export function isTideStation(value: unknown): value is TideStation {
  if (!isRecord(value)) return false;
  const id = cleanTideStationText(value.id, MAX_TIDE_STATION_ID_LENGTH);
  const name = cleanTideStationText(value.name, MAX_TIDE_STATION_NAME_LENGTH);
  return (
    id === value.id &&
    name === value.name &&
    isLatitude(value.latitude) &&
    isLongitude(value.longitude)
  );
}
