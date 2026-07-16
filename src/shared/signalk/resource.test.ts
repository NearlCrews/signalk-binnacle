import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adminSessionInit,
  asKeyedObject,
  authInit,
  SignalKResourceClient,
  sendJson,
  setWriteOutcomeListener,
  str,
  strArray,
} from './resource';

describe('asKeyedObject', () => {
  it('rejects error envelopes and unsafe collection keys', () => {
    expect(asKeyedObject({ state: 'FAILURE', statusCode: 500, message: 'nope' })).toBeUndefined();
    expect(Object.keys(asKeyedObject(JSON.parse('{"__proto__":{}}')) ?? {})).toEqual([]);
    expect(asKeyedObject({ route: { name: 'Safe' } })).toEqual({ route: { name: 'Safe' } });
  });

  it('rejects an oversized collection instead of returning a partial snapshot', () => {
    const body = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`route-${index}`, { name: `${index}` }]),
    );
    expect(asKeyedObject(body)).toBeUndefined();
  });
});

describe('authInit', () => {
  it('returns undefined with no token and no extra', () => {
    expect(authInit(undefined)).toBeUndefined();
  });

  it('sets the bearer header when a token is present', () => {
    expect(authInit('tok')).toEqual({ headers: { Authorization: 'Bearer tok' } });
  });

  it('merges extra init and headers alongside the token header', () => {
    expect(
      authInit('tok', { method: 'PUT', headers: { 'Content-Type': 'application/json' } }),
    ).toEqual({
      method: 'PUT',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    });
  });

  it('returns extra with no auth header when there is no token', () => {
    expect(authInit(undefined, { credentials: 'omit' })).toEqual({
      credentials: 'omit',
      headers: {},
    });
  });
});

describe('SignalKResourceClient', () => {
  it('reads the current token for every request and keeps write outcomes instance-local', async () => {
    let token: string | undefined = 'first';
    const outcomes: number[] = [];
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    const client = new SignalKResourceClient({
      fetch: fetchFn as unknown as typeof fetch,
      getToken: () => token,
      onWriteOutcome: (_ok, status) => outcomes.push(status),
    });

    await client.fetchJson('http://x/one');
    token = 'second';
    expect(await client.put('http://x/two', { value: true })).toBe(true);

    expect(fetchFn.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer first' });
    expect(fetchFn.mock.calls[1]?.[1]?.headers).toEqual({
      Authorization: 'Bearer second',
      'Content-Type': 'application/json',
    });
    expect(outcomes).toEqual([200]);
  });

  it('degrades network and parse failures without notifying a write refusal', async () => {
    const outcomes: number[] = [];
    const client = new SignalKResourceClient({
      fetch: vi.fn(async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
      onWriteOutcome: (_ok, status) => outcomes.push(status),
    });

    await expect(client.fetchJson('http://x/read')).resolves.toBeUndefined();
    await expect(client.delete('http://x/write')).resolves.toBe(false);
    expect(outcomes).toEqual([]);
  });
});

describe('adminSessionInit', () => {
  it('uses the shared administrator session without a bearer header or cached refusal', () => {
    expect(adminSessionInit()).toEqual({ credentials: 'include', cache: 'no-store' });
    expect(
      adminSessionInit({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    ).toEqual({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

describe('str', () => {
  it('keeps a non-empty string and rejects everything else', () => {
    expect(str('a')).toBe('a');
    expect(str('')).toBeUndefined();
    expect(str(5)).toBeUndefined();
    expect(str(undefined)).toBeUndefined();
  });
});

describe('strArray', () => {
  it('keeps the non-empty strings or returns undefined', () => {
    expect(strArray(['a', '', 'b', 1])).toEqual(['a', 'b']);
    expect(strArray([])).toBeUndefined();
    expect(strArray('x')).toBeUndefined();
    expect(strArray(Array.from({ length: 1_001 }, () => 'x'))).toBeUndefined();
  });
});

describe('sendJson write-outcome listener', () => {
  afterEach(() => {
    setWriteOutcomeListener(undefined);
    vi.restoreAllMocks();
  });

  it('reports the ok flag and status of every write to the listener', async () => {
    const seen: Array<{ ok: boolean; status: number }> = [];
    setWriteOutcomeListener((ok, status) => seen.push({ ok, status }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    await sendJson('http://x/r', 'tok', 'PUT', { a: 1 });
    expect(seen).toEqual([{ ok: false, status: 403 }]);
  });

  it('does not fire the listener on a network failure', async () => {
    const seen: number[] = [];
    setWriteOutcomeListener((_ok, status) => seen.push(status));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await sendJson('http://x/r', undefined, 'DELETE')).toBeUndefined();
    expect(seen).toEqual([]);
  });
});
