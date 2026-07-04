import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { discoverBatteries } from './battery-discovery';

describe('discoverBatteries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns sorted instance keys from a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { starter: {}, house: {}, bank2: {} })),
    );
    const result = await discoverBatteries('http://pi', 'tok');
    expect(result).toEqual(['bank2', 'house', 'starter']);
  });

  it('sends the bearer header when a token is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { house: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await discoverBatteries('http://pi', 'my-token');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pi/signalk/v1/api/vessels/self/electrical/batteries');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer my-token',
    );
  });

  it('returns [] when the response body is not an object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, ['array'])),
    );
    expect(await discoverBatteries('http://pi', undefined)).toEqual([]);
  });

  it('returns [] on a 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, {})),
    );
    expect(await discoverBatteries('http://pi', undefined)).toEqual([]);
  });

  it('returns [] on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    expect(await discoverBatteries('http://pi', undefined)).toEqual([]);
  });
});
