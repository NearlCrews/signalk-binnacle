import type { Bbox4 } from '$shared/geo';
import { DAY_MS } from '$shared/lib';
import { createExpiringStore, type ExpiringStore } from '$shared/storage';
import { bboxKey, NotesCache } from './notes-cache';
import { fetchNotes, type NotePoint } from './notes-client';

// After a failed fetch, back off this long before retrying so a stationary map recovers from a
// transient hiccup without hammering a flaky provider (the tides loader uses the same pattern).
const RETRY_COOLDOWN_MS = 30_000;
// Fetched note sets persist across reloads in IndexedDB (which, unlike the service worker, also
// works over plain http). POIs barely change, so a week-old set is still worth showing; the
// in-memory TTL drives the real refresh once a set has been seen this session.
const PERSIST_TTL_MS = 7 * DAY_MS;
const MAX_PERSIST_ENTRIES = 24;

// Where the overlay's notes come from: the viewport-keyed in-memory cache, the cross-reload
// persisted store, then the network, with the single-flight and failure-cooldown state owned here
// so the overlay's sync only orchestrates rendering.
export interface NotesSource {
  // A recent fetch whose padded area covers the viewport, or undefined. Offline, an expired entry
  // still answers: stale POIs beat a chart that goes blank.
  cached(viewport: Bbox4, offline: boolean): NotePoint[] | undefined;
  inFlight(): boolean;
  // True while backing off from a failed fetch.
  coolingDown(): boolean;
  // Fetch (or promote from the persisted store) the notes for a padded area, caching a success.
  // Resolves undefined on a transient failure, which also starts the retry cooldown.
  load(fetchBbox: Bbox4): Promise<NotePoint[] | undefined>;
}

export function createNotesSource(
  serverBase: string,
  getToken: () => string | undefined,
  persistStore?: ExpiringStore<NotePoint[]>,
): NotesSource {
  const persist =
    persistStore ??
    createExpiringStore<NotePoint[]>('binnacle-notes', { maxEntries: MAX_PERSIST_ENTRIES });
  // A viewport-keyed cache of fetched note sets so panning back, panning a little, or zooming in
  // reuses a recent fetch instead of re-hitting the network (the data depends only on the bbox,
  // not the zoom).
  const cache = new NotesCache();
  // Areas already fetched or promoted this session: for those the in-memory TTL governs freshness
  // and an expiry goes to the network, never back to the week-lived persisted copy, so a stale set
  // cannot pin itself for its whole persisted life.
  const promotedKeys = new Set<string>();
  let fetching = false;
  let cooldownUntil = 0;

  // Resolve an area's notes from the persisted store (only the first time this session sees the
  // area, which is the reload case), else from the network, persisting a successful fetch for the
  // next reload. The in-memory cache write stays with the caller, the weather loader's promote
  // pattern.
  async function resolveNotes(key: string, fetchBbox: Bbox4): Promise<NotePoint[] | undefined> {
    if (!promotedKeys.has(key)) {
      const now = Date.now();
      const stored = await persist.get(key);
      if (stored && stored.expires > now) {
        promotedKeys.add(key);
        void persist.prune(now);
        return stored.value;
      }
    }
    const notes = await fetchNotes(serverBase, getToken(), fetchBbox);
    if (notes) {
      promotedKeys.add(key);
      const now = Date.now();
      await persist.put(key, notes, now + PERSIST_TTL_MS);
      void persist.prune(now);
    }
    return notes;
  }

  return {
    cached: (viewport, offline) => cache.get(viewport, Date.now(), offline),
    inFlight: () => fetching,
    coolingDown: () => Date.now() < cooldownUntil,
    async load(fetchBbox) {
      fetching = true;
      try {
        const notes = await resolveNotes(bboxKey(fetchBbox), fetchBbox);
        if (!notes) {
          cooldownUntil = Date.now() + RETRY_COOLDOWN_MS;
          return undefined;
        }
        cache.put(fetchBbox, notes, Date.now());
        return notes;
      } finally {
        fetching = false;
      }
    },
  };
}
