// Test-only IndexedDB stand-ins for the persistent stores. Imported by *.test.ts files, never by
// production code.

interface FakeIdbTransaction {
  mode: IDBTransactionMode;
  stores: string[];
}

interface FakeIdb {
  factory: IDBFactory;
  // Every transaction opened, in order, so a test can hold a store to doing a pass in one
  // transaction rather than in a read pass and a separate write pass.
  transactions: FakeIdbTransaction[];
  // Per-store value reads (get, getAll, and a cursor's value), so a test can prove a pass never
  // loaded the stored values. Key reads are not counted.
  valueReads: Map<string, number>;
}

// A minimal in-memory IDBFactory: enough of the surface the stores use (single- and multi-store
// transactions, get, getAll, getAllKeys, put, delete, and a cursor) to exercise the real IndexedDB
// path rather than the memory fallback, which is a separate implementation. Requests settle on
// microtasks, and a transaction completes once every request it owns has settled and no event
// handler has queued another, which is what lets a cursor keep its transaction alive across
// continue() and a put issued from an onsuccess stay on the same transaction.
export function fakeIdbFactory(): FakeIdb {
  const data = new Map<string, Map<IDBValidKey, unknown>>();
  const transactions: FakeIdbTransaction[] = [];
  const valueReads = new Map<string, number>();
  const countRead = (name: string): void => {
    valueReads.set(name, (valueReads.get(name) ?? 0) + 1);
  };

  const makeTransaction = (names: string[], mode: IDBTransactionMode): IDBTransaction => {
    transactions.push({ mode, stores: names });
    let pending = 0;
    let settled = false;
    const tx = {
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      onabort: null as null | (() => void),
      error: null,
      objectStore: (name: string) => store(name),
    };
    const settle = (): void => {
      if (pending > 0 || settled) return;
      settled = true;
      tx.oncomplete?.();
    };
    const enqueue = (run: () => void): void => {
      pending += 1;
      queueMicrotask(() => {
        run();
        pending -= 1;
        settle();
      });
    };
    // The store's requests are issued synchronously right after transaction(), so this check sees
    // them and only commits a genuinely empty transaction.
    queueMicrotask(settle);

    const store = (name: string) => {
      const records = data.get(name);
      if (!records) throw new Error(`no store ${name}`);
      const sortedKeys = () => [...records.keys()].sort();
      const request = <R>(result: () => R) => {
        const req = {
          onsuccess: null as null | (() => void),
          onerror: null,
          result: undefined as R,
        };
        enqueue(() => {
          req.result = result();
          req.onsuccess?.();
        });
        return req as unknown as IDBRequest<R>;
      };
      return {
        get: (key: IDBValidKey) =>
          request(() => {
            countRead(name);
            return records.get(key);
          }),
        getAll: () =>
          request(() => {
            countRead(name);
            return sortedKeys().map((key) => records.get(key));
          }),
        getAllKeys: () => request(() => sortedKeys()),
        put: (value: unknown, key: IDBValidKey) => request(() => records.set(key, value)),
        delete: (key: IDBValidKey) => request(() => records.delete(key)),
        openCursor: () => {
          const keys = [...records.keys()];
          const req = {
            onsuccess: null as null | (() => void),
            onerror: null,
            result: null as unknown,
          };
          let index = 0;
          const step = (): void => {
            enqueue(() => {
              while (index < keys.length && !records.has(keys[index])) index += 1;
              const key = keys[index];
              req.result =
                index >= keys.length
                  ? null
                  : {
                      primaryKey: key,
                      key,
                      get value() {
                        countRead(name);
                        return records.get(key);
                      },
                      continue: () => {
                        index += 1;
                        step();
                      },
                      delete: () => request(() => records.delete(key)),
                    };
              req.onsuccess?.();
            });
          };
          step();
          return req as unknown as IDBRequest<IDBCursorWithValue | null>;
        },
      } as unknown as IDBObjectStore;
    };
    return tx as unknown as IDBTransaction;
  };

  const connection = {
    onversionchange: null,
    close: () => undefined,
    createObjectStore: (name: string) => {
      data.set(name, new Map());
    },
    transaction: (names: string | string[], mode: IDBTransactionMode) =>
      makeTransaction(Array.isArray(names) ? names : [names], mode),
  };
  const factory = {
    open: () => {
      const req = {
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null,
        onblocked: null,
        result: connection as unknown as IDBDatabase,
        error: null,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return { factory, transactions, valueReads };
}

// An IDBFactory whose open() always errors, to exercise the degrade-to-memory path.
export function failingIdbFactory(): IDBFactory {
  return {
    open() {
      const req = { onerror: null as null | (() => void), error: new Error('open failed') };
      queueMicrotask(() => req.onerror?.());
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}
