import { evictOldestKey } from '$shared/lib';
import { fetchPathMeta, type PathMeta, staleWindowMsFromTimeout } from './meta';

// How many failed fetches one path may burn before the cache settles on an empty sentinel. A
// version-reactive consumer retries on every settle, so without a cap a dead endpoint would be
// hammered in a tight loop; with it, a transient failure gets real retries and a dead one goes
// quiet for the session.
const MAX_ATTEMPTS = 3;

// How long a failed fetch holds its sentinel before the retry window reopens. Version-reactive
// consumers re-enter on the settle itself, so an immediate reopen let one brief outage burn the
// whole attempt budget back to back; the pause spreads the budget across the outage instead.
// Exported for the tests that advance fake timers across the retry window.
export const RETRY_DELAY_MS = 5_000;

// How many distinct paths one session's cache retains. In practice a server's distinct path count
// is small and stable, so this never binds. It exists because the key space is not ours: pointed at
// per-vessel (AIS context) paths, or at a server emitting novel paths, an uncapped Map would grow
// for the life of the session. Eviction is oldest-first, which a Map gives for free through its
// insertion order. MemoryCache is not used here because its get/put carry a clock this cache has no
// use for, and because "cached as null" versus "never fetched" is load-bearing, which a
// value-or-undefined lookup cannot express.
const MAX_CACHED_PATHS = 500;

// A per-session cache of path metadata with one in-flight sentinel per path, shared by every
// surface that reads meta reactively (the instruments zones, the shallow monitor's server
// threshold). A null entry means a fetch is in flight, or that the path gave up after
// MAX_ATTEMPTS failures; a resolved fetch caches its PathMeta; a failed fetch under the cap
// deletes the sentinel after RETRY_DELAY_MS so the next reactive visit retries instead of pinning
// the whole session to a meta-less view on one transient error. A changed token restores every
// spent budget and give-up sentinel: attempts burned tokenless before auth resolved, or during an
// outage the old credentials could not outlive, say nothing about the new credentials. Reads pair
// with `version`, a $state counter bumped after every settle, so a $derived over the plain Map
// re-evaluates when a fetch lands.
// When handed a store, every successful settle also writes the path's declared staleness window
// (meta.timeout) onto its cell, so grading helpers anywhere honor it. The write lives here rather
// than in a consumer callback because the window is a server-declared fact about the path, not a
// feature-local one: whichever cache instance fetches the meta must publish it the same way.
export function createPathMetaCache(
  origin: string,
  getToken: () => string | undefined,
  store?: { cell(path: string): { staleWindowMs: number | undefined } },
) {
  const cache = new Map<string, PathMeta | null>();
  const attempts = new Map<string, number>();
  const inFlight = new Set<string>();
  let lastToken = getToken();
  let version = $state(0);

  function evictOldestIfFull(): void {
    if (cache.size < MAX_CACHED_PATHS) return;
    const evicted = evictOldestKey(cache);
    if (evicted !== undefined) attempts.delete(evicted);
  }

  // Resolve a path's meta once. Safe to call from an effect: the sentinel makes repeat calls
  // no-ops while a fetch is in flight, after one resolved, and after the attempt cap is spent.
  function load(path: string): void {
    const token = getToken();
    if (token !== lastToken) {
      lastToken = token;
      attempts.clear();
      // Reopen every give-up sentinel; an in-flight sentinel stays, or a stale fetch settling
      // later could clobber what a fresh one stored.
      for (const [key, value] of cache) {
        if (value === null && !inFlight.has(key)) cache.delete(key);
      }
    }
    if (cache.has(path)) return;
    evictOldestIfFull();
    const tried = attempts.get(path) ?? 0;
    if (tried >= MAX_ATTEMPTS) {
      cache.set(path, null);
      version += 1;
      return;
    }
    attempts.set(path, tried + 1);
    cache.set(path, null);
    inFlight.add(path);
    void fetchPathMeta(origin, token, path).then((result) => {
      inFlight.delete(path);
      if (result !== undefined) {
        cache.set(path, result);
        attempts.delete(path);
        if (store !== undefined) {
          const windowMs = staleWindowMsFromTimeout(result.timeout);
          const cell = store.cell(path);
          if (cell.staleWindowMs !== windowMs) cell.staleWindowMs = windowMs;
        }
        version += 1;
        return;
      }
      setTimeout(() => {
        // Only clear the sentinel this failure left: a token-change sweep may already have
        // removed it, and a newer load may have replaced it with an in-flight fetch of its own.
        if (inFlight.has(path) || cache.get(path) !== null) return;
        cache.delete(path);
        version += 1;
      }, RETRY_DELAY_MS);
    });
  }

  return {
    load,
    // The cached meta, null while a fetch is in flight or after the path gave up, undefined when
    // never fetched or awaiting a retry.
    get(path: string): PathMeta | null | undefined {
      return cache.get(path);
    },
    get version(): number {
      return version;
    },
  };
}
