import type { PoiType } from '$entities/poi-icons';
import { readBoundedJson, withTimeout } from '$shared/lib';
import { asKeyedObject, authInit, str } from '$shared/signalk';
import { NOTES_PATH } from './notes-client';

const ITEM_KINDS = [
  'text',
  'measure',
  'count',
  'availability',
  'flag',
  'rating',
  'link',
  'note',
] as const;

type NormalizedItemKind = (typeof ITEM_KINDS)[number];
const MAX_SECTIONS = 32;
const MAX_ITEMS_PER_SECTION = 100;
const MAX_FALLBACK_TEXT = 20_000;

function cleanText(value: unknown, maxLength: number): string | undefined {
  const text = str(value)?.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

export interface NormalizedItem {
  label: string;
  value: string | number | boolean;
  kind?: NormalizedItemKind;
  unit?: string;
}

export interface NormalizedSection {
  id: string;
  title: string;
  items: NormalizedItem[];
}

export interface NoteDetail {
  id: string;
  name: string;
  type?: PoiType;
  sections?: NormalizedSection[];
  fallbackText?: string;
  attribution?: string;
  sources?: string[];
  url?: string;
}

const V1 = '/signalk/v1/api/resources/notes';

// A provider description is untrusted, so it is shown as plain text; its markup is never injected.
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FALLBACK_TEXT);
}

// A provider url is untrusted, so follow only http(s); this rejects javascript: and data:.
export function safeHttpUrl(raw: string): string | undefined {
  if (raw.length > 2048) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // not a parseable absolute url
  }
  return undefined;
}

function isItemKind(value: unknown): value is NormalizedItemKind {
  return (ITEM_KINDS as readonly string[]).includes(value as string);
}

function parseItem(raw: unknown): NormalizedItem | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { label?: unknown; value?: unknown; kind?: unknown; unit?: unknown };
  const label = cleanText(r.label, 256);
  if (label === undefined) return undefined;
  const value = r.value;
  if (
    (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    return undefined;
  }
  const boundedValue = typeof value === 'string' ? value.slice(0, 10_000) : value;
  const item: NormalizedItem = { label, value: boundedValue };
  if (isItemKind(r.kind)) item.kind = r.kind;
  if (
    item.kind === 'rating' &&
    (typeof item.value !== 'number' || item.value < 0 || item.value > 5)
  ) {
    return undefined;
  }
  const unit = cleanText(r.unit, 64);
  if (unit !== undefined) item.unit = unit;
  // The panel renders units only for measures, so a kind-less item with a unit would silently
  // drop it; a unit is what makes a measure.
  if (item.unit !== undefined && item.kind === undefined) item.kind = 'measure';
  return item;
}

function parseSections(raw: unknown): NormalizedSection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const sections: NormalizedSection[] = [];
  for (const s of raw.slice(0, MAX_SECTIONS)) {
    if (!s || typeof s !== 'object') continue;
    const sec = s as { id?: unknown; title?: unknown; items?: unknown };
    const title = cleanText(sec.title, 256);
    if (title === undefined || !Array.isArray(sec.items)) continue;
    const items = sec.items
      .slice(0, MAX_ITEMS_PER_SECTION)
      .map(parseItem)
      .filter((i): i is NormalizedItem => i !== undefined);
    if (items.length === 0) continue;
    sections.push({ id: cleanText(sec.id, 256) ?? title, title, items });
  }
  return sections.length > 0 ? sections : undefined;
}

