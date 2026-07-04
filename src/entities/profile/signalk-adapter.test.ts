import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing/fetch-stub';
import type { ProfilesState } from './profile-types';
import { SignalKProfileAdapter } from './signalk-adapter';

const URL = 'http://pi/signalk/v1/applicationData/user/signalk-binnacle/1.0.0';

const STATE: ProfilesState = {
  profiles: [
    {
      id: 'a',
      name: 'Coastal',
      settings: {} as ProfilesState['profiles'][number]['settings'],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  activeId: 'a',
  defaultId: undefined,
};

describe('SignalKProfileAdapter.load', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GETs the applicationData URL with the Bearer header and parses a stored state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, STATE));
    vi.stubGlobal('fetch', fetchMock);
    const loaded = await new SignalKProfileAdapter('http://pi', () => 'tok').load();
    expect(loaded).toEqual(STATE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);
    // authInit adds no method, so the request defaults to GET.
    expect((init as RequestInit | undefined)?.method).toBeUndefined();
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('returns an empty state when the server returns an empty {} document (reachable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})));
    expect(await new SignalKProfileAdapter('http://pi', () => 'tok').load()).toEqual({
      profiles: [],
      activeId: undefined,
      defaultId: undefined,
    });
  });

  it('returns undefined on a non-ok response such as 401 (unavailable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));
    expect(await new SignalKProfileAdapter('http://pi', () => 'tok').load()).toBeUndefined();
  });

  it('returns undefined when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await new SignalKProfileAdapter('http://pi', () => 'tok').load()).toBeUndefined();
  });
});

describe('SignalKProfileAdapter.save', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the state as JSON to the URL with the Bearer header and returns true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new SignalKProfileAdapter('http://pi', () => 'tok').save(STATE)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(STATE);
  });

  it('returns false on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await new SignalKProfileAdapter('http://pi', () => 'tok').save(STATE)).toBe(false);
  });

  it('returns false when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await new SignalKProfileAdapter('http://pi', () => 'tok').save(STATE)).toBe(false);
  });
});
