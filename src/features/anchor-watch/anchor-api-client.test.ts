import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectBearerAuth } from '$shared/testing/fetch-stub';
import {
  dropAnchorViaApi,
  raiseAnchorViaApi,
  repositionAnchorViaApi,
  setRadiusViaApi,
} from './anchor-api-client';

const BASE = 'https://boat.example';
const API = `${BASE}/signalk/v2/api/vessels/self/navigation/anchor`;

function stubFetch(response: { ok: boolean } | 'reject') {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response === 'reject') throw new TypeError('network down');
    return { ok: response.ok } as Response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('standard anchor API client', () => {
  it('drops with a bare POST and the bearer token', async () => {
    const mock = stubFetch({ ok: true });
    await expect(dropAnchorViaApi(BASE, 'tok')).resolves.toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${API}/drop`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expectBearerAuth(init, 'tok');
  });

  it('raises with a bare POST', async () => {
    const mock = stubFetch({ ok: true });
    await expect(raiseAnchorViaApi(BASE, undefined)).resolves.toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${API}/raise`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });

  it('sets the radius with { value } per the proposal', async () => {
    const mock = stubFetch({ ok: true });
    await setRadiusViaApi(BASE, 'tok', 60);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${API}/radius`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ value: 60 });
  });

  it('repositions with { rodeLength, anchorDepth } per the proposal', async () => {
    const mock = stubFetch({ ok: true });
    await repositionAnchorViaApi(BASE, 'tok', 40, 8);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(`${API}/reposition`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ rodeLength: 40, anchorDepth: 8 });
  });

  it('returns false on a non-OK status', async () => {
    stubFetch({ ok: false });
    await expect(dropAnchorViaApi(BASE, undefined)).resolves.toBe(false);
  });

  it('returns false on a network failure instead of throwing', async () => {
    stubFetch('reject');
    await expect(raiseAnchorViaApi(BASE, undefined)).resolves.toBe(false);
  });
});