async function tryFetch(
  url: string,
  token: string | undefined,
  id: string,
): Promise<NoteDetail | undefined> {
  try {
    const response = await fetch(url, withTimeout(authInit(token)));
    if (!response.ok) return undefined;
    const keyed = asKeyedObject(await readBoundedJson<unknown>(response));
    if (!keyed) return undefined;
    const note = keyed as {
      name?: unknown;
      title?: unknown;
      url?: unknown;
      description?: unknown;
      properties?: {
        attribution?: unknown;
        sources?: unknown;
        crowsNest?: { schemaVersion?: unknown; type?: unknown; sections?: unknown };
      };
    };
    const props = note.properties ?? {};
    const cn = props.crowsNest;
    const detail: NoteDetail = {
      id,
      name: cleanText(note.name, 256) ?? cleanText(note.title, 256) ?? id,
      type: typeof cn?.type === 'string' ? (cn.type as PoiType) : undefined,
      attribution: cleanText(props.attribution, 1024),
      sources: Array.isArray(props.sources)
        ? [
            ...new Set(
              props.sources
                .slice(0, 32)
                .map((source) => cleanText(source, 256))
                .filter((source): source is string => source !== undefined),
            ),
          ]
        : undefined,
      url: cleanText(note.url, 2048),
    };
    // Only schema version 1 sections are mapped; a later version falls through to the plain-text body.
    const sections = cn?.schemaVersion === 1 ? parseSections(cn.sections) : undefined;
    if (sections) detail.sections = sections;
    else detail.fallbackText = plainText(str(note.description) ?? '') || undefined;
    return detail;
  } catch (error) {
    // Non-ok responses already returned undefined above, so reaching here is a genuine
    // network or parse failure: leave a breadcrumb so a provider misconfiguration is not
    // indistinguishable from "no detail exists".
    console.warn(`[notes] detail fetch failed: ${url}`, error);
    return undefined;
  }
}

export async function fetchNoteDetail(
  base: string,
  token: string | undefined,
  id: string,
): Promise<NoteDetail | undefined> {
  // An empty id would hit the collection endpoint and parse as a bogus detail; refuse it.
  if (!id) return undefined;
  const path = `/${encodeURIComponent(id)}`;
  // The v1 leg is a last-resort fallback: marker ids only come from the v2 list, so it is
  // reachable only if a v2 list once served ids and the server later stopped answering v2.
  return (
    (await tryFetch(`${base}${NOTES_PATH}${path}`, token, id)) ??
    (await tryFetch(`${base}${V1}${path}`, token, id))
  );
}

export interface NoteDetailLoader {
  load(id: string): Promise<NoteDetail | undefined>;
}

// The most note details to keep memoized, so a long session of tapping markers cannot grow the
// cache without bound. Details are small and reopening is the common case, so the cap is generous.
const MAX_DETAIL_ENTRIES = 64;

// Memoizes detail by id so reopening a marker is instant; a failed fetch is not cached, so it
// stays retryable. An in-flight load is shared rather than duplicated. The token is read through a
// getter when a load starts, not captured at construction: the loader is built once at connect, so a
// token approved later (from another tab) reaches the next load rather than freezing at the
// connect-time value. A token that rotates mid-flight is not re-read; the shared in-flight load keeps
// the token it began with.
export function createNoteDetailLoader(
  base: string,
  getToken: () => string | undefined,
): NoteDetailLoader {
  const cache = new Map<string, NoteDetail>();
  const inflight = new Map<string, Promise<NoteDetail | undefined>>();
  return {
    load(id) {
      const cached = cache.get(id);
      if (cached) {
        // LRU refresh: re-insert on hit so a frequently reopened marker is not the first evicted
        // (Map iteration order is insertion order, and eviction takes the front).
        cache.delete(id);
        cache.set(id, cached);
        return Promise.resolve(cached);
      }
      const pending = inflight.get(id);
      if (pending) return pending;
      const promise = fetchNoteDetail(base, getToken(), id)
        .then((detail) => {
          if (detail) {
            if (cache.size >= MAX_DETAIL_ENTRIES) {
              const oldest = cache.keys().next().value;
              if (oldest !== undefined) cache.delete(oldest);
            }
            cache.set(id, detail);
          }
          return detail;
        })
        .finally(() => {
          // Clear on settle (resolve or reject) so a failure never wedges the id.
          inflight.delete(id);
        });
      inflight.set(id, promise);
      return promise;
    },
  };
}
