import { describe, expect, it, vi } from 'vitest';
import { fetchManagedCharts, putChartOverride } from './charts-management-client';

const ORIGIN = 'http://pi.local';
const BASE = `${ORIGIN}/plugins/signalk-chart-locker`;
const API = `${BASE}/api`;

describe('charts-management-client', () => {
  it('fetches the managed charts list with the administrator session', async () => {
    const payload = {
      charts: [
        {
          identifier: 'sf-pmtiles',
          fileName: 'sf.pmtiles',
          name: 'sf',
          description: '',
          scale: 250000,
          minzoom: 0,
          maxzoom: 14,
          format: 'mvt',
          override: {},
        },
      ],
      invalid: [],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await fetchManagedCharts(BASE, fetchImpl);
    expect(result?.charts[0].identifier).toBe('sf-pmtiles');
    expect(fetchImpl).toHaveBeenCalledWith(
      `${API}/charts`,
      expect.objectContaining({
        credentials: 'include',
        cache: 'no-store',
      }),
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('returns undefined on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }));
    expect(await fetchManagedCharts(BASE, fetchImpl)).toBeUndefined();
  });

  it('posts an override with the administrator session and reports success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const ok = await putChartOverride(BASE, 'sf-pmtiles', { name: 'Renamed' }, fetchImpl);
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${API}/charts/sf-pmtiles/override`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      }),
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });
});
