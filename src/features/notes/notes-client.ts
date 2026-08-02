import type { NotePoint } from '$entities/poi';
import {
  categoryForSkIcon,
  type PoiCategory,
  type PoiType,
  poiCategoryForType,
} from '$entities/poi-icons';
import { type Bbox4, fetchAcrossSeam, isLatLon } from '$shared/geo';
import { hasControlCharacters } from '$shared/lib';
import { fetchKeyedResource, str } from '$shared/signalk';
import {
  cleanPersonalNoteText,
  isPersonalNoteId,
  PERSONAL_NOTE_NAMESPACE,
  personalNoteOwnership,
} from './personal-note-contract';

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
  description?: string;
  skIcon?: string;
  ownedByBinnacle?: boolean;
  attribution?: string;
  url?: string;
}

export const NOTES_PATH = '/signalk/v2/api/resources/notes';
const NOTES_V1_PATH = '/signalk/v1/api/resources/notes';
export const MAX_NOTES_PER_VIEW = 5_000;

function cleanId(value: string): string | undefined {
  const id = value.trim();
  return id && id.length <= 512 && !hasControlCharacters(id) ? id : undefined;
}

// Map one keyed resource entry to a NotePoint, or undefined to skip it. An error payload
// ({state, statusCode, message}) has non-object values or no position, so it falls through here;
// only real notes with a position become markers.
function noteFromEntry(id: string, raw: unknown): NotePoint | undefined {
  const resourceId = cleanId(id);
  if (!resourceId) return undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const note = raw as {
    name?: unknown;
    title?: unknown;
    description?: unknown;
    url?: unknown;
    position?: { latitude?: unknown; longitude?: unknown };
    properties?: {
      skIcon?: unknown;
      source?: unknown;
      attribution?: unknown;
      crowsNest?: { type?: unknown };
      [PERSONAL_NOTE_NAMESPACE]?: unknown;
    };
  };
  const position = note.position;
  if (!isLatLon(position)) return undefined;
  const props = note.properties ?? {};
  const ownership = isPersonalNoteId(id)
    ? personalNoteOwnership(props[PERSONAL_NOTE_NAMESPACE])
    : undefined;
  const clean = (value: unknown, maxLength: number): string | undefined => {
    const text = str(value)?.trim();
    return text ? text.slice(0, maxLength) : undefined;
  };
  return {
    id: resourceId,
    name: clean(note.name, 256) ?? clean(note.title, 256) ?? resourceId,
    position,
    category:
      ownership?.category ??
      poiCategoryForType(
        typeof props.crowsNest?.type === 'string' ? (props.crowsNest.type as PoiType) : undefined,
      ) ??
      categoryForSkIcon(clean(props.skIcon, 256)),
    description: ownership ? cleanPersonalNoteText(note.description) : undefined,
    skIcon: clean(props.skIcon, 256),
    ownedByBinnacle: ownership ? true : undefined,
    url: clean(note.url, 2048),
    source: clean(props.source, 256),
    attribution: clean(props.attribution, 1024),
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
  // A padded viewport at the antimeridian carries unwrapped longitudes, which no server can match.
  // fetchAcrossSeam asks for each in-range piece and merges; away from the seam that is one box and
  // one request, the same as before. The cap is applied across the merged result, not per piece.
  let accepted = 0;
  return fetchAcrossSeam(
    bbox,
    (box) => {
      const params = new URLSearchParams({ bbox: JSON.stringify(box) });
      return fetchKeyedResource(
        serverBase,
        [`${NOTES_PATH}?${params}`, `${NOTES_V1_PATH}?${params}`],
        token,
        (id, raw) => {
          if (accepted >= MAX_NOTES_PER_VIEW) return undefined;
          const note = noteFromEntry(id, raw);
          if (note) accepted += 1;
          return note;
        },
        (url, status) => console.warn(`[notes] ${url} returned ${status}`),
      );
    },
    (note) => note.id,
  );
}
