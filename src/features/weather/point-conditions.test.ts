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

const success = <T>(value: T): EndpointOutcome<T> => ({ status: 'success', value });

function makeDeps(nowRef: { ms: number }) {
  return {
    observations: vi.fn(async () => success(OBS)),
    forecasts: vi.fn(async () => success(SERIES)),
    warnings: vi.fn(async () => success([WARNING])),
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
});
