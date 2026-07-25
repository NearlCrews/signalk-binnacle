import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.svelte';

function storage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function res(ok: boolean, body: unknown = {}, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const BASE = 'http://sk.test';
const noSchedule = () => {};

describe('AuthController', () => {
  it('reports an unsecured server and needs no token', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => res(true, {}));
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    await auth.probe();
    expect(auth.status).toBe('unsecured');
    expect(auth.token).toBeNull();
  });

  it('probes anonymously with credentials omitted so a session cookie cannot mask a secured server', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => res(true, {}));
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    await auth.probe();
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/signalk/v1/api/vessels/self`,
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses a stored token that still works', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      res(Boolean(init?.headers), {}),
    );
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'c1', token: 'tok' }),
      }),
      schedule: noSchedule,
    });
    await auth.probe();
    expect(auth.status).toBe('authenticated');
    expect(auth.token).toBe('tok');
  });

  it('requests access when secured with no usable token', async () => {
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    await auth.probe();
    expect(auth.status).toBe('requesting');
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/signalk/v1/access/requests`,
      expect.objectContaining({ method: 'POST' }),
    );
    // The body must request readwrite, or the server defaults the grant to readonly and every
    // write (routes, course, alarms, radar controls) 401s.
    const postInit = fetchFn.mock.calls.find(([url]) => url.endsWith('/access/requests'))?.[1];
    const body = typeof postInit?.body === 'string' ? postInit.body : '{}';
    expect(JSON.parse(body)).toMatchObject({ permissions: 'readwrite' });
  });

  it('stores the token and authenticates when the request is approved', async () => {
    const saved: string[] = [];
    const store = storage();
    const origSet = store.setItem;
    store.setItem = (k, v) => {
      saved.push(v);
      origSet(k, v);
    };
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      if (url.endsWith('/requests/r1'))
        return res(true, {
          state: 'COMPLETED',
          accessRequest: { permission: 'APPROVED', token: 'newtok' },
        });
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    await auth.requestAccess();
    await auth.checkRequest();
    expect(auth.status).toBe('authenticated');
    expect(auth.token).toBe('newtok');
    expect(saved.some((v) => v.includes('newtok'))).toBe(true);
  });

  it('reports denied when the request is refused', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      if (url.endsWith('/requests/r1'))
        return res(true, { state: 'COMPLETED', accessRequest: { permission: 'DENIED' } });
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    await auth.requestAccess();
    await auth.checkRequest();
    expect(auth.status).toBe('denied');
  });

  it('uses a recognizable binnacle- client id', () => {
    const auth = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    expect(auth.clientId).toMatch(/^binnacle-/);
  });

  it('upgrades a legacy bare-uuid client id, keeping the token', () => {
    const store = storage({
      'binnacle:signalk-auth': JSON.stringify({ clientId: 'abcd-1234', token: 'keepme' }),
    });
    const auth = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    expect(auth.clientId).toMatch(/^binnacle-/);
    expect(JSON.parse(store.getItem('binnacle:signalk-auth') as string).token).toBe('keepme');
  });

  it('rechecks a pending request and authenticates on approval', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      if (url.endsWith('/requests/r1'))
        return res(true, {
          state: 'COMPLETED',
          accessRequest: { permission: 'APPROVED', token: 'tok2' },
        });
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    await auth.requestAccess();
    expect(auth.status).toBe('requesting');
    auth.recheck();
    await new Promise((r) => setTimeout(r, 0));
    expect(auth.status).toBe('authenticated');
    expect(auth.token).toBe('tok2');
  });

  it('does not recheck when not currently requesting', async () => {
    const fetchFn = vi.fn(async () => res(true, {}));
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    auth.recheck();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('adopts a token approved in another tab', async () => {
    const store = storage();
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    await auth.requestAccess();
    expect(auth.status).toBe('requesting');
    auth.adoptToken('crosstab');
    expect(auth.status).toBe('authenticated');
    expect(auth.token).toBe('crosstab');
    expect(store.getItem('binnacle:signalk-auth')).toContain('crosstab');
  });

  it('adopts a complete rotated identity from another tab without writing it back', async () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    try {
      const setItem = vi.fn();
      const store = {
        getItem: () => JSON.stringify({ clientId: 'binnacle-old', token: 'old-token' }),
        setItem,
      };
      const auth = new AuthController(BASE, {
        fetch: (async () => res(true)) as unknown as typeof fetch,
        storage: store,
        schedule: noSchedule,
      });
      await auth.probe();
      auth.reportWriteOutcome(false, 403);
      auth.watch();

      events.dispatchEvent(
        Object.assign(new Event('storage'), {
          key: 'binnacle:signalk-auth',
          newValue: JSON.stringify({ clientId: 'binnacle-new', token: 'rotated-token' }),
        }),
      );

      expect(auth.clientId).toBe('binnacle-new');
      expect(auth.token).toBe('rotated-token');
      expect(auth.status).toBe('authenticated');
      expect(auth.writeBlocked).toBe(false);
      expect(setItem).not.toHaveBeenCalled();
      auth.stop();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  });

  it('adopts a tokenless replacement identity from another tab', () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    try {
      const setItem = vi.fn();
      const auth = new AuthController(BASE, {
        fetch: (async () => res(true)) as unknown as typeof fetch,
        storage: {
          getItem: () => JSON.stringify({ clientId: 'binnacle-old', token: 'old-token' }),
          setItem,
        },
        schedule: noSchedule,
      });
      auth.watch();

      events.dispatchEvent(
        Object.assign(new Event('storage'), {
          key: 'binnacle:signalk-auth',
          newValue: JSON.stringify({ clientId: 'binnacle-reset', token: null }),
        }),
      );

      expect(auth.clientId).toBe('binnacle-reset');
      expect(auth.token).toBeNull();
      expect(auth.status).toBe('unknown');
      expect(setItem).not.toHaveBeenCalled();
      auth.stop();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  });

  it('rejects malformed approved tokens instead of persisting them', async () => {
    const store = storage();
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      return res(true, {
        state: 'COMPLETED',
        accessRequest: { permission: 'APPROVED', token: 'bad\ntoken' },
      });
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });

    await auth.requestAccess();
    await auth.checkRequest();

    expect(auth.status).toBe('denied');
    expect(auth.token).toBeNull();
    expect(store.getItem('binnacle:signalk-auth')).not.toContain('bad');
  });

  it('allows a valid token rotation but ignores invalid direct token adoption', async () => {
    const auth = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'old' }),
      }),
      schedule: noSchedule,
    });
    await auth.probe();

    auth.adoptToken('rotated');
    expect(auth.token).toBe('rotated');
    auth.adoptToken('bad\u0000token');
    expect(auth.token).toBe('rotated');
  });

  it('does not let a stale rejected probe clear a token rotated by another tab', async () => {
    let finishProbe: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishProbe = resolve;
        }),
    );
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'old' }),
      }),
      schedule: noSchedule,
    });

    const probing = auth.probe();
    auth.adoptToken('rotated');
    finishProbe?.(res(false, {}, 401));
    await probing;

    expect(auth.token).toBe('rotated');
    expect(auth.status).toBe('authenticated');
  });

  it('does not let a stale successful probe resurrect forgotten credentials', async () => {
    let finishProbe: ((response: Response) => void) | undefined;
    const auth = new AuthController(BASE, {
      fetch: (() =>
        new Promise<Response>((resolve) => {
          finishProbe = resolve;
        })) as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'old' }),
      }),
      schedule: noSchedule,
    });

    const probing = auth.probe();
    auth.forgetDeviceCredentials(false);
    finishProbe?.(res(true));
    await probing;

    expect(auth.token).toBeNull();
    expect(auth.status).toBe('unknown');
  });

  it('does not adopt an old access approval after the identity is replaced', async () => {
    let finishPoll: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      return new Promise<Response>((resolve) => {
        finishPoll = resolve;
      });
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });

    await auth.requestAccess();
    const checking = auth.checkRequest();
    auth.forgetDeviceCredentials(false);
    finishPoll?.(
      res(true, {
        state: 'COMPLETED',
        accessRequest: { permission: 'APPROVED', token: 'stale-token' },
      }),
    );
    await checking;

    expect(auth.token).toBeNull();
    expect(auth.status).toBe('unknown');
  });

  it('drops runtime credentials when another tab removes the auth record', () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: events,
    });
    try {
      const store = storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-old', token: 'tok' }),
      });
      const auth = new AuthController(BASE, {
        fetch: (async () => res(true)) as unknown as typeof fetch,
        storage: store,
        schedule: noSchedule,
      });
      auth.watch();
      const event = Object.assign(new Event('storage'), {
        key: 'binnacle:signalk-auth',
        newValue: null,
      });
      events.dispatchEvent(event);

      expect(auth.token).toBeNull();
      expect(auth.status).toBe('unknown');
      expect(auth.clientId).not.toBe('binnacle-old');
      expect(store.getItem('binnacle:signalk-auth')).toContain('binnacle-old');
      auth.stop();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  });

  it('re-requests a fresh access request when the pending one is gone (404)', async () => {
    let n = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) {
        n += 1;
        return res(true, { href: `/signalk/v1/requests/r${n}` });
      }
      if (url.endsWith('/requests/r1')) return res(false, {}, 404);
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    await auth.requestAccess();
    await auth.checkRequest();
    expect(n).toBe(2);
    expect(auth.status).toBe('requesting');
  });

  it('keeps the stored token on a transport failure and skips the anonymous probe', async () => {
    const store = storage({
      'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'keepme' }),
    });
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    await auth.probe();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(auth.status).toBe('unknown');
    expect(JSON.parse(store.getItem('binnacle:signalk-auth') as string).token).toBe('keepme');
  });

  it('keeps the stored token on a non-auth probe error (500)', async () => {
    const store = storage({
      'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'keepme' }),
    });
    const fetchFn = vi.fn(async () => res(false, {}, 500));
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    await auth.probe();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.getItem('binnacle:signalk-auth') as string).token).toBe('keepme');
  });

  it('clears the stored token on a definite 401 rejection', async () => {
    const store = storage({
      'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'stale' }),
    });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/r1' });
      return res(false, {}, 401);
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    await auth.probe();
    expect(JSON.parse(store.getItem('binnacle:signalk-auth') as string).token).toBeNull();
    expect(auth.status).toBe('requesting');
  });

  it('retries a failed access-request POST without a reload', async () => {
    const scheduled: Array<() => void> = [];
    let postFails = true;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) {
        if (postFails) throw new Error('offline');
        return res(true, { href: '/signalk/v1/requests/r1' });
      }
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: (run) => {
        scheduled.push(run);
      },
    });
    await auth.requestAccess();
    expect(auth.status).toBe('requesting');
    expect(scheduled).toHaveLength(1);
    // The network comes back; the scheduled retry re-issues the POST and starts polling.
    postFails = false;
    scheduled[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(auth.status).toBe('requesting');
    const posts = fetchFn.mock.calls.filter(([url]) => String(url).endsWith('/access/requests'));
    expect(posts).toHaveLength(2);
    // The approval poll is now scheduled against the obtained href.
    expect(scheduled.length).toBeGreaterThan(1);
  });

  it('retries a non-success access-request response instead of reporting denial', async () => {
    const scheduled: Array<() => void> = [];
    const fetchFn = vi.fn(async () => res(false, {}, 503));
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: (run) => {
        scheduled.push(run);
      },
    });

    await auth.requestAccess();

    expect(auth.status).toBe('requesting');
    expect(scheduled).toHaveLength(1);
  });

  it('cancels scheduled polling and prevents its callback from running after stop', async () => {
    const scheduled: Array<() => void> = [];
    const handle = {};
    const cancelSchedule = vi.fn();
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage(),
      schedule: (run) => {
        scheduled.push(run);
        return handle;
      },
      cancelSchedule,
    });
    await auth.requestAccess();
    expect(scheduled).toHaveLength(1);

    auth.stop();
    expect(cancelSchedule).toHaveBeenCalledWith(handle);
    scheduled[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('flags read-only when an authenticated write is refused, and clears it on a later success', async () => {
    const fetchFn = vi.fn(async () => res(true, {}));
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'tok' }),
      }),
      schedule: noSchedule,
    });
    await auth.probe();
    expect(auth.status).toBe('authenticated');
    auth.reportWriteOutcome(false, 403);
    expect(auth.writeBlocked).toBe(true);
    auth.reportWriteOutcome(true, 200);
    expect(auth.writeBlocked).toBe(false);
  });

  it('ignores write outcomes when not authenticated (a read-only flag needs a working token)', () => {
    const auth = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: storage(),
      schedule: noSchedule,
    });
    auth.reportWriteOutcome(false, 403);
    expect(auth.writeBlocked).toBe(false);
  });

  it('requests a fresh read/write token without dropping the live read token, then adopts it', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/up1' });
      if (url.endsWith('/requests/up1'))
        return res(true, {
          state: 'COMPLETED',
          accessRequest: { permission: 'APPROVED', token: 'rwtok' },
        });
      return res(true, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'old' }),
      }),
      schedule: noSchedule,
    });
    await auth.probe();
    auth.reportWriteOutcome(false, 403);
    expect(auth.writeBlocked).toBe(true);
    await auth.requestWriteAccess();
    // While the upgrade is pending the read token keeps working: status stays authenticated on 'old'.
    expect(auth.upgrading).toBe(true);
    expect(auth.token).toBe('old');
    expect(auth.status).toBe('authenticated');
    await auth.checkUpgrade();
    expect(auth.token).toBe('rwtok');
    expect(auth.status).toBe('authenticated');
    expect(auth.writeBlocked).toBe(false);
    expect(auth.upgrading).toBe(false);
    expect(auth.upgradeOutcome).toBeUndefined();
  });

  it('records an unreachable upgrade outcome when the request POST fails', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'tok' }),
      }),
      schedule: noSchedule,
    });

    await auth.requestWriteAccess();

    expect(auth.upgrading).toBe(false);
    expect(auth.upgradeOutcome).toBe('unreachable');
  });

  it('records a declined upgrade outcome when the admin refuses it', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/up1' });
      if (url.endsWith('/requests/up1'))
        return res(true, { state: 'COMPLETED', accessRequest: { permission: 'DENIED' } });
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'tok' }),
      }),
      schedule: noSchedule,
    });

    await auth.requestWriteAccess();
    expect(auth.upgrading).toBe(true);
    await auth.checkUpgrade();

    expect(auth.upgrading).toBe(false);
    expect(auth.upgradeOutcome).toBe('declined');
  });

  it('records an unanswered upgrade outcome when the request is gone', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/up1' });
      if (url.endsWith('/requests/up1')) return res(false, {}, 404);
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'tok' }),
      }),
      schedule: noSchedule,
    });

    await auth.requestWriteAccess();
    await auth.checkUpgrade();

    // The server answered (the request expired or was cleared), so this is unanswered, not
    // unreachable: the banner must not steer the navigator toward connectivity troubleshooting.
    expect(auth.upgradeOutcome).toBe('unanswered');
  });

  it('clears a prior upgrade outcome when a new upgrade begins', async () => {
    let fail = true;
    const fetchFn = vi.fn(async (url: string) => {
      if (fail) throw new Error('offline');
      if (url.endsWith('/access/requests')) return res(true, { href: '/signalk/v1/requests/up1' });
      return res(false, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'tok' }),
      }),
      schedule: noSchedule,
    });

    await auth.requestWriteAccess();
    expect(auth.upgradeOutcome).toBe('unreachable');

    fail = false;
    await auth.requestWriteAccess();

    expect(auth.upgradeOutcome).toBeUndefined();
    expect(auth.upgrading).toBe(true);
  });

  it('clears the upgrade outcome once a write succeeds', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/access/requests')) throw new Error('offline');
      return res(true, {});
    });
    const auth = new AuthController(BASE, {
      fetch: fetchFn as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'tok' }),
      }),
      schedule: noSchedule,
    });
    await auth.probe();
    auth.reportWriteOutcome(false, 403);
    await auth.requestWriteAccess();
    expect(auth.upgradeOutcome).toBe('unreachable');

    auth.reportWriteOutcome(true, 200);

    expect(auth.upgradeOutcome).toBeUndefined();
  });

  it('clears an in-progress write upgrade when stopped', async () => {
    const auth = new AuthController(BASE, {
      fetch: (async () =>
        res(true, { href: '/signalk/v1/requests/up1' })) as unknown as typeof fetch,
      storage: storage({
        'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-1', token: 'old' }),
      }),
      schedule: noSchedule,
    });

    await auth.requestWriteAccess();
    expect(auth.upgrading).toBe(true);

    auth.stop();

    expect(auth.upgrading).toBe(false);
  });

  it('keeps a stable clientId across instances', () => {
    const store = storage();
    const a = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    const b = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    expect(a.clientId).toBe(b.clientId);
  });

  it('forgets the local device credentials and rotates the client identity', async () => {
    const store = storage({
      'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-old', token: 'tok' }),
    });
    const auth = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });
    await auth.probe();

    auth.forgetDeviceCredentials();

    expect(auth.token).toBeNull();
    expect(auth.status).toBe('unknown');
    expect(auth.clientId).not.toBe('binnacle-old');
    expect(
      new AuthController(BASE, {
        fetch: (async () => res(true)) as unknown as typeof fetch,
        storage: store,
        schedule: noSchedule,
      }).clientId,
    ).toBe(auth.clientId);
  });

  it('can reset runtime auth without recreating storage after a privacy erase', () => {
    const store = storage({
      'binnacle:signalk-auth': JSON.stringify({ clientId: 'binnacle-old', token: 'tok' }),
    });
    const auth = new AuthController(BASE, {
      fetch: (async () => res(true)) as unknown as typeof fetch,
      storage: store,
      schedule: noSchedule,
    });

    auth.forgetDeviceCredentials(false);

    expect(auth.clientId).not.toBe('binnacle-old');
    expect(
      new AuthController(BASE, {
        fetch: (async () => res(true)) as unknown as typeof fetch,
        storage: store,
        schedule: noSchedule,
      }).clientId,
    ).toBe('binnacle-old');
  });
});
