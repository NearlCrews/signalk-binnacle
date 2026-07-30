import { describe, expect, it, vi } from 'vitest';
import { createRegionsClient, HttpStatusError } from './regions-client.js';

const ok = (body: unknown, status = 200): Response =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const savedRegion = {
  id: 'region-1',
  name: 'Passage',
  bbox: [-1, -1, 1, 1],
  sourceIds: ['basemap'],
  minzoom: 1,
  maxzoom: 2,
  createdAt: 1,
  lastDownloadedAt: null,
  bytes: 0,
  status: 'downloading',
  cachedBytes: 0,
  unavailableSourceIds: [],
};

const legacyCreateRegion = Object.fromEntries(
  Object.entries(savedRegion).filter(
    ([key]) => key !== 'cachedBytes' && key !== 'unavailableSourceIds',
  ),
);

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

    const impossibleProgress = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok({ total: 2, done: 2, skipped: 1, bytes: 0, errors: 0, state: 'running' }),
      ) as unknown as typeof fetch,
    );
    await expect(impossibleProgress.getRegionJobStatus('region-9')).rejects.toThrow(
      'invalid region status',
    );

    const extraStatusFields = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok({
          total: 2,
          done: 1,
          skipped: 0,
          bytes: 10,
          errors: 0,
          state: 'running',
          jobId: 'server-only',
        }),
      ) as unknown as typeof fetch,
    );
    await expect(extraStatusFields.getRegionJobStatus('region-9')).resolves.toEqual({
      total: 2,
      done: 1,
      skipped: 0,
      bytes: 10,
      errors: 0,
      state: 'running',
    });
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
      detail: 'boom',
    });
    await expect(client.getCacheStats()).rejects.toThrow('Chart Locker: boom');
  });

  it('does not expose malformed Chart Locker error details', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () => ok({ error: 'unsafe\nmessage' }, 409)) as unknown as typeof fetch,
    );
    await expect(client.redownloadRegion('region-1')).rejects.toMatchObject({
      name: 'HttpStatusError',
      status: 409,
      detail: undefined,
      message: 'Chart Locker request failed (HTTP 409)',
    });
  });

  it('getCacheStats rounds measured averages up for the shared estimator', async () => {
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
    expect(await client.getCacheStats()).toEqual({
      ...stats,
      perSourceAvgBytes: { seamark: 566 },
    });
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

  it('rejects duplicate per-source cache statistics', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok({
          rows: 3,
          bytes: 4096,
          cap: 1000,
          perSourceAvgBytes: {},
          bySource: [
            { source: 'basemap', bytes: 100, rows: 1 },
            { source: 'basemap', bytes: 200, rows: 2 },
          ],
        }),
      ) as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toThrow('invalid cache stats');
  });

  it('rejects a JSON response whose declared size exceeds the client boundary', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Length': `${2 * 1024 * 1024 + 1}` },
        }),
    );
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      fetchImpl as unknown as typeof fetch,
    );

    await expect(client.getCacheStats()).rejects.toThrow('response is too large');
  });

  it('rejects malformed declared lengths and cancels the response body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'Content-Length': '1e3' },
          }),
      ) as unknown as typeof fetch,
    );

    await expect(client.getCacheStats()).rejects.toThrow('invalid companion response length');
    expect(cancelled).toBe(true);
  });

  it('rejects malformed UTF-8 instead of decoding replacement characters', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(
        async () => new Response(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])),
      ) as unknown as typeof fetch,
    );
    await expect(client.getCacheStats()).rejects.toThrow();
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

  it('accepts Chart Locker recovery-pending responses when the warm job ID was lost', async () => {
    const create = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok({ region: savedRegion, recovery: 'pending' }, 202),
      ) as unknown as typeof fetch,
    );
    await expect(
      create.postRegion({
        bbox: [-1, -1, 1, 1],
        sourceIds: ['basemap'],
        minzoom: 1,
        maxzoom: 2,
        name: 'Passage',
      }),
    ).resolves.toEqual({ region: savedRegion, recovery: 'pending' });

    const redownload = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () => ok({ recovery: 'pending' }, 202)) as unknown as typeof fetch,
    );
    await expect(redownload.redownloadRegion('region-1')).resolves.toEqual({
      recovery: 'pending',
    });
  });

  it('requires recovery and normal mutation bodies to match their HTTP status', async () => {
    const recoveryWithOk = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok({ region: savedRegion, recovery: 'pending' }, 200),
      ) as unknown as typeof fetch,
    );
    await expect(
      recoveryWithOk.postRegion({
        bbox: [-1, -1, 1, 1],
        sourceIds: ['basemap'],
        minzoom: 1,
        maxzoom: 2,
        name: 'Passage',
      }),
    ).rejects.toThrow('invalid region job');

    const jobWithAccepted = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () => ok({ jobId: 'job-1' }, 202)) as unknown as typeof fetch,
    );
    await expect(jobWithAccepted.redownloadRegion('region-1')).rejects.toThrow(
      'invalid region job',
    );
  });

  it('defaults cachedBytes for Chart Locker 0.5.0 create responses', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok({ region: legacyCreateRegion, jobId: 'legacy-job' }),
      ) as unknown as typeof fetch,
    );
    await expect(
      client.postRegion({
        bbox: [-1, -1, 1, 1],
        sourceIds: ['basemap'],
        minzoom: 1,
        maxzoom: 2,
        name: 'Passage',
      }),
    ).resolves.toEqual({ region: savedRegion, jobId: 'legacy-job' });
  });

  it('defaults cachedBytes for a recovery-pending legacy create response', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok({ region: legacyCreateRegion, recovery: 'pending' }, 202),
      ) as unknown as typeof fetch,
    );
    await expect(
      client.postRegion({
        bbox: [-1, -1, 1, 1],
        sourceIds: ['basemap'],
        minzoom: 1,
        maxzoom: 2,
        name: 'Passage',
      }),
    ).resolves.toEqual({ region: savedRegion, recovery: 'pending' });
  });

  it('still requires cachedBytes on saved-region list responses', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () => ok([legacyCreateRegion])) as unknown as typeof fetch,
    );
    await expect(client.getRegions()).rejects.toThrow('invalid saved region');
  });

  it('retains bounded unavailable source metadata from saved-region lists', async () => {
    const unavailable = {
      ...savedRegion,
      sourceIds: ['basemap', 'retired-chart'],
      unavailableSourceIds: ['retired-chart'],
    };
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () => ok([unavailable])) as unknown as typeof fetch,
    );
    await expect(client.getRegions()).resolves.toEqual([unavailable]);

    const invalid = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok([{ ...savedRegion, unavailableSourceIds: ['not-in-the-region'] }]),
      ) as unknown as typeof fetch,
    );
    await expect(invalid.getRegions()).rejects.toThrow('invalid saved region');
  });

  it('rejects duplicate source identifiers instead of silently changing the saved definition', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok([{ ...savedRegion, sourceIds: ['basemap', 'basemap'] }]),
      ) as unknown as typeof fetch,
    );
    await expect(client.getRegions()).rejects.toThrow('invalid saved region');
  });

  it('rejects duplicate saved-region identities', async () => {
    const client = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () =>
        ok([savedRegion, { ...savedRegion, name: 'Conflicting area' }]),
      ) as unknown as typeof fetch,
    );
    await expect(client.getRegions()).rejects.toThrow('invalid saved regions');
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

    const conflicting = createRegionsClient(
      'http://h/plugins/signalk-chart-locker',
      vi.fn(async () => ok({ jobId: 'job-1', recovery: 'pending' })) as unknown as typeof fetch,
    );
    await expect(conflicting.redownloadRegion('r1')).rejects.toThrow('invalid region job');
  });
});
