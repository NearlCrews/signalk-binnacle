import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import { fetchCharts } from './charts-client';

afterEach(() => vi.restoreAllMocks());

describe('fetchCharts', () => {
  it('normalizes the v2 charts map to an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(200, {
          noaa: { identifier: 'noaa', name: 'NOAA', type: 'tilelayer' },
          enc: { identifier: 'enc', name: 'ENC', type: 'tileJSON' },
        }),
      ),
    );
    const charts = (await fetchCharts('http://pi.local')) ?? [];
    expect(charts).toHaveLength(2);
    expect(charts.map((c) => c.identifier).sort()).toEqual(['enc', 'noaa']);
  });

  it('uses unique resource keys when embedded identifiers collide', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(200, {
          primary: { identifier: 'shared', name: 'Primary', type: 'tilelayer' },
          secondary: { identifier: 'shared', name: 'Secondary', type: 'tilelayer' },
        }),
      ),
    );
    const charts = (await fetchCharts('http://pi.local')) ?? [];
    expect(charts.map((chart) => chart.identifier)).toEqual(['primary', 'secondary']);
  });

  it('falls back to v1 when v2 returns 404', async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(404, {}))
      .mockReturnValueOnce(
        jsonResponse(200, { noaa: { identifier: 'noaa', name: 'NOAA', type: 'tilelayer' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const charts = (await fetchCharts('http://pi.local')) ?? [];
    expect(charts).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when both endpoints fail so a caller keeps its charts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(500, {})),
    );
    expect(await fetchCharts('http://pi.local')).toBeUndefined();
  });

  it('returns undefined on a fetch rejection so a caller keeps its charts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    expect(await fetchCharts('http://pi.local')).toBeUndefined();
  });

  it('returns an empty array for a reachable server with no charts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, {})),
    );
    expect(await fetchCharts('http://pi.local')).toEqual([]);
  });

  it('sends the auth token as a Bearer header when given', async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse(200, { noaa: { identifier: 'noaa', name: 'NOAA', type: 'tilelayer' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchCharts('http://pi.local', 'tok');
    // objectContaining tolerates the timeout AbortSignal the resource client now adds to every init.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://pi.local/signalk/v2/api/resources/charts',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('rejects unsafe chart records and bounds optional fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(200, {
          unsafe: { name: 'Bad\nname', type: 'tilelayer' },
          unknown: { name: 'Unknown', type: 'made-up' },
          safe: {
            name: ' Safe ',
            type: 'tileJSON',
            bounds: [-181, -20, 20, 20],
            minzoom: 5,
            maxzoom: 3,
            layers: [' water ', 'bad\nlayer'],
            injected: 'ignored',
          },
        }),
      ),
    );
    const charts = (await fetchCharts('http://pi.local')) ?? [];
    expect(charts).toEqual([
      {
        identifier: 'safe',
        name: 'Safe',
        type: 'tileJSON',
        minzoom: 5,
        layers: ['water'],
      },
    ]);
  });

  it('caps provider chart collections', async () => {
    const records = Object.fromEntries(
      Array.from({ length: 1_001 }, (_, index) => [
        `chart-${index}`,
        { name: `Chart ${index}`, type: 'tilelayer' },
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, records)),
    );
    expect(await fetchCharts('http://pi.local')).toHaveLength(1_000);
  });
});
