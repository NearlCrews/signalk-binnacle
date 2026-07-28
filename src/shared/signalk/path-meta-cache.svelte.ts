import { fetchPathMeta, type PathMeta } from './meta';

// How many failed fetches one path may burn before the cache settles on an empty sentinel. A
// version-reactive consumer retries on every settle, so without a cap a dead endpoint would be
// hammered in a tight loop; with it, a transient failure gets real retries and a dead one goes
// quiet for the session.
const MAX_ATTEMPTS = 3;

// A per-session cache of path metadata with one in-flight sentinel per path, shared by every
// surface that reads meta reactively (the instruments zones, the shallow monitor's server
// threshold). A null entry means a fetch is in flight, or that the path gave up after
// MAX_ATTEMPTS failures; a resolved fetch caches its PathMeta; a failed fetch under the cap
// deletes the sentinel so the next reactive visit (the settle itself for a version-reactive
// consumer, a token arriving, a path changing) retries instead of pinning the whole session to a
// meta-less view on one transient error. Reads pair with `version`, a $state counter bumped after
// every settle, so a $derived over the plain Map re-evaluates when a fetch lands.
export function createPathMetaCache(origin: string, getToken: () => string | undefined) {
  const cache = new Map<string, PathMeta | null>();
  const attempts = new Map<string, number>();
  let version = $state(0);

  // Resolve a path's meta once. Safe to call from an effect: the sentinel makes repeat calls
  // no-ops while a fetch is in flight, after one resolved, and after the attempt cap is spent.
  function load(path: string): void {
    if (cache.has(path)) return;
    const tried = attempts.get(path) ?? 0;
    if (tried >= MAX_ATTEMPTS) {
      cache.set(path, null);
      version += 1;
      return;
    }
    attempts.set(path, tried + 1);
    cache.set(path, null);
    void fetchPathMeta(origin, getToken(), path).then((result) => {
      if (result !== undefined) {
        cache.set(path, result);
        attempts.delete(path);
      } else {
        cache.delete(path);
      }
      version += 1;
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
