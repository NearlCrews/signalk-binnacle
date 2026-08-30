import { describe, expect, it, vi } from 'vitest';
import { createExpiringStore } from '$shared/storage';
import {
  createPointConditionsLoader,
  type ProviderPoint,
  pointConditionsKey,
} from './point-conditions';
import type { EndpointOutcome, SignalKWeatherData, WeatherWarning } from './signalk-weather';

const OBS: SignalKWeatherData = {
  date: '2026-06-11T12:00:00Z',
  wind: { speedTrue: 5, directionTrue: 1 },
};
const SERIES: SignalKWeatherData[] = [
  { date: '2026-06-11T15:00:00Z', wind: { speedTrue: 7, directionTrue: 1.2 } },
];
const WARNING: WeatherWarning = {
  startTime: '2026-06-11T00:00:00Z',
  endTime: '2026-06-12T00:00:00Z',
  details: 'Gale warning in effect',
  source: 'NWS',
  type: 'Gale',
};

const NWS_WARNING: WeatherWarning = {
  startTime: '2026-06-11T00:00:00Z',
  endTime: '2026-06-12T00:00:00Z',
  details: 'Gale Warning issued for coastal waters',
  source: 'NWS',
  type: 'Gale Warning',
};

const success = <T>(value: T): EndpointOutcome<T> => ({ status: 'success', value });

function makeDeps(nowRef: { ms: number }) {
  return {
    observations: vi.fn(async () => success(OBS)),
    forecasts: vi.fn(async () => success(SERIES)),
    warnings: vi.fn(async () => success([WARNING])),
    // Out of NWS coverage by default, so the fallback stays inert unless a test arms it.
    nwsAlerts: vi.fn(async () => ({ status: 'unsupported' }) as const),
    now: () => nowRef.ms,
    persist: createExpiringStore<ProviderPoint>('test', { factory: undefined }),
  };
}

function failureDeps(nowRef: { ms: number }) {
  return {
    ...makeDeps(nowRef),
    observations: vi.fn(async () => ({ status: 'failure' }) as const),
    forecasts: vi.fn(async () => ({ status: 'failure' }) as const),
    warnings: vi.fn(async () => ({ status: 'failure' }) as const),
  };
}

function cachedPoint(requestKey: string, nowMs: number): ProviderPoint {
  return {
    requestKey,
    fetchedAt: nowMs,
    obs: OBS,
    series: SERIES,
    warnings: [WARNING],
    observationsState: { status: 'success', fetchedAt: nowMs, stale: false },
    forecastsState: { status: 'success', fetchedAt: nowMs, stale: false },
    warningsState: { status: 'success', fetchedAt: nowMs, stale: false },
    observationStatus: 'success',
    forecastStatus: 'success',
    warningAvailability: 'fresh',
    warningsFetchedAt: nowMs,
  };
}

describe('pointConditionsKey', () => {
  it('uses 0.001-degree precision consistently', () => {
    expect(pointConditionsKey('provider-id', 27.7104, -82.6904)).toBe('provider-id:27.710,-82.690');
    expect(pointConditionsKey('provider-id', 27.7104, -82.6904)).toBe(
      pointConditionsKey('provider-id', 27.7103, -82.6903),
    );
    expect(pointConditionsKey('provider-id', 27.7104, -82.6904)).not.toBe(
      pointConditionsKey('provider-id', 27.712, -82.69),
    );
  });

  it('keys by provider id, not display name', () => {
    expect(pointConditionsKey('provider-a', 1, 2)).not.toBe(pointConditionsKey('provider-b', 1, 2));
  });
});

