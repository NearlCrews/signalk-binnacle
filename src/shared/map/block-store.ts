import { DAY_MS } from '$shared/lib';
import { degradeToMemory, openIdbDatabase, reqPromise, runTransaction } from '$shared/storage';

// A protocol-layer block cache for PMTiles archives. The HTTP layer cannot give these
// archives durable caching: range reads answer 206 Partial Content, which the Cache API
// refuses to store, so a service worker can never cache them, and the browser disk cache
// is bypassed on purpose (see NoStoreSource in pmtiles.ts). Caching aligned blocks in
// IndexedDB works in every context, including the plain-http boat LAN where service
// workers are inert, and serves chart tiles offline once their blocks have been fetched.

const DB_NAME = 'binnacle-pmtiles-blocks';
const BLOCKS = 'blocks';
const META = 'meta';
const ARCHIVES = 'archives';

const MAX_BYTES = 256 * 1024 * 1024;
const TTL_MS = 30 * DAY_MS;
// The in-memory fallback (private mode, degraded IndexedDB) keeps a much smaller budget:
// enough for a session's working set without growing the heap toward the archive size.
const MEMORY_MAX_BYTES = 16 * 1024 * 1024;

interface BlockMeta {
  size: number;
  lastAccess: number;
}

export interface BlockStore {
  getBlocks(archiveUrl: string, indexes: number[]): Promise<Map<number, ArrayBuffer>>;
  putBlocks(archiveUrl: string, blocks: Map<number, ArrayBuffer>, now: number): Promise<void>;
  touch(archiveUrl: string, indexes: number[], now: number): Promise<void>;
  getValidator(archiveUrl: string): Promise<string | undefined>;
  setValidator(archiveUrl: string, validator: string): Promise<void>;
  purgeArchive(archiveUrl: string): Promise<void>;
  // Delete blocks not touched within the TTL, then the oldest-touched blocks beyond the
  // byte budget. Reads only the meta rows, never the block bytes.
  prune(now: number): Promise<void>;
}

export interface BlockStoreOptions {
  maxBytes?: number;
  ttlMs?: number;
  memoryMaxBytes?: number;
  // Pass `factory: undefined` explicitly to force the in-memory fallback (used by tests).
  factory?: IDBFactory;
}

// The key joins on a newline, which cannot appear in a URL, so an archive's block keys
// form a clean prefix set.
function blockKey(archiveUrl: string, index: number): string {
  return `${archiveUrl}\n${index}`;
}

