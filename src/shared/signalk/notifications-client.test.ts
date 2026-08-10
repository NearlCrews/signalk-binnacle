import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth, stubFetch } from '$shared/testing';
import {
  acknowledgeNotification,
  fetchRaisedNotificationPaths,
  postMobNotification,
  postNotification,
  resolveNotification,
  silenceNotification,
  updateNotification,
} from './notifications-client';

const BASE = 'https://boat.example';
const API = `${BASE}/signalk/v2/api/notifications`;
const ID = '6e6f7469-6669-4361-9469-6f6e49644142';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postNotification', () => {
  it('raises via POST and returns the assigned id', async () => {
    const mock = stubFetch({
      ok: true,
      body: { state: 'COMPLETED', statusCode: 200, message: 'OK', id: ID },
    });
    const options = { state: 'alarm', message: 'Shallow water', path: 'navigation.depth' } as const;
    await expect(postNotification(BASE, 'tok', options)).resolves.toBe(ID);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(API);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(options);
    expectBearerAuth(init, 'tok');
  });

  it('strips the notifications prefix off a canonical path before the raise', async () => {
    // Callers pass the one canonical 'notifications.'-prefixed path; the wire format wants the
    // bare form the server re-prefixes, and the client owns that quirk.
    const mock = stubFetch({
      ok: true,
      body: { state: 'COMPLETED', statusCode: 200, message: 'OK', id: ID },
    });
    await postNotification(BASE, 'tok', {
      state: 'alarm',
      message: 'Collision risk',
      path: 'notifications.navigation.collision',
    });
    const [, init] = mock.mock.calls[0];
    expect(JSON.parse(init?.body as string).path).toBe('navigation.collision');
  });

  it('returns undefined when the server rejects the raise', async () => {
    stubFetch({ ok: false, body: { state: 'FAILED', statusCode: 400 } });
    await expect(
      postNotification(BASE, undefined, { state: 'alarm', message: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined on a transport failure instead of throwing', async () => {
    stubFetch('reject');
    await expect(
      postNotification(BASE, undefined, { state: 'alarm', message: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('reports an unparseable 200 raise body as missing rather than throwing', async () => {
    // A 200 whose body fails to parse must degrade to "no id", not reject the publish.
    stubFetch({ ok: true, rejectJson: true });
    await expect(
      postNotification(BASE, undefined, { state: 'alarm', message: 'x' }),
    ).resolves.toBeUndefined();
  });
});

describe('updateNotification', () => {
  it('updates in place via PUT on the id', async () => {
    const mock = stubFetch({ ok: true });
    await expect(updateNotification(BASE, 'tok', ID, { state: 'warn' })).resolves.toBe('updated');
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${API}/${ID}`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ state: 'warn' });
  });

  it('reports an unknown id as missing so the caller can re-raise', async () => {
    stubFetch({ ok: false, status: 400 });
    await expect(updateNotification(BASE, 'tok', ID, { state: 'warn' })).resolves.toBe('missing');
  });

  it('reports server and transport failures as failed', async () => {
    stubFetch({ ok: false, status: 500 });
    await expect(updateNotification(BASE, 'tok', ID, { state: 'warn' })).resolves.toBe('failed');
    stubFetch('reject');
    await expect(updateNotification(BASE, 'tok', ID, { state: 'warn' })).resolves.toBe('failed');
  });

  it('reports an auth refusal as failed, not missing, so the id is kept', async () => {
    stubFetch({ ok: false, status: 403 });
    await expect(updateNotification(BASE, 'tok', ID, { state: 'warn' })).resolves.toBe('failed');
    stubFetch({ ok: false, status: 401 });
    await expect(updateNotification(BASE, 'tok', ID, { state: 'warn' })).resolves.toBe('failed');
  });
});

describe('resolveNotification', () => {
  it('clears via DELETE on the id', async () => {
    const mock = stubFetch({ ok: true });
    await expect(resolveNotification(BASE, undefined, ID)).resolves.toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${API}/${ID}`);
    expect(init?.method).toBe('DELETE');
  });

  it('returns false on failure', async () => {
    stubFetch({ ok: false });
    await expect(resolveNotification(BASE, undefined, ID)).resolves.toBe(false);
  });
});

describe('silence and acknowledge', () => {
  it('posts to the per-id action routes', async () => {
    const mock = stubFetch({ ok: true });
    await expect(silenceNotification(BASE, 'tok', ID)).resolves.toBe('completed');
    await expect(acknowledgeNotification(BASE, 'tok', ID)).resolves.toBe('completed');
    const urls = mock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([`${API}/${ID}/silence`, `${API}/${ID}/acknowledge`]);
    expect(mock.mock.calls.every((call) => call[1]?.method === 'POST')).toBe(true);
  });

  it('reports a transport failure instead of throwing', async () => {
    stubFetch('reject');
    await expect(silenceNotification(BASE, undefined, ID)).resolves.toBe('failed');
    await expect(acknowledgeNotification(BASE, undefined, ID)).resolves.toBe('failed');
  });

  it('reports an access refusal as a failure', async () => {
    stubFetch({ ok: false, status: 403 });
    await expect(silenceNotification(BASE, 'tok', ID)).resolves.toBe('failed');
    await expect(acknowledgeNotification(BASE, 'tok', ID)).resolves.toBe('failed');
  });

  it('reports disabled server-side notification management as unsupported', async () => {
    stubFetch({ ok: false, status: 501 });
    await expect(silenceNotification(BASE, 'tok', ID)).resolves.toBe('unsupported');
    await expect(acknowledgeNotification(BASE, 'tok', ID)).resolves.toBe('unsupported');
  });
});

describe('fetchRaisedNotificationPaths', () => {
  it('flattens the v1 snapshot tree to raised, prefixed paths', async () => {
    const mock = stubFetch({
      ok: true,
      body: {
        navigation: {
          anchor: { value: { state: 'alarm', message: 'Dragging' } },
          closestApproach: { value: { state: 'normal' } },
        },
        mob: { value: { state: 'emergency', message: 'MOB' } },
        cleared: { value: null },
      },
    });
    const paths = await fetchRaisedNotificationPaths(BASE, 'tok');
    expect(paths).toEqual(new Set(['notifications.navigation.anchor', 'notifications.mob']));
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${BASE}/signalk/v1/api/vessels/self/notifications`);
    expectBearerAuth(init, 'tok');
  });

  it('treats a missing notifications branch as a real empty set', async () => {
    stubFetch({ ok: false, status: 404 });
    await expect(fetchRaisedNotificationPaths(BASE, undefined)).resolves.toEqual(new Set());
  });

  it('returns undefined on transport and server failures, so the mirror stays untouched', async () => {
    stubFetch('reject');
    await expect(fetchRaisedNotificationPaths(BASE, undefined)).resolves.toBeUndefined();
    stubFetch({ ok: false, status: 500 });
    await expect(fetchRaisedNotificationPaths(BASE, undefined)).resolves.toBeUndefined();
  });

  it('skips malformed segments that could not name a mirrored path', async () => {
    stubFetch({
      ok: true,
      body: {
        'bad.dotted': { value: { state: 'alarm' } },
        'bad\u0000control': { value: { state: 'alarm' } },
        good: { value: { state: 'warn' } },
      },
    });
    await expect(fetchRaisedNotificationPaths(BASE, undefined)).resolves.toEqual(
      new Set(['notifications.good']),
    );
  });
});

describe('postMobNotification', () => {
  it('posts the optional message to the mob route and returns the id', async () => {
    const mock = stubFetch({ ok: true, body: { id: ID } });
    await expect(postMobNotification(BASE, 'tok', 'Crew overboard')).resolves.toBe(ID);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${API}/mob`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ message: 'Crew overboard' });
  });

  it('sends an empty body when no message is given', async () => {
    const mock = stubFetch({ ok: true, body: { id: ID } });
    await expect(postMobNotification(BASE, undefined)).resolves.toBe(ID);
    expect(JSON.parse(mock.mock.calls[0][1]?.body as string)).toEqual({});
  });
});