describe('createPointConditionsLoader', () => {
  it('passes the provider id to every endpoint and tracks successful outcomes', async () => {
    const nowRef = { ms: 50_000 };
    const deps = makeDeps(nowRef);
    const loader = createPointConditionsLoader(deps);
    const point = await loader.load('http://pi', 'provider-id', 27.7, -82.7, 'token');

    expect(deps.observations).toHaveBeenCalledWith(
      'http://pi',
      'provider-id',
      27.7,
      -82.7,
      'token',
    );
    expect(deps.forecasts).toHaveBeenCalledWith(
      'http://pi',
      'provider-id',
      27.7,
      -82.7,
      12,
      'token',
    );
    expect(point).toMatchObject({
      obs: OBS,
      series: SERIES,
      warnings: [WARNING],
      observationStatus: 'success',
      forecastStatus: 'success',
      warningAvailability: 'fresh',
      warningsFetchedAt: 50_000,
    });
  });

  it('coalesces concurrent loads for the same provider and point', async () => {
    const deps = makeDeps({ ms: 50_000 });
    const loader = createPointConditionsLoader(deps);
    const [first, second, warnings] = await Promise.all([
      loader.load('http://pi', 'provider-id', 27.7, -82.7),
      loader.load('http://pi', 'provider-id', 27.7, -82.7),
      loader.loadWarnings('http://pi', 'provider-id', 27.7, -82.7),
    ]);

    expect(second).toBe(first);
    expect(warnings.warnings).toEqual(first.warnings);
    expect(deps.observations).toHaveBeenCalledTimes(1);
    expect(deps.forecasts).toHaveBeenCalledTimes(1);
    expect(deps.warnings).toHaveBeenCalledTimes(1);
  });

  it('preserves each cached endpoint only on a same-key transient failure', async () => {
    const nowRef = { ms: 50_000 };
    const persist = createExpiringStore<ProviderPoint>('shared', { factory: undefined });
    await createPointConditionsLoader({ ...makeDeps(nowRef), persist }).load(
      'http://pi',
      'provider-id',
      27.7,
      -82.7,
    );
    nowRef.ms += 30 * 60_000;

    const point = await createPointConditionsLoader({ ...failureDeps(nowRef), persist }).load(
      'http://pi',
      'provider-id',
      27.7,
      -82.7,
    );
    expect(point.obs).toEqual(OBS);
    expect(point.series).toEqual(SERIES);
    expect(point.warnings).toEqual([WARNING]);
    expect(point.observationsState).toMatchObject({ status: 'failure', stale: true });
    expect(point.warningAvailability).toBe('stale');

    const otherProvider = await createPointConditionsLoader({
      ...failureDeps(nowRef),
      persist,
    }).load('http://pi', 'other-provider', 27.7, -82.7);
    expect(otherProvider.obs).toBeUndefined();
    expect(otherProvider.warnings).toBeUndefined();
  });

  it('normalizes duplicate identities while promoting cached provider data', async () => {
    const nowRef = { ms: 50_000 };
    const persist = createExpiringStore<ProviderPoint>('shared', { factory: undefined });
    const seeded = makeDeps(nowRef);
    seeded.forecasts.mockResolvedValueOnce(success([SERIES[0], { ...SERIES[0] }]));
    seeded.warnings.mockResolvedValueOnce(success([WARNING, { ...WARNING }]));
    await createPointConditionsLoader({ ...seeded, persist }).load(
      'http://pi',
      'provider-id',
      27.7,
      -82.7,
    );
    nowRef.ms += 30 * 60_000;

    const point = await createPointConditionsLoader({ ...failureDeps(nowRef), persist }).load(
      'http://pi',
      'provider-id',
      27.7,
      -82.7,
    );

    expect(point.series).toEqual(SERIES);
    expect(point.warnings).toEqual([WARNING]);
  });

  it.each([
    ['an invalid observation', { obs: { date: OBS.date, wind: { speedTrue: 'not-a-number' } } }],
    ['a non-array forecast collection', { series: SERIES[0] }],
    ['an invalid forecast entry', { series: [...SERIES, { date: 'not-a-date' }] }],
    [
      'an oversized forecast collection',
      {
        series: Array.from({ length: 13 }, (_, index) => ({
          date: `2026-06-11T${String(index).padStart(2, '0')}:00:00Z`,
        })),
      },
    ],
    ['a non-array warning collection', { warnings: WARNING }],
    ['an invalid warning entry', { warnings: [WARNING, { ...WARNING, endTime: 'not-a-date' }] }],
    [
      'an oversized warning collection',
      { warnings: Array.from({ length: 65 }, () => ({ ...WARNING })) },
    ],
    ['an older incomplete envelope', { warningsState: undefined }],
  ])('discards cached provider data with %s', async (_label, corruption) => {
    const nowRef = { ms: 50_000 };
    const requestKey = pointConditionsKey('provider-id', 27.7, -82.7);
    const persist = createExpiringStore<ProviderPoint>('corrupt', { factory: undefined });
    await persist.put(
      requestKey,
      { ...cachedPoint(requestKey, nowRef.ms), ...corruption } as unknown as ProviderPoint,
      nowRef.ms + 30 * 60_000,
    );

    const point = await createPointConditionsLoader({ ...failureDeps(nowRef), persist }).load(
      'http://pi',
      'provider-id',
      27.7,
      -82.7,
    );

    expect(point.obs).toBeUndefined();
    expect(point.series).toBeUndefined();
    expect(point.warnings).toBeUndefined();
  });

  it.each(['empty', 'unsupported'] as const)(
    'does not replay cached data for a definitive %s outcome',
    async (status) => {
      const nowRef = { ms: 0 };
      const persist = createExpiringStore<ProviderPoint>('shared', { factory: undefined });
      await createPointConditionsLoader({ ...makeDeps(nowRef), persist }).load(
        'http://pi',
        'provider-id',
        1,
        2,
      );
      const loader = createPointConditionsLoader({
        ...makeDeps(nowRef),
        observations: vi.fn(async () => ({ status }) as const),
        forecasts: vi.fn(async () => ({ status }) as const),
        warnings: vi.fn(async () => ({ status }) as const),
        persist,
      });
      const point = await loader.load('http://pi', 'provider-id', 1, 2);
      expect(point.obs).toBeUndefined();
      expect(point.series).toBeUndefined();
      expect(point.warnings).toEqual(status === 'empty' ? [] : undefined);
      expect(point.warningAvailability).toBe(status === 'empty' ? 'fresh' : 'unavailable');
    },
  );

  it('does not replay data after the cache age bound', async () => {
    const nowRef = { ms: 0 };
    const persist = createExpiringStore<ProviderPoint>('shared', { factory: undefined });
    await createPointConditionsLoader({ ...makeDeps(nowRef), persist }).load(
      'http://pi',
      'provider-id',
      1,
      2,
    );
    nowRef.ms += 61 * 60_000;
    const point = await createPointConditionsLoader({ ...failureDeps(nowRef), persist }).load(
      'http://pi',
      'provider-id',
      1,
      2,
    );
    expect(point.obs).toBeUndefined();
    expect(point.series).toBeUndefined();
  });

  it('refreshes warnings independently and keeps same-key cached warnings on failure', async () => {
    const nowRef = { ms: 0 };
    const deps = makeDeps(nowRef);
    const loader = createPointConditionsLoader(deps);
    await loader.load('http://pi', 'provider-id', 1, 2);
    nowRef.ms = 10 * 60_000;
    deps.warnings.mockResolvedValueOnce({ status: 'failure' });

    const warningPoint = await loader.loadWarnings('http://pi', 'provider-id', 1, 2);
    expect(warningPoint).toMatchObject({
      requestKey: pointConditionsKey('provider-id', 1, 2),
      warnings: [WARNING],
      warningAvailability: 'stale',
      warningsFetchedAt: 0,
    });
    expect(deps.observations).toHaveBeenCalledTimes(1);
    expect(deps.forecasts).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable, not stale, when a refresh fails over a cached empty warning list', async () => {
    const nowRef = { ms: 0 };
    const deps = makeDeps(nowRef);
    deps.warnings.mockResolvedValueOnce({ status: 'empty' });
    const loader = createPointConditionsLoader(deps);
    const first = await loader.load('http://pi', 'provider-id', 1, 2);
    expect(first.warnings).toEqual([]);
    expect(first.warningAvailability).toBe('fresh');

    nowRef.ms = 10 * 60_000;
    deps.warnings.mockResolvedValueOnce({ status: 'failure' });
    const warningPoint = await loader.loadWarnings('http://pi', 'provider-id', 1, 2);
    expect(warningPoint.warnings).toEqual([]);
    expect(warningPoint.warningAvailability).toBe('unavailable');
  });
});

