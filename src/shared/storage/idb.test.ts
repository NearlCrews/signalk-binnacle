import { describe, expect, it } from 'vitest';
import { openIdbDatabase, openIdbStore } from './idb';

interface FakeRequest {
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  result: IDBDatabase;
  error: DOMException | null;
}

// A factory whose first open is blocked (a second tab holds the prior version) and whose second open
// succeeds, so the test can prove the opener retries instead of reusing the rejected promise.
function blockedThenOpenFactory(): { factory: IDBFactory; attempts: () => number } {
  let attempts = 0;
  const factory = {
    open(): IDBOpenDBRequest {
      attempts += 1;
      const attempt = attempts;
      const req: FakeRequest = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        result: { attempt } as unknown as IDBDatabase,
        error: null,
      };
      // Resolve the outcome after the synchronous handler wiring in the opener has run.
      queueMicrotask(() => {
        if (attempt === 1) req.onblocked?.();
        else req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return { factory, attempts: () => attempts };
}

function storeHarness() {
  const request = {
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    result: 'stored',
    error: null as DOMException | null,
  };
  const transaction = {
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    error: null as DOMException | null,
    objectStore: () => ({}) as IDBObjectStore,
  };
  const database = {
    onversionchange: null as (() => void) | null,
    close: () => {},
    transaction: () => transaction as unknown as IDBTransaction,
  };
  const factory = {
    open: () => {
      const openRequest = {
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        result: database as unknown as IDBDatabase,
        error: null,
      };
      queueMicrotask(() => openRequest.onsuccess?.());
      return openRequest as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  const runner = openIdbStore(factory, 'binnacle-test', 'items', () => {});
  return { request, transaction, runner };
}

describe('openIdbDatabase', () => {
  it('retries the open after a rejection rather than reusing the failed promise', async () => {
    const { factory, attempts } = blockedThenOpenFactory();
    const open = openIdbDatabase(factory, 'binnacle-test', 1, () => {});

    await expect(open()).rejects.toThrow();
    // The memo cleared on rejection, so the next call opens afresh and resolves.
    const db = (await open()) as unknown as { attempt: number };
    expect(db.attempt).toBe(2);
    expect(attempts()).toBe(2);
  });

  it('memoizes a successful open and does not reopen', async () => {
    const { factory, attempts } = blockedThenOpenFactory();
    const open = openIdbDatabase(factory, 'binnacle-test', 1, () => {});
    await expect(open()).rejects.toThrow();
    await open();
    // A third call reuses the resolved connection without a new open.
    await open();
    expect(attempts()).toBe(2);
  });

  it('closes a connection that succeeds after its blocked promise was rejected', async () => {
    let request!: FakeRequest;
    let closes = 0;
    const database = {
      close: () => {
        closes += 1;
      },
    } as unknown as IDBDatabase;
    const factory = {
      open: () => {
        request = {
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          onblocked: null,
          result: database,
          error: null,
        };
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    const open = openIdbDatabase(factory, 'binnacle-test', 1, () => {});

    const pending = open();
    request.onblocked?.();
    await expect(pending).rejects.toThrow('indexedDB open blocked');
    request.onsuccess?.();

    expect(closes).toBe(1);
  });
});

describe('openIdbStore', () => {
  it('does not resolve a successful request until its transaction commits', async () => {
    const { request, transaction, runner } = storeHarness();
    let settled = false;
    const pending = runner.run<string>('readwrite', () => request as unknown as IDBRequest);
    pending.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    request.onsuccess?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    transaction.oncomplete?.();
    await expect(pending).resolves.toBe('stored');
  });

  it('rejects when the transaction aborts after the request succeeds', async () => {
    const { request, transaction, runner } = storeHarness();
    const pending = runner.run<string>('readwrite', () => request as unknown as IDBRequest);
    await Promise.resolve();
    await Promise.resolve();
    request.onsuccess?.();
    transaction.error = new DOMException('quota exceeded', 'QuotaExceededError');
    transaction.onabort?.();
    await expect(pending).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });
});
