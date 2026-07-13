import { isNotePoint } from '$entities/poi';
import type { Bbox4 } from '$shared/geo';
import { DAY_MS } from '$shared/lib';
import { createExpiringStore, type ExpiringStore } from '$shared/storage';
import { bboxKey, NotesCache } from './notes-cache';
import { fetchNotes, MAX_NOTES_PER_VIEW, type NotePoint } from './notes-client';

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
  load(
    fetchBbox: Bbox4,
    token: string | undefined,
    allowNetwork?: boolean,
  ): Promise<NotePoint[] | undefined>;
  // Drop session caches and invalidate pending results after the access token changes.
  invalidate(): void;
}

export function createNotesSource(
  serverBase: string,
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
  let generation = 0;
  let fetchingGeneration: number | undefined;
  let cooldownUntil = 0;
  let allowPersisted = true;

  function cachedPoints(value: unknown): NotePoint[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const points = value.slice(0, MAX_NOTES_PER_VIEW).filter(isNotePoint);
    if (value.length > 0 && points.length === 0) return undefined;
    return points;
  }

  // Resolve an area's notes from the persisted store (only the first time this session sees the
  // area, which is the reload case), else from the network, persisting a successful fetch for the
  // next reload. The in-memory cache write stays with the caller, the weather loader's promote
  // pattern.
  async function resolveNotes(
    key: string,
    fetchBbox: Bbox4,
    token: string | undefined,
    allowNetwork: boolean,
  ): Promise<{ notes: NotePoint[] | undefined; network: boolean }> {
    if (allowPersisted && !promotedKeys.has(key)) {
      try {
        const now = Date.now();
        const stored = await persist.get(key);
        const points = stored && stored.expires > now ? cachedPoints(stored.value) : undefined;
        if (points) {
          promotedKeys.add(key);
          void persist.prune(now).catch(() => undefined);
          return { notes: points, network: false };
        }
      } catch (error) {
        // Persistence is optional. An injected or browser store that rejects unexpectedly must not
        // prevent the live provider request.
        console.warn('[notes] persisted cache read failed', error);
      }
    }
    return {
      notes: allowNetwork ? await fetchNotes(serverBase, token, fetchBbox) : undefined,
      network: allowNetwork,
    };
  }

  return {
    cached: (viewport, offline) => cache.get(viewport, Date.now(), offline),
    inFlight: () => fetchingGeneration === generation,
    coolingDown: () => Date.now() < cooldownUntil,
    async load(fetchBbox, token, allowNetwork = true) {
      const loadGeneration = generation;
      fetchingGeneration = loadGeneration;
      try {
        const key = bboxKey(fetchBbox);
        const resolved = await resolveNotes(key, fetchBbox, token, allowNetwork);
        if (loadGeneration !== generation) return undefined;
        const { notes } = resolved;
        if (!notes) {
          if (!allowNetwork) {
            const empty: NotePoint[] = [];
            cache.put(fetchBbox, empty, Date.now());
            return empty;
          }
          cooldownUntil = Date.now() + RETRY_COOLDOWN_MS;
          return undefined;
        }
        if (resolved.network) {
          promotedKeys.add(key);
          const now = Date.now();
          // The network result is ready for the chart now. IndexedDB durability is best-effort and
          // must not hold the panel in Loading on a slow or blocked browser store.
          void persist
            .put(key, notes, now + PERSIST_TTL_MS)
            .then(() => persist.prune(now))
            .catch(() => undefined);
        }
        cache.put(fetchBbox, notes, Date.now());
        return notes;
      } catch (error) {
        // Persistence and parsing are designed to degrade, but a browser integration can still
        // reject unexpectedly. Never leave the overlay's single-flight flag looking permanently
        // active; report a transient load failure and retain the last rendered set.
        console.warn('[notes] viewport load failed', error);
        cooldownUntil = Date.now() + RETRY_COOLDOWN_MS;
        return undefined;
      } finally {
        if (fetchingGeneration === loadGeneration) fetchingGeneration = undefined;
      }
    },
    invalidate() {
      generation += 1;
      fetchingGeneration = undefined;
      cooldownUntil = 0;
      allowPersisted = false;
      promotedKeys.clear();
      cache.clear();
    },
  };
}