describe('NWS point-alert fallback', () => {
  it('keys the providerless cache apart from every provider key', () => {
    expect(pointConditionsKey(undefined, 1, 2)).toBe('nws@1.000,2.000');
    expect(pointConditionsKey(undefined, 1, 2)).not.toBe(pointConditionsKey('nws', 1, 2));
  });

  it('serves providerless warnings from NWS without touching the provider endpoint', async () => {
    const deps = {
      ...makeDeps({ ms: 1_000 }),
      nwsAlerts: vi.fn(async () => success([NWS_WARNING])),
    };
    const loader = createPointConditionsLoader(deps);

    const point = await loader.loadWarnings('http://pi', undefined, 27.7, -82.7, 'token');

    expect(point).toMatchObject({
      requestKey: 'nws@27.700,-82.700',
      warnings: [NWS_WARNING],
      warningAvailability: 'fresh',
      warningsFetchedAt: 1_000,
    });
    expect(deps.nwsAlerts).toHaveBeenCalledWith(27.7, -82.7);
    expect(deps.warnings).not.toHaveBeenCalled();
  });

  it('replays persisted providerless warnings as stale when the next NWS fetch fails', async () => {
    const nowRef = { ms: 0 };
    const persist = createExpiringStore<ProviderPoint>('nws', { factory: undefined });
    const seeded = {
      ...makeDeps(nowRef),
      nwsAlerts: vi.fn(async () => success([NWS_WARNING])),
      persist,
    };
    await createPointConditionsLoader(seeded).loadWarnings('http://pi', undefined, 1, 2);
    nowRef.ms = 30 * 60_000;

    const failing = {
      ...makeDeps(nowRef),
      nwsAlerts: vi.fn(async () => ({ status: 'failure' }) as const),
      persist,
    };
    const point = await createPointConditionsLoader(failing).loadWarnings(
      'http://pi',
      undefined,
      1,
      2,
    );

    expect(point).toMatchObject({
      warnings: [NWS_WARNING],
      warningAvailability: 'stale',
      warningsFetchedAt: 0,
    });
  });

  it('falls back to NWS on a full load when the provider warnings endpoint is unsupported', async () => {
    const deps = {
      ...makeDeps({ ms: 0 }),
      warnings: vi.fn(async () => ({ status: 'unsupported' }) as const),
      nwsAlerts: vi.fn(async () => success([NWS_WARNING])),
    };
    const point = await createPointConditionsLoader(deps).load('http://pi', 'provider-id', 1, 2);

    expect(point.warnings).toEqual([NWS_WARNING]);
    expect(point.warningAvailability).toBe('fresh');
    expect(point.obs).toEqual(OBS);
  });

  it('reports an out-of-coverage providerless point as unavailable, never as an all-clear', async () => {
    const deps = makeDeps({ ms: 0 });
    const point = await createPointConditionsLoader(deps).loadWarnings(
      'http://pi',
      undefined,
      48.85,
      2.35,
    );

    expect(point.warnings).toBeUndefined();
    expect(point.warningAvailability).toBe('unavailable');
  });

  it('does not consult NWS when the provider answers its own warnings', async () => {
    const deps = makeDeps({ ms: 0 });
    const loader = createPointConditionsLoader(deps);
    await loader.load('http://pi', 'provider-id', 1, 2);
    deps.warnings.mockResolvedValueOnce({ status: 'failure' });
    await loader.loadWarnings('http://pi', 'provider-id', 1, 2);

    expect(deps.nwsAlerts).not.toHaveBeenCalled();
  });
});
