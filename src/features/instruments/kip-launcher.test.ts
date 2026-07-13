import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { detectKip } from './kip-launcher';

const ORIGIN = 'http://pi';
const TOKEN = 'tok';
const WEBAPPS_URL = `${ORIGIN}/skServer/webapps`;

describe('detectKip', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves true when response contains @mxtommy/kip entry, asserts URL and bearer header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, [{ name: '@mxtommy/kip' }, { name: 'other-app' }]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await detectKip(ORIGIN, TOKEN)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBAPPS_URL);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('resolves false when response contains no @mxtommy/kip entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [{ name: 'other-app' }])));
    expect(await detectKip(ORIGIN, TOKEN)).toBe(false);
  });

  it('resolves false when response body is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { name: '@mxtommy/kip' })));
    expect(await detectKip(ORIGIN, TOKEN)).toBe(false);
  });

  it('keeps availability unknown on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));
    expect(await detectKip(ORIGIN, TOKEN)).toBeUndefined();
  });

  it('keeps availability unknown on network rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    expect(await detectKip(ORIGIN, TOKEN)).toBeUndefined();
  });
});
