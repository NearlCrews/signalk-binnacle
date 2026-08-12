import { evictOldestKey } from '$shared/lib';

// A bounded, insertion-ordered in-memory cache with an optional TTL. Eviction is oldest-first by
// Map insertion order, so callers that rely on FIFO eviction (the tides per-station caches) and on
// dropping the least-recently-inserted view (the weather grid cache) both get the order they expect.
// With the default infinite TTL nothing ever expires, which is the tides model. A finite TTL makes
// `get` drop an expired entry on read and `put` sweep expired entries before inserting, which is the
// weather model.
export class MemoryCache<V> {
  #entries = new Map<string, { value: V; expires: number }>();
  #maxEntries: number;
  #ttlMs: number;

  constructor(maxEntries: number, ttlMs = Number.POSITIVE_INFINITY) {
    this.#maxEntries = maxEntries;
    this.#ttlMs = ttlMs;
  }

  get(key: string, now: number): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  put(key: string, value: V, now: number): void {
    this.#insert(key, value, now + this.#ttlMs, now);
  }

  // Insert with an explicit absolute expiry, for a caller promoting an entry from a longer-lived store
  // (the weather L2 cache) that already knows when the entry should expire, rather than restarting the
  // TTL from now. The sweep still uses the real now, so it never wrongly keeps an already-expired entry.
  putAt(key: string, value: V, expiresAt: number, now: number): void {
    this.#insert(key, value, expiresAt, now);
  }

  #insert(key: string, value: V, expires: number, now: number): void {
    // With an infinite TTL nothing ever expires, so skip the sweep entirely rather than scan every
    // entry on each put (the tides model, where expires is always Infinity).
    if (this.#ttlMs !== Number.POSITIVE_INFINITY) {
      for (const [k, entry] of this.#entries) if (entry.expires <= now) this.#entries.delete(k);
    }
    // Delete before set so a refreshed key moves to the newest insertion position; otherwise it
    // keeps its original slot and the oldest-first eviction drops a just-refreshed entry early.
    this.#entries.delete(key);
    this.#entries.set(key, { value, expires });
    while (this.#entries.size > this.#maxEntries) {
      if (evictOldestKey(this.#entries) === undefined) break;
    }
  }
}
