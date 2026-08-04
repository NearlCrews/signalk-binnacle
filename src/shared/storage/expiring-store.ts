import { degradeToMemory, openIdbDatabase, reqPromise, txDone } from './idb';

// A persistent, time-to-live key-value store backed by IndexedDB, for caching fetched data across
// reloads and over plain HTTP. CacheStorage and service workers are secure-context only (so they are
// inert when the server is served over plain http on a LAN), but IndexedDB is not, so this is the
// http-friendly persistence layer. Values are stored by structured clone, so any cloneable value
// works. Each value's expiry is kept in a separate small object store, so pruning reads only the
// expiries and never has to load the (potentially large) values. It degrades to an in-memory map,
// and never throws, when IndexedDB is missing (Node, SSR, private mode) or fails (blocked upgrade,
// quota, corruption), so a persistence failure never breaks the caller.

interface ExpiringEntry<T> {
  value: T;
  expires: number;
}

export interface ExpiringStore<T> {
  get(key: string): Promise<ExpiringEntry<T> | undefined>;
  put(key: string, value: T, expires: number): Promise<void>;
  // Delete every expired entry, and the oldest live entries beyond maxEntries.
  prune(now: number): Promise<void>;
}

interface Options {
  maxEntries?: number;
  // Pass `factory: undefined` explicitly to force the in-memory fallback (used by tests).
  factory?: IDBFactory;
}

const VALUES = 'values';
const META = 'meta';
const DEFAULT_MAX = 48;

function memoryStore<T>(maxEntries: number): ExpiringStore<T> {
  const map = new Map<string, ExpiringEntry<T>>();
  return {
    get: async (key) => map.get(key),
    put: async (key, value, expires) => {
      map.set(key, { value, expires });
    },
    prune: async (now) => {
      for (const [k, e] of map) if (e.expires <= now) map.delete(k);
      if (map.size > maxEntries) {
        const oldestFirst = [...map.entries()].sort((a, b) => a[1].expires - b[1].expires);
        for (const [k] of oldestFirst.slice(0, map.size - maxEntries)) map.delete(k);
      }
    },
  };
}

export function createExpiringStore<T>(dbName: string, options: Options = {}): ExpiringStore<T> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX;
  const factory = 'factory' in options ? options.factory : globalThis.indexedDB;
  if (!factory) return memoryStore<T>(maxEntries);

  // Mirror every write to memory so a mid-session degrade keeps what was cached so far. Reads still
  // try IndexedDB first; the mirror only answers once degradeToMemory has tripped to the fallback.
  const memory = memoryStore<T>(maxEntries);
  // Observable rather than silent: the degrade is the right behavior, but a field report of
  // "caching stopped surviving reloads" needs this one breadcrumb to be diagnosable.
  const idb = degradeToMemory((error) => {
    console.warn(`Persistence for "${dbName}" degraded to memory for this session.`, error);
  });
  const db = openIdbDatabase(factory, dbName, 1, (conn) => {
    conn.createObjectStore(VALUES);
    conn.createObjectStore(META);
  });

  return {
    get: (key) =>
      idb.read<ExpiringEntry<T> | undefined>(
        async () => {
          const conn = await db();
          // Issue both reads synchronously on the one transaction; awaiting between requests would
          // let the transaction auto-commit and the second request would throw.
          const tx = conn.transaction([VALUES, META], 'readonly');
          const metaReq = tx.objectStore(META).get(key);
          const valueReq = tx.objectStore(VALUES).get(key);
          const [expires, value] = await Promise.all([
            reqPromise<number | undefined>(metaReq),
            reqPromise<T | undefined>(valueReq),
          ]);
          if (expires === undefined || value === undefined) return undefined;
          return { value, expires };
        },
        () => memory.get(key),
      ),
    put: (key, value, expires) =>
      idb.write(
        async () => {
          const conn = await db();
          const tx = conn.transaction([VALUES, META], 'readwrite');
          tx.objectStore(VALUES).put(value, key);
          tx.objectStore(META).put(expires, key);
          await txDone(tx);
        },
        () => memory.put(key, value, expires),
      ),
    prune: (now) =>
      idb.write(
        async () => {
          const conn = await db();
          // One readwrite transaction for the whole pass. Reading in a readonly transaction and
          // deleting in a second one leaves a window where a concurrent put (point-conditions puts
          // then prunes without awaiting) lands between classifying an entry and evicting it, so
          // the fresh entry is the one dropped. Every request below is issued either synchronously
          // or from a cursor event on this transaction, which is what keeps it alive: an await
          // between requests would let it auto-commit.
          const tx = conn.transaction([VALUES, META], 'readwrite');
          const meta = tx.objectStore(META);
          const values = tx.objectStore(VALUES);
          const live: { key: IDBValidKey; expires: number }[] = [];
          const cursorReq = meta.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const expires = cursor.value as number;
              if (expires <= now) {
                values.delete(cursor.primaryKey);
                cursor.delete();
              } else live.push({ key: cursor.primaryKey, expires });
              cursor.continue();
              return;
            }
            // The store has been walked: evict the oldest live entries beyond the cap. These
            // deletes are issued from a cursor event, so they still belong to this transaction.
            if (live.length <= maxEntries) return;
            live.sort((a, b) => a.expires - b.expires);
            for (const entry of live.slice(0, live.length - maxEntries)) {
              values.delete(entry.key);
              meta.delete(entry.key);
            }
          };
          await txDone(tx);
        },
        () => memory.prune(now),
      ),
  };
}