function memoryBlockStore(maxBytes: number, ttlMs: number): BlockStore {
  const blocks = new Map<string, { data: ArrayBuffer; size: number; lastAccess: number }>();
  const validators = new Map<string, string>();
  let total = 0;

  const drop = (key: string): void => {
    const entry = blocks.get(key);
    if (!entry) return;
    blocks.delete(key);
    total -= entry.size;
  };
  const evict = (): void => {
    if (total <= maxBytes) return;
    const oldestFirst = [...blocks.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    for (const [key] of oldestFirst) {
      if (total <= maxBytes) break;
      drop(key);
    }
  };

  return {
    getBlocks: async (url, indexes) => {
      const out = new Map<number, ArrayBuffer>();
      for (const index of indexes) {
        const entry = blocks.get(blockKey(url, index));
        if (entry) out.set(index, entry.data);
      }
      return out;
    },
    putBlocks: async (url, entries, now) => {
      for (const [index, data] of entries) {
        const key = blockKey(url, index);
        drop(key);
        blocks.set(key, { data, size: data.byteLength, lastAccess: now });
        total += data.byteLength;
      }
      evict();
    },
    touch: async (url, indexes, now) => {
      for (const index of indexes) {
        const entry = blocks.get(blockKey(url, index));
        if (entry) entry.lastAccess = now;
      }
    },
    getValidator: async (url) => validators.get(url),
    setValidator: async (url, validator) => {
      validators.set(url, validator);
    },
    purgeArchive: async (url) => {
      const prefix = `${url}\n`;
      for (const key of blocks.keys()) {
        if (key.startsWith(prefix)) drop(key);
      }
      validators.delete(url);
    },
    prune: async (now) => {
      for (const [key, entry] of blocks) {
        if (now - entry.lastAccess >= ttlMs) drop(key);
      }
      evict();
    },
  };
}

export function createBlockStore(options: BlockStoreOptions = {}): BlockStore {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const ttlMs = options.ttlMs ?? TTL_MS;
  const memoryMaxBytes = options.memoryMaxBytes ?? MEMORY_MAX_BYTES;
  const factory = 'factory' in options ? options.factory : globalThis.indexedDB;
  // Mirror every write to bounded memory so a mid-session degrade keeps the working set.
  const memory = memoryBlockStore(memoryMaxBytes, ttlMs);
  if (!factory) return memory;

  // Offline at sea, a silent fall to the small memory mirror is the difference between charts
  // and blank tiles; one warning makes the degrade diagnosable without spamming per block.
  const idb = degradeToMemory((error) => {
    console.warn(
      '[charts] block cache fell back to memory; cached chart areas are limited to this session',
      error,
    );
  });
  const db = openIdbDatabase(factory, DB_NAME, 1, (conn) => {
    conn.createObjectStore(BLOCKS);
    conn.createObjectStore(META);
    conn.createObjectStore(ARCHIVES);
  });

  return {
    getBlocks: (url, indexes) =>
      idb.read(
        async () => {
          const conn = await db();
          const store = conn.transaction(BLOCKS, 'readonly').objectStore(BLOCKS);
          const found = await Promise.all(
            indexes.map((index) =>
              reqPromise<ArrayBuffer | undefined>(store.get(blockKey(url, index))),
            ),
          );
          const out = new Map<number, ArrayBuffer>();
          indexes.forEach((index, at) => {
            const data = found[at];
            if (data) out.set(index, data);
          });
          return out;
        },
        () => memory.getBlocks(url, indexes),
      ),
    putBlocks: (url, entries, now) =>
      idb.write(
        async () => {
          const conn = await db();
          await runTransaction(conn, [BLOCKS, META], 'readwrite', (tx) => {
            for (const [index, data] of entries) {
              const meta: BlockMeta = { size: data.byteLength, lastAccess: now };
              tx.objectStore(BLOCKS).put(data, blockKey(url, index));
              tx.objectStore(META).put(meta, blockKey(url, index));
            }
          });
        },
        () => memory.putBlocks(url, entries, now),
      ),
    touch: (url, indexes, now) =>
      idb.write(
        async () => {
          const conn = await db();
          await runTransaction(conn, META, 'readwrite', (tx) => {
            const store = tx.objectStore(META);
            for (const index of indexes) {
              const key = blockKey(url, index);
              const req = store.get(key);
              // A follow-up put issued inside onsuccess stays inside this transaction.
              req.onsuccess = () => {
                const meta = req.result as BlockMeta | undefined;
                if (meta) store.put({ size: meta.size, lastAccess: now }, key);
              };
            }
          });
        },
        () => memory.touch(url, indexes, now),
      ),
    getValidator: (url) =>
      idb.read(
        async () => {
          const conn = await db();
          const store = conn.transaction(ARCHIVES, 'readonly').objectStore(ARCHIVES);
          return reqPromise<string | undefined>(store.get(url));
        },
        () => memory.getValidator(url),
      ),
    setValidator: (url, validator) =>
      idb.write(
        async () => {
          const conn = await db();
          await runTransaction(conn, ARCHIVES, 'readwrite', (tx) => {
            tx.objectStore(ARCHIVES).put(validator, url);
          });
        },
        () => memory.setValidator(url, validator),
      ),
    purgeArchive: (url) =>
      idb.write(
        async () => {
          const conn = await db();
          // Read the keys and delete inside ONE readwrite transaction: reading on a separate
          // readonly transaction first leaves a window where a concurrent putBlocks for this archive
          // writes blocks the captured key list misses, orphaning them. The deletes are issued from
          // the getAllKeys success so they queue while the transaction is still active (awaiting the
          // request, then issuing more on the same transaction, would let it auto-commit first).
          const prefix = `${url}\n`;
          await runTransaction(conn, [BLOCKS, META, ARCHIVES], 'readwrite', (tx) => {
            const metaStore = tx.objectStore(META);
            const blocksStore = tx.objectStore(BLOCKS);
            const keysReq = metaStore.getAllKeys();
            keysReq.onsuccess = () => {
              for (const key of (keysReq.result as string[]).filter((k) => k.startsWith(prefix))) {
                blocksStore.delete(key);
                metaStore.delete(key);
              }
              tx.objectStore(ARCHIVES).delete(url);
            };
          });
        },
        () => memory.purgeArchive(url),
      ),
    prune: (now) =>
      idb.write(
        async () => {
          const conn = await db();
          // One readwrite transaction for the whole pass, like purgeArchive above: classifying in a
          // readonly transaction and deleting in a second one leaves a window where a concurrent
          // putBlocks or touch lands between classifying a block and evicting it, so the fresh
          // block is the one dropped. getAll plus getAllKeys keep the pass to two requests, where
          // a per-row cursor would hold this exclusive lock across thousands of row events and
          // queue every concurrent getBlocks read behind it; both read only meta rows, never the
          // block bytes. The deletes are issued from the second request's success event, so they
          // join the same still-active transaction (an await between requests would let it
          // auto-commit).
          await runTransaction(conn, [BLOCKS, META], 'readwrite', (tx) => {
            const metaStore = tx.objectStore(META);
            const blocksStore = tx.objectStore(BLOCKS);
            const drop = (key: IDBValidKey) => {
              blocksStore.delete(key);
              metaStore.delete(key);
            };
            // Same store, issued in order, so rowsReq has settled by the time keysReq fires; both
            // return primary-key order, so the indexes correspond.
            const rowsReq = metaStore.getAll();
            const keysReq = metaStore.getAllKeys();
            keysReq.onsuccess = () => {
              const rows = rowsReq.result as BlockMeta[];
              const live: { key: IDBValidKey; size: number; lastAccess: number }[] = [];
              keysReq.result.forEach((key, index) => {
                const meta = rows[index];
                // A corrupt row (non-finite size or lastAccess) is evicted, never counted: NaN
                // in the byte total would poison the budget comparison below and the eviction
                // loop would silently drain every live block in one pass.
                if (
                  meta === undefined ||
                  !Number.isFinite(meta.size) ||
                  !Number.isFinite(meta.lastAccess) ||
                  now - meta.lastAccess >= ttlMs
                ) {
                  drop(key);
                  return;
                }
                live.push({ key, size: meta.size, lastAccess: meta.lastAccess });
              });
              // Evict the oldest-touched live blocks beyond the byte budget.
              let total = live.reduce((sum, item) => sum + item.size, 0);
              if (total <= maxBytes) return;
              live.sort((a, b) => a.lastAccess - b.lastAccess);
              for (const item of live) {
                if (total <= maxBytes) break;
                drop(item.key);
                total -= item.size;
              }
            };
          });
        },
        () => memory.prune(now),
      ),
  };
}
