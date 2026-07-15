import { describe, expect, it, vi } from 'vitest';
import { createRegionsClient, HttpStatusError } from './regions-client.js';

const ok = (body: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('regions client', () => {
  it('maps a region status 404 to null (the job is gone)', async () => {
    const fetchImpl = vi.fn(async () => ok({}, 404));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.getRegionJobStatus('region-9')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/regions/region-9/status',
      expect.objectContaining({
        credentials: 'include',
        cache: 'no-store',
      }),
    );
  });

  it('forwards caller cancellation to region status requests', async () => {
    const fetchImpl = vi.fn(async () => ok({}, 404));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      fetchImpl as unknown as typeof fetch,
    );
    const abort = new AbortController();
    await client.getRegionJobStatus('region-9', abort.signal);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    abort.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it('rejects malformed region and warm-status provider responses', async () => {
    const malformedRegion = vi.fn(async () => ok([{ id: 'missing-fields' }]));
    const regions = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      malformedRegion as unknown as typeof fetch,
    );
    await expect(regions.getRegions()).rejects.toThrow('invalid saved region');

    const malformedStatus = vi.fn(async () =>
      ok({ total: 1, done: 2, skipped: 0, bytes: 0, errors: 0, state: 'running' }),
    );
    const statuses = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      malformedStatus as unknown as typeof fetch,
    );
    await expect(statuses.getRegionJobStatus('region-9')).rejects.toThrow('invalid region status');
  });

  it('encodes lat and lon into the geocode query', async () => {
    const fetchImpl = vi.fn(async () => ok({ display_name: 'Test City' }));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.geocode(37.77, -122.41)).toBe('Test City');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/geocode?lat=37.77&lon=-122.41',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('reads the cache stats without a token on an unsecured server', async () => {
    const stats = { rows: 2, bytes: 100, cap: 1000, perSourceAvgBytes: { seamark: 50 } };
    const fetchImpl = vi.fn(async () => ok(stats));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.getCacheStats()).toEqual(stats);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/cache/stats',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('getCacheStats throws an HttpStatusError carrying the status on 401', async () => {
    const fetchImpl = vi.fn(async () => ok({ error: 'unauthorized' }, 401));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
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
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toMatchObject({
      name: 'HttpStatusError',
      status: 500,
    });
  });

  it('getCacheStats parses the body on 200', async () => {
    const stats = {
      rows: 3,
      bytes: 4096,
      cap: 1000,
      perSourceAvgBytes: { seamark: 565.7692307692307 },
    };
    const fetchImpl = vi.fn(async () => ok(stats));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
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
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toThrow('invalid cache stats');
  });

  it('posts config with the administrator session and no bearer token', async () => {
    const fetchImpl = vi.fn(async () => ok(undefined));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      fetchImpl as unknown as typeof fetch,
    );
    const config = { sources: ['seamark'] };
    await client.postConfig(config);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/position-warm/config',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(config),
      }),
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('setCacheConfig posts ttlDays to the cache config route', async () => {
    const fetchImpl = vi.fn(async () => ok(undefined));
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
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
      fetchImpl as unknown as typeof fetch,
    );
    const out = await client.clearScrollCache();
    expect(out).toEqual({ freedBytes: 9, freedRows: 2 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://h/plugins/signalk-chart-locker/api/cache/clear-scroll',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects malformed mutation responses before they reach controller state', async () => {
    const malformed = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () => ok({ jobId: '', region: { id: 'incomplete' } })) as unknown as typeof fetch,
    );

    await expect(malformed.clearScrollCache()).rejects.toThrow('invalid cache clear result');
    await expect(
      malformed.postRegion({
        bbox: [-1, -1, 1, 1],
        sourceIds: ['basemap'],
        minzoom: 1,
        maxzoom: 2,
        name: 'Area',
      }),
    ).rejects.toThrow();
    await expect(malformed.redownloadRegion('r1')).rejects.toThrow('invalid region job');
  });
});
