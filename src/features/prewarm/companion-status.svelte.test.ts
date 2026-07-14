import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPANION_POLL_MS, CompanionStatus } from './companion-status.svelte.js';

function makeDoc(): {
  hidden: boolean;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  fire: () => void;
  listenerCount: () => number;
} {
  const listeners = new Set<() => void>();
  return {
    hidden: false,
    addEventListener(type, cb) {
      if (type === 'visibilitychange') listeners.add(cb);
    },
    removeEventListener(_type, cb) {
      listeners.delete(cb);
    },
    fire() {
      for (const cb of listeners) cb();
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

const BASE = 'http://h/plugins/signalk-chart-locker';
const STATS = `${BASE}/api/cache/stats`;
const LOGIN = 'http://h/skServer/loginStatus';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const statsResponse = (bytes: number): Response =>
  jsonResponse({ rows: 1, bytes, cap: 1000, perSourceAvgBytes: {} });

let doc: ReturnType<typeof makeDoc>;

beforeEach(() => {
  vi.useFakeTimers();
  doc = makeDoc();
  vi.stubGlobal('document', doc);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function statusWith(fetchImpl: typeof fetch, getBase: () => string | null = () => BASE) {
  return new CompanionStatus(getBase, fetchImpl);
}

describe('CompanionStatus', () => {
  it('derives presence from the base and starts in a truthful checking state', () => {
    let base: string | null = null;
    const status = statusWith(vi.fn(), () => base);
    expect(status.present).toBe(false);
    expect(status.state).toBe('checking');
    base = BASE;
    expect(status.present).toBe(true);
  });

  it('polls immediately when feature detection resolves after start', async () => {
    let base: string | null = null;
    const fetchImpl = vi.fn(async () => statsResponse(16));
    const status = statusWith(fetchImpl as unknown as typeof fetch, () => base);
    status.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    base = BASE;
    await status.refresh();
    expect(fetchImpl).toHaveBeenCalledWith(
      STATS,
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(status.state).toBe('serving');
    expect(status.cacheBytes).toBe(16);
    status.stop();
  });

  it('classifies a rejected request against the current Signal K session', async () => {
    for (const [loginBody, expected] of [
      [{ status: 'notLoggedIn' }, 'needs-login'],
      [{ status: 'loggedIn', userLevel: 'readwrite' }, 'needs-admin'],
      [{ status: 'loggedIn', userLevel: 'admin' }, 'access-error'],
    ] as const) {
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === STATS) return jsonResponse({ error: 'denied' }, 403);
        if (url === LOGIN) return jsonResponse(loginBody);
        throw new Error(`unexpected URL ${url}`);
      });
      const status = statusWith(fetchImpl as unknown as typeof fetch);
      await status.refresh();
      expect(status.state).toBe(expected);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it('reports an access error when the login status cannot be verified', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === STATS) return jsonResponse({}, 401);
      throw new TypeError('offline');
    });
    const status = statusWith(fetchImpl as unknown as typeof fetch);
    await status.refresh();
    expect(status.state).toBe('access-error');
  });

  it('reports malformed reachable statistics as a server error, not unavailable', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ rows: 1, bytes: 10, cap: 1000, perSourceAvgBytes: { seamark: 0 } }),
    );
    const status = statusWith(fetchImpl as unknown as typeof fetch);

    await status.refresh();

    expect(status.state).toBe('error');
    expect(status.down).toBe(true);
  });

  it('keeps retrying cookie authentication without keying backoff to a device token', async () => {
    let signedIn = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === LOGIN) return jsonResponse({ status: 'notLoggedIn' });
      return signedIn ? statsResponse(12) : jsonResponse({}, 401);
    });
    const status = statusWith(fetchImpl as unknown as typeof fetch);
    status.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(status.state).toBe('needs-login');

    signedIn = true;
    await vi.advanceTimersByTimeAsync(COMPANION_POLL_MS);
    expect(status.state).toBe('serving');
    expect(status.cacheBytes).toBe(12);
    status.stop();
  });

  it('retries immediately when the PWA resumes after sign-in', async () => {
    let signedIn = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === LOGIN) return jsonResponse({ status: 'notLoggedIn' });
      return signedIn ? statsResponse(24) : jsonResponse({}, 401);
    });
    const status = statusWith(fetchImpl as unknown as typeof fetch);
    status.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(status.state).toBe('needs-login');

    signedIn = true;
    doc.fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(status.state).toBe('serving');
    expect(status.cacheBytes).toBe(24);
    status.stop();
  });

  it('debounces server and transport failures, then keeps polling to recover', async () => {
    let mode: 'server' | 'offline' | 'ok' = 'server';
    const fetchImpl = vi.fn(async () => {
      if (mode === 'server') return jsonResponse({}, 500);
      if (mode === 'offline') throw new TypeError('offline');
      return statsResponse(10);
    });
    const status = statusWith(fetchImpl as unknown as typeof fetch);
    status.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(status.state).toBe('checking');
    await vi.advanceTimersByTimeAsync(COMPANION_POLL_MS);
    expect(status.state).toBe('error');

    mode = 'ok';
    await vi.advanceTimersByTimeAsync(COMPANION_POLL_MS);
    expect(status.state).toBe('serving');

    mode = 'offline';
    await vi.advanceTimersByTimeAsync(COMPANION_POLL_MS * 2);
    expect(status.state).toBe('offline');
    expect(status.down).toBe(true);
    status.stop();
  });

  it('pauses while hidden and removes its listener and timer on stop', async () => {
    const fetchImpl = vi.fn(async () => statsResponse(2));
    const status = statusWith(fetchImpl as unknown as typeof fetch);
    status.start();
    await vi.advanceTimersByTimeAsync(0);
    const afterMount = fetchImpl.mock.calls.length;

    doc.hidden = true;
    await vi.advanceTimersByTimeAsync(COMPANION_POLL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(afterMount);

    status.stop();
    expect(doc.listenerCount()).toBe(0);
    doc.hidden = false;
    await vi.advanceTimersByTimeAsync(COMPANION_POLL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(afterMount);
  });

  it('starts idempotently', async () => {
    const fetchImpl = vi.fn(async () => statsResponse(5));
    const status = statusWith(fetchImpl as unknown as typeof fetch);
    status.start();
    status.start();
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(COMPANION_POLL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(afterStart + 1);
    status.stop();
  });
});
