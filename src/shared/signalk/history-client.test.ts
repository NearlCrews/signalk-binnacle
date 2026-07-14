import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '$shared/testing/fetch-stub';
import {
  fetchHistoryPaths,
  fetchHistoryProviderPathCatalogs,
  fetchHistoryProviders,
  fetchHistoryValues,
  fetchHistoryValuesAcrossProviders,
  fetchPopulatedHistoryPathsForProvider,
  MAX_HISTORY_CATALOG_PATHS,
  MAX_HISTORY_PROVIDERS,
} from './history-client';

const BASE = 'http://boat';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHistoryProviders', () => {
  it('orders the default provider first', async () => {
    stubFetch({
      ok: true,
      body: { kip: { isDefault: false }, 'signalk-questdb': { isDefault: true } },
    });
    await expect(fetchHistoryProviders(BASE, 'tok')).resolves.toEqual({
      ids: ['signalk-questdb', 'kip'],
    });
  });

  it('reports no providers as an empty list and an absent API as undefined', async () => {
    stubFetch({ ok: true, body: {} });
    await expect(fetchHistoryProviders(BASE)).resolves.toEqual({ ids: [] });
    stubFetch({ ok: false, status: 404 });
    await expect(fetchHistoryProviders(BASE)).resolves.toBeUndefined();
  });

  it('bounds the registered provider list', async () => {
    stubFetch({
      ok: true,
      body: Object.fromEntries(
        Array.from({ length: MAX_HISTORY_PROVIDERS + 3 }, (_, i) => [`provider-${i}`, {}]),
      ),
    });
    const providers = await fetchHistoryProviders(BASE);
    expect(providers?.ids).toHaveLength(MAX_HISTORY_PROVIDERS);
  });
});

describe('fetchHistoryValues', () => {
  it('parses the columnar response and keeps only well-shaped rows', async () => {
    const mock = stubFetch({
      ok: true,
      body: {
        context: 'vessels.self',
        range: { from: '2026-06-11T00:00:00Z', to: '2026-06-12T00:00:00Z' },
        values: [{ path: 'environment.depth.belowTransducer', method: 'average' }],
        data: [
          ['2026-06-11T00:00:00Z', 4.2],
          ['2026-06-11T00:05:00Z', null],
          ['bad row'],
          'not a row',
        ],
      },
    });
    const got = await fetchHistoryValues(BASE, 'tok', {
      paths: ['environment.depth.belowTransducer'],
      durationSeconds: 86400,
      resolutionSeconds: 300,
    });
    expect(got?.columns).toEqual([
      { path: 'environment.depth.belowTransducer', method: 'average' },
    ]);
    expect(got?.rows).toEqual([
      ['2026-06-11T00:00:00Z', 4.2],
      ['2026-06-11T00:05:00Z', null],
    ]);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain('/signalk/v2/api/history/values?');
    expect(url).toContain('duration=86400');
    expect(url).toContain('resolution=300');
  });

  it('returns undefined on a 501 no-provider answer or a transport failure', async () => {
    stubFetch({ ok: false, status: 501 });
    await expect(
      fetchHistoryValues(BASE, undefined, { paths: ['a'], durationSeconds: 60 }),
    ).resolves.toBeUndefined();
    stubFetch('reject');
    await expect(
      fetchHistoryValues(BASE, undefined, { paths: ['a'], durationSeconds: 60 }),
    ).resolves.toBeUndefined();
  });
});

describe('fetchHistoryPaths', () => {
  it('parses, deduplicates, and sorts a provider path catalog', async () => {
    const mock = stubFetch({
      ok: true,
      body: [
        'propulsion.port.revolutions',
        'electrical.batteries.house.voltage',
        'propulsion.port.revolutions',
      ],
    });
    await expect(
      fetchHistoryPaths(BASE, 'tok', {
        durationSeconds: 31_536_000,
        provider: 'signalk-questdb',
      }),
    ).resolves.toEqual(['electrical.batteries.house.voltage', 'propulsion.port.revolutions']);
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toContain('/signalk/v2/api/history/paths?');
    expect(String(url)).toContain('duration=31536000');
    expect(String(url)).toContain('provider=signalk-questdb');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
  });

  it('rejects a malformed path catalog', async () => {
    stubFetch({ ok: true, body: ['navigation.speedOverGround', 42] });
    await expect(
      fetchHistoryPaths(BASE, undefined, { durationSeconds: 60 }),
    ).resolves.toBeUndefined();
  });

  it('bounds catalog size and drops overlong paths', async () => {
    const paths = Array.from(
      { length: MAX_HISTORY_CATALOG_PATHS + 10 },
      (_, i) => `propulsion.engine${i}.revolutions`,
    );
    paths[0] = `propulsion.${'x'.repeat(600)}.revolutions`;
    stubFetch({ ok: true, body: paths });
    const result = await fetchHistoryPaths(BASE, undefined, { durationSeconds: 60 });
    expect(result).toHaveLength(MAX_HISTORY_CATALOG_PATHS - 1);
  });
});

