// The IndexedDB plumbing shared by the stores: a lazy database opener (rejecting rather than
// hanging when a second tab blocks the upgrade), a typed single-store transaction runner, and the
// degrade-to-memory policy each store layers on top.

interface IdbRunner {
  run<R>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<R>;
}

export function reqPromise<R>(req: IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Slice-internal (not on the public index): cross-slice callers manage transaction lifetime
// through runTransaction below.
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Run one multi-store transaction to completion: `run` must issue its requests synchronously (or
// from an onsuccess of a request already on the transaction), because an await inside it would let
// the transaction auto-commit. Owning the completion promise here keeps the transaction-lifetime
// rules in the storage slice instead of leaking the raw txDone primitive across slices.
function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export async function runTransaction<T>(
  conn: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  // Synchronous only: an IndexedDB transaction auto-commits as soon as its microtask queue drains,
  // so an async callback would have its later work run outside the transaction, and its rejection
  // would escape the catch below without aborting anything. Enforced at runtime rather than by a
  // conditional return type, so an `any`-typed caller is caught too and the cast a conditional type
  // would force here is not needed.
  run: (tx: IDBTransaction) => T,
): Promise<T> {
  const tx = conn.transaction(storeNames, mode);
  const completion = txDone(tx);
  let result: T;
  try {
    result = run(tx);
    if (isThenable(result)) {
      throw new TypeError('runTransaction callback must be synchronous');
    }
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Preserve the callback error if the transaction already completed before abort.
    }
    await completion.catch(() => undefined);
    throw error;
  }
  await completion;
  return result;
}

// A lazy, memoized IndexedDB opener: opens on first call and reuses the connection, rejecting (not
// hanging) when a second tab blocks the upgrade. Shared so the single-store and dual-store stores
// open the database the same way.
export function openIdbDatabase(
  factory: IDBFactory,
  dbName: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): () => Promise<IDBDatabase> {
  let dbPromise: Promise<IDBDatabase> | undefined;
  return () => {
    if (!dbPromise) {
      const pending = new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(dbName, version);
        let abandoned = false;
        req.onupgradeneeded = () => upgrade(req.result);
        req.onsuccess = () => {
          const conn = req.result;
          // `blocked` is not terminal for IDBOpenDBRequest. The browser can later deliver success
          // after this promise was rejected and its memo cleared. Close that abandoned connection
          // so it cannot become an untracked upgrade blocker.
          if (abandoned) {
            conn.close();
            return;
          }
          // This connection is memoized for the session, so a later tab opening a higher version
          // would block on it indefinitely; close on versionchange so that upgrade can proceed.
          conn.onversionchange = () => conn.close();
          resolve(conn);
        };
        req.onerror = () => reject(req.error);
        // A second tab holding the prior version blocks the upgrade; reject instead of hanging.
        req.onblocked = () => {
          abandoned = true;
          reject(new Error('indexedDB open blocked'));
        };
      });
      dbPromise = pending;
      // On failure (a transient error, or a second tab blocking the upgrade) clear the memo so the
      // next call retries the open, rather than pinning every store to memory for the whole session
      // by reusing a permanently-rejected promise. The catch only resets state; awaiters still see
      // the rejection through their own handle on `pending`.
      pending.catch(() => {
        if (dbPromise === pending) dbPromise = undefined;
      });
    }
    return dbPromise;
  };
}

export function openIdbStore(
  factory: IDBFactory,
  dbName: string,
  storeName: string,
  createStore: (db: IDBDatabase) => void,
): IdbRunner {
  const db = openIdbDatabase(factory, dbName, 1, createStore);
  return {
    run: async <R>(
      mode: IDBTransactionMode,
      op: (store: IDBObjectStore) => IDBRequest,
    ): Promise<R> => {
      const conn = await db();
      const tx = conn.transaction(storeName, mode);
      const completion = txDone(tx);
      let request: IDBRequest;
      try {
        request = op(tx.objectStore(storeName));
      } catch (error) {
        // The completion handlers were installed before invoking the caller so a fast transaction
        // cannot be missed. If the caller throws synchronously, abort and consume that completion
        // outcome while preserving the original programming error for the caller.
        try {
          tx.abort();
        } catch {
          // A transaction that already completed cannot be aborted, but its completion promise is
          // still handled below.
        }
        void completion.catch(() => undefined);
        throw error;
      }
      // A request can succeed before its transaction later aborts, for example on a quota or
      // constraint failure in another request. Persistence is successful only after commit.
      const [result] = await Promise.all([reqPromise(request as IDBRequest<R>), completion]);
      return result;
    },
  };
}

// The degrade-to-memory policy shared by the persistent stores: a write mirrors to memory first,
// then tries IndexedDB and degrades on failure; a read tries IndexedDB and falls back to memory.
// Once any op fails, every later op goes straight to memory, so a persistence failure never throws
// and never loses what was already mirrored. Defined once so the stores cannot drift.
interface DegradeToMemory {
  read<R>(fromIdb: () => Promise<R>, fromMemory: () => Promise<R>): Promise<R>;
  write(toIdb: () => Promise<unknown>, toMemory: () => Promise<void>): Promise<void>;
}

export function degradeToMemory(onDegrade?: (error: unknown) => void): DegradeToMemory {
  let degraded = false;
  const degrade = (error: unknown): void => {
    degraded = true;
    onDegrade?.(error);
  };
  return {
    read: async (fromIdb, fromMemory) => {
      if (degraded) return fromMemory();
      try {
        return await fromIdb();
      } catch (error) {
        degrade(error);
        return fromMemory();
      }
    },
    write: async (toIdb, toMemory) => {
      // Mirror to memory on every write, so a mid-session degrade keeps everything stored so far.
      await toMemory();
      if (degraded) return;
      try {
        await toIdb();
      } catch (error) {
        degrade(error);
      }
    },
  };
}
