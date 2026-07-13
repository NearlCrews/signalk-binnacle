import { describe, expect, it, vi } from 'vitest';
import { createRegionsClient, HttpStatusError } from './regions-client.js';

const ok = (body: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('regions client', () => {
  it('maps a region status 404 to null (the job is gone)', async () => {
    const fetchImpl = vi.fn(async () => ok({}, 404));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.getRegionJobStatus('region-9')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/regions/region-9/status',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });

  it('encodes lat and lon into the geocode query', async () => {
    const fetchImpl = vi.fn(async () => ok({ display_name: 'Test City' }));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.geocode(37.77, -122.41)).toBe('Test City');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/geocode?lat=37.77&lon=-122.41',
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });

  it('reads the cache stats without a token on an unsecured server', async () => {
    const stats = { rows: 2, bytes: 100, cap: 1000, perSourceAvgBytes: { seamark: 50 } };
    const fetchImpl = vi.fn(async () => ok(stats));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.getCacheStats()).toEqual(stats);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/cache/stats',
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });

  it('getCacheStats throws an HttpStatusError carrying the status on 401', async () => {
    const fetchImpl = vi.fn(async () => ok({ error: 'unauthorized' }, 401));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toMatchObject({
      name: 'HttpStatusError',
      status: 401,
    });
    await expect(client.getCacheStats()).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('getCacheStats throws an HttpStatusError carrying the status on 500', async () => {
    const fetchImpl = vi.fn(async () => ok({ error: 'boom' }, 500));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toMatchObject({
      name: 'HttpStatusError',
      status: 500,
    });
  });

  it('getCacheStats parses the body on 200', async () => {
    const stats = { rows: 3, bytes: 4096, cap: 1000, perSourceAvgBytes: { seamark: 50 } };
    const fetchImpl = vi.fn(async () => ok(stats));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.getCacheStats()).toEqual(stats);
  });

  it('getCacheStats rejects a malformed measured average', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ rows: 3, bytes: 4096, cap: 1000, perSourceAvgBytes: { seamark: 0 } }),
    );
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toThrow('invalid cache stats');
  });

  it('getCacheStats rejects unsafe or negative totals', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ rows: 3, bytes: -1, cap: 1000, perSourceAvgBytes: {} }),
    );
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toThrow('invalid cache stats');
  });

  it('posts config with the bearer token', async () => {
    const fetchImpl = vi.fn(async () => ok(undefined));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    const config = { sources: ['seamark'] };
    await client.postConfig(config);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/position-warm/config',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify(config),
      }),
    );
  });

  it('setCacheConfig posts ttlDays to the cache config route', async () => {
    const fetchImpl = vi.fn(async () => ok(undefined));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    await client.setCacheConfig(14);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/cache/config',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ttlDays: 14 }) }),
    );
  });

  it('clearScrollCache posts to the clear route and returns the freed totals', async () => {
    const fetchImpl = vi.fn(async () => ok({ freedBytes: 9, freedRows: 2 }));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      'tok',
      fetchImpl as unknown as typeof fetch,
    );
    const out = await client.clearScrollCache();
    expect(out).toEqual({ freedBytes: 9, freedRows: 2 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/cache/clear-scroll',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
