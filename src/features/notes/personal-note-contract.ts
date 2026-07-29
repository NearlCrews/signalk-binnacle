import { isPoiCategory, type PoiCategory } from '$entities/poi-icons';
import { isLatLon, type LatLon } from '$shared/geo';
import { hasControlCharacters } from '$shared/lib';

export const PERSONAL_NOTE_NAMESPACE = 'binnacle.signalk.org';
export const PERSONAL_NOTE_KIND = 'personal-note';
export const PERSONAL_NOTE_SCHEMA_VERSION = 1;
export const MAX_PERSONAL_NOTE_NAME_LENGTH = 120;
export const MAX_PERSONAL_NOTE_TEXT_LENGTH = 4_000;
export const MAX_PERSONAL_NOTE_SYMBOL_LENGTH = 256;
const PERSONAL_NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PersonalNoteInput {
  name: string;
  text: string;
  category: PoiCategory;
  symbol?: string;
  position: LatLon;
}

export interface PersonalNoteOwnership {
  schemaVersion: typeof PERSONAL_NOTE_SCHEMA_VERSION;
  kind: typeof PERSONAL_NOTE_KIND;
  category: PoiCategory;
}

export interface PersonalNoteResource {
  title: string;
  description: string;
  mimeType: 'text/plain';
  position: LatLon;
  properties: {
    skIcon: string;
    source: 'Binnacle Chartplotter';
    [PERSONAL_NOTE_NAMESPACE]: PersonalNoteOwnership;
  };
}

function cleanLine(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed || hasControlCharacters(trimmed)) return '';
  return trimmed.slice(0, maxLength);
}

export function cleanPersonalNoteText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 && character !== '\n' && character !== '\t') return undefined;
    if (code === 0x7f) return undefined;
  }
  return normalized.slice(0, MAX_PERSONAL_NOTE_TEXT_LENGTH) || undefined;
}

export function isPersonalNoteId(value: string): boolean {
  return PERSONAL_NOTE_ID.test(value);
}

export function cleanPersonalNoteInput(value: PersonalNoteInput): PersonalNoteInput | undefined {
  if (!isLatLon(value.position) || !isPoiCategory(value.category)) return undefined;
  const name =
    cleanLine(value.name, MAX_PERSONAL_NOTE_NAME_LENGTH) ||
    cleanLine('Personal note', MAX_PERSONAL_NOTE_NAME_LENGTH);
  const text = cleanPersonalNoteText(value.text) ?? '';
  const symbol = value.symbol
    ? cleanLine(value.symbol, MAX_PERSONAL_NOTE_SYMBOL_LENGTH) || undefined
    : undefined;
  return {
    name,
    text,
    category: value.category,
    ...(symbol ? { symbol } : {}),
    position: value.position,
  };
}

export function personalNoteResource(value: PersonalNoteInput): PersonalNoteResource | undefined {
  const note = cleanPersonalNoteInput(value);
  if (!note) return undefined;
  return {
    title: note.name,
    description: note.text,
    mimeType: 'text/plain',
    position: note.position,
    properties: {
      skIcon: note.symbol ?? note.category,
      source: 'Binnacle Chartplotter',
      [PERSONAL_NOTE_NAMESPACE]: {
        schemaVersion: PERSONAL_NOTE_SCHEMA_VERSION,
        kind: PERSONAL_NOTE_KIND,
        category: note.category,
      },
    },
  };
}

export function personalNoteOwnership(value: unknown): PersonalNoteOwnership | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const marker = value as {
    schemaVersion?: unknown;
    kind?: unknown;
    category?: unknown;
  };
  return marker.schemaVersion === PERSONAL_NOTE_SCHEMA_VERSION &&
    marker.kind === PERSONAL_NOTE_KIND &&
    typeof marker.category === 'string' &&
    isPoiCategory(marker.category)
    ? {
        schemaVersion: PERSONAL_NOTE_SCHEMA_VERSION,
        kind: PERSONAL_NOTE_KIND,
        category: marker.category,
      }
    : undefined;
}
