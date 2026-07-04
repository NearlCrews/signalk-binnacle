import type { NotePoint } from '$entities/poi';
import {
  categoryForSkIcon,
  type PoiCategory,
  type PoiType,
  poiCategoryForType,
} from '$entities/poi-icons';
import type { Bbox4 } from '$shared/geo';
import { isFiniteNumber } from '$shared/lib';
import { fetchKeyedResource, str } from '$shared/signalk';

// The note shape itself lives in $entities/poi (the POI search panel renders the same points, and
// cross-feature data flows through entities); re-exported here so the notes modules and the
// feature's public API keep one local reference.
export type { NotePoint };

// The marker reference handed to the app when a note is selected; enough to title the panel
// before its detail loads.
export interface NoteSelection {
  id: string;
  name: string;
  category: PoiCategory;
  // The marker position, so the chart can ring it from a list selection without re-querying the
  // rendered feature, and without moving the map.
  position: { latitude: number; longitude: number };
  attribution?: string;
  url?: string;
}

export const NOTES_PATH = '/signalk/v2/api/resources/notes';

// Map one keyed resource entry to a NotePoint, or undefined to skip it. An error payload
// ({state, statusCode, message}) has non-object values or no position, so it falls through here;
// only real notes with a position become markers.
function noteFromEntry(id: string, raw: unknown): NotePoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const note = raw as {
    name?: unknown;
    title?: unknown;
    url?: unknown;
    position?: { latitude?: unknown; longitude?: unknown };
    properties?: {
      skIcon?: unknown;
      source?: unknown;
      attribution?: unknown;
      crowsNest?: { type?: unknown };
    };
  };
  const lat = note.position?.latitude;
  const lon = note.position?.longitude;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return undefined;
  const props = note.properties ?? {};
  return {
    id,
    name: str(note.name) ?? str(note.title) ?? id,
    position: { latitude: lat, longitude: lon },
    category:
      poiCategoryForType(
        typeof props.crowsNest?.type === 'string' ? (props.crowsNest.type as PoiType) : undefined,
      ) ?? categoryForSkIcon(str(props.skIcon)),
    skIcon: str(props.skIcon),
    url: str(note.url),
    source: str(props.source),
    attribution: str(props.attribution),
  };
}

// Fetch notes within the viewport. The `provider` param is intentionally omitted so the
// server merges every notes provider (the default plus the POI providers); the bbox is a
// JSON array per the resources API schema. A provider whose results are query-scoped
// returns nothing without a bbox, so this must always carry one. A failed or unreachable
// fetch returns undefined so the overlay keeps the markers already shown rather than blanking
// them on a transient hiccup (a slow or rate-limited provider); a reachable area with no notes
// returns [].
export function fetchNotes(
  serverBase: string,
  token: string | undefined,
  bbox: Bbox4,
): Promise<NotePoint[] | undefined> {
  const params = new URLSearchParams({ bbox: JSON.stringify(bbox) });
  return fetchKeyedResource(
    serverBase,
    [`${NOTES_PATH}?${params}`],
    token,
    noteFromEntry,
    (url, status) => console.warn(`[notes] ${url} returned ${status}`),
  );
}