describe('fetchHistoryProviderPathCatalogs', () => {
  it('preserves provider ownership and reports a partial failure', async () => {
    const mock = vi.fn(async (url: string) => {
      if (url.includes('provider=kip')) {
        return jsonResponse(501, {});
      }
      return jsonResponse(200, ['propulsion.port.revolutions']);
    });
    vi.stubGlobal('fetch', mock);
    await expect(
      fetchHistoryProviderPathCatalogs(
        BASE,
        undefined,
        { ids: ['kip', 'signalk-questdb'] },
        { durationSeconds: 60 },
      ),
    ).resolves.toEqual({
      catalogs: [{ provider: 'signalk-questdb', paths: ['propulsion.port.revolutions'] }],
      complete: false,
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchPopulatedHistoryPathsForProvider', () => {
  it('keeps only paths populated in the default vessels.self context', async () => {
    const mock = stubFetch({
      ok: true,
      body: {
        range: {},
        values: [{ path: 'propulsion.other.revolutions' }, { path: 'propulsion.self.revolutions' }],
        data: [['2026-07-01T00:00:00Z', null, 20]],
      },
    });
    await expect(
      fetchPopulatedHistoryPathsForProvider(
        BASE,
        undefined,
        'signalk-questdb',
        ['propulsion.other.revolutions', 'propulsion.self.revolutions'],
        3600,
      ),
    ).resolves.toEqual({
      paths: ['propulsion.self.revolutions'],
      complete: true,
      answered: true,
    });
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain('resolution=3600');
    expect(url).not.toContain('context=');
  });

  it('retains valid intersections but marks missing and duplicate columns incomplete', async () => {
    stubFetch({
      ok: true,
      body: {
        range: {},
        values: [
          { path: 'propulsion.port.revolutions' },
          { path: 'propulsion.port.revolutions' },
          { path: 'propulsion.starboard.revolutions' },
        ],
        data: [['2026-07-01T00:00:00Z', 20, 21, 22]],
      },
    });
    await expect(
      fetchPopulatedHistoryPathsForProvider(
        BASE,
        undefined,
        'signalk-questdb',
        [
          'propulsion.port.revolutions',
          'propulsion.starboard.revolutions',
          'propulsion.aux.revolutions',
        ],
        3600,
      ),
    ).resolves.toEqual({
      paths: ['propulsion.starboard.revolutions'],
      complete: false,
      answered: true,
    });
  });
});

describe('fetchHistoryValuesAcrossProviders', () => {
  it('falls past an empty default provider to one that has rows', async () => {
    const mock = vi.fn(async (url: string) => {
      const empty = String(url).includes('provider=kip');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          range: {},
          values: [{ path: 'p', method: 'average' }],
          data: empty ? [] : [['2026-06-12T00:00:00Z', 1]],
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', mock);
    const got = await fetchHistoryValuesAcrossProviders(
      BASE,
      undefined,
      { ids: ['kip', 'qdb'] },
      {
        paths: ['p'],
        durationSeconds: 60,
      },
    );
    expect(got?.provider).toBe('qdb');
    expect(got?.values.rows).toHaveLength(1);
  });

  it('issues one provider-less query when the provider list is empty', async () => {
    const mock = stubFetch({
      ok: true,
      body: {
        range: {},
        values: [{ path: 'p', method: 'average' }],
        data: [['2026-06-12T00:00:00Z', 1]],
      },
    });
    const got = await fetchHistoryValuesAcrossProviders(
      BASE,
      undefined,
      { ids: [] },
      { paths: ['p'], durationSeconds: 60 },
    );
    expect(got?.provider).toBeUndefined();
    expect(got?.values.rows).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(String(mock.mock.calls[0][0])).not.toContain('provider=');
  });

  it('resolves undefined when every provider fails to answer', async () => {
    const mock = stubFetch({ ok: false, status: 501 });
    await expect(
      fetchHistoryValuesAcrossProviders(
        BASE,
        undefined,
        { ids: ['kip', 'qdb'] },
        { paths: ['p'], durationSeconds: 60 },
      ),
    ).resolves.toBeUndefined();
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
