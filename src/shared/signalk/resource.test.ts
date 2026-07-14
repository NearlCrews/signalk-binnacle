import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adminSessionInit,
  authInit,
  sendJson,
  setWriteOutcomeListener,
  str,
  strArray,
} from './resource';

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
