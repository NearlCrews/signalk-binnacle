import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import { WeatherStore } from '$entities/weather';
import { METRIC_UNITS } from '$shared/lib';
import type { PointConditionsLoader, ProviderPoint } from './point-conditions';
import WeatherConditions from './WeatherConditions.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  vi.useRealTimers();
});

describe('WeatherConditions recovery', () => {
  function point(failed: boolean): ProviderPoint {
    const now = Date.now();
    const state = {
      status: failed ? ('failure' as const) : ('empty' as const),
      fetchedAt: now,
      stale: failed,
    };
    return {
      requestKey: 'provider:1.000,2.000',
      fetchedAt: now,
      observationsState: state,
      forecastsState: state,
      warningsState: state,
      observationStatus: state.status,
      forecastStatus: state.status,
      warningAvailability: 'fresh',
      warningsFetchedAt: now,
    };
  }

  function setup(failed = true, initial?: ProviderPoint, store = new WeatherStore()) {
    const state = $state({ token: 'first' });
    const load = vi.fn<PointConditionsLoader['load']>().mockResolvedValue(initial ?? point(failed));
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(WeatherConditions, {
      target,
      props: {
        origin: 'http://boat.local',
        get token() {
          return state.token;
        },
        providerId: 'provider',
        position: { latitude: 1, longitude: 2 },
        store,
        units: { mode: 'metric', profile: METRIC_UNITS } as UnitsStore,
        pointLoader: { load, loadWarnings: async () => point(false) },
      },
    });
    flushSync();
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });
    return { state, load, target };
  }

  it('offers Retry for ordinary resolved endpoint failures', async () => {
    const test = setup();
    await vi.waitFor(() =>
      expect(test.target.textContent).toContain(
        'Weather observations and forecasts could not refresh',
      ),
    );
    const retry = [...test.target.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Retry',
    );
    if (!retry) throw new Error('Missing retry');
    test.load.mockResolvedValue(point(false));
    retry.click();
    await vi.waitFor(() => expect(test.load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(test.target.textContent).not.toContain('could not refresh'));
  });

  it('retries after an auth token change at the same stationary position', async () => {
    const test = setup();
    await vi.waitFor(() => expect(test.load).toHaveBeenCalledOnce());
    test.state.token = 'approved';
    flushSync();
    await vi.waitFor(() => expect(test.load).toHaveBeenCalledTimes(2));
    expect(test.load.mock.calls[1]?.[4]).toBe('approved');
  });

  it('retains accepted observations when a later partial refresh fails', async () => {
    const initial = point(false);
    initial.obs = { date: new Date().toISOString(), wind: { speedTrue: 12 } };
    initial.observationStatus = 'success';
    const test = setup(false, initial);
    await vi.waitFor(() => expect(test.target.textContent).toContain('Observed'));
    const failed = point(true);
    failed.forecastStatus = 'empty';
    test.load.mockResolvedValue(failed);
    test.state.token = 'approved';
    flushSync();
    await vi.waitFor(() => expect(test.target.textContent).toContain('cached, refresh failed'));
    expect(test.target.textContent).toContain('Weather observations could not refresh');
    expect(test.target.textContent).not.toContain('Weather forecasts could not refresh');
  });

  it('keeps a pressure observation separate from model wind and its valid time', async () => {
    const now = Date.now();
    const initial = point(false);
    initial.obs = { date: new Date(now).toISOString(), outside: { pressure: 101_200 } };
    initial.observationStatus = 'success';
    const store = new WeatherStore();
    store.setGrid(
      {
        lats: [0, 2],
        lons: [1, 3],
        times: [now],
        windU: [[5, 5, 5, 5]],
        windV: [[0, 0, 0, 0]],
        pressureMsl: [[101_000, 101_000, 101_000, 101_000]],
      },
      now,
    );
    const test = setup(false, initial, store);
    await vi.waitFor(() =>
      expect(test.target.textContent).toContain('Model forecast, not observed'),
    );
    const blocks = [...test.target.querySelectorAll('.cond-when')];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toContain('Observed');
    expect(blocks[0].nextElementSibling?.textContent).not.toContain('Wind');
    expect(blocks[1].textContent).toContain('Forecast');
    expect(blocks[1].textContent).toContain('Open-Meteo');
    expect(blocks[1].nextElementSibling?.textContent).toContain('Wind');
  });

  it('paces periodic and focus refresh instead of refetching every clock tick', async () => {
    vi.useFakeTimers();
    const test = setup(false);
    await vi.waitFor(() => expect(test.load).toHaveBeenCalledOnce());
    for (let index = 0; index < 5; index += 1) window.dispatchEvent(new Event('focus'));
    expect(test.load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    flushSync();
    await vi.waitFor(() => expect(test.load).toHaveBeenCalledTimes(2));
    window.dispatchEvent(new Event('focus'));
    expect(test.load).toHaveBeenCalledTimes(2);
  });
});

describe('WeatherConditions warning identities', () => {
  it('mounts distinct warnings that share a start time and type', async () => {
    const now = Date.now();
    const warning = {
      startTime: new Date(now - 60_000).toISOString(),
      endTime: new Date(now + 60 * 60_000).toISOString(),
      details: 'Gale conditions',
      source: 'Provider A',
      type: 'Gale',
    };
    const point: ProviderPoint = {
      requestKey: 'provider:1.000,2.000',
      fetchedAt: now,
      warnings: [warning, { ...warning, source: 'Provider B' }],
      observationsState: { status: 'empty', fetchedAt: now, stale: false },
      forecastsState: { status: 'empty', fetchedAt: now, stale: false },
      warningsState: { status: 'success', fetchedAt: now, stale: false },
      observationStatus: 'empty',
      forecastStatus: 'empty',
      warningAvailability: 'fresh',
      warningsFetchedAt: now,
    };
    const pointLoader: PointConditionsLoader = {
      load: vi.fn(async () => point),
      loadWarnings: vi.fn(async () => ({
        requestKey: point.requestKey,
        warnings: point.warnings,
        warningAvailability: point.warningAvailability,
        warningsFetchedAt: point.warningsFetchedAt,
      })),
    };
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(WeatherConditions, {
        target,
        props: {
          origin: 'http://boat.local',
          providerId: 'provider',
          providerName: 'Provider',
          position: { latitude: 1, longitude: 2 },
          store: new WeatherStore(),
          units: { mode: 'metric' } as UnitsStore,
          pointLoader,
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    await vi.waitFor(() => expect(target.querySelectorAll('.warning')).toHaveLength(2));
    expect(target.textContent).toContain('Provider A');
    expect(target.textContent).toContain('Provider B');
  });

  it('clears loading and offers a working retry when the current load rejects', async () => {
    const now = Date.now();
    const point: ProviderPoint = {
      requestKey: 'provider:1.000,2.000',
      fetchedAt: now,
      observationsState: { status: 'empty', fetchedAt: now, stale: false },
      forecastsState: { status: 'empty', fetchedAt: now, stale: false },
      warningsState: { status: 'empty', fetchedAt: now, stale: false },
      observationStatus: 'empty',
      forecastStatus: 'empty',
      warningAvailability: 'fresh',
      warningsFetchedAt: now,
    };
    const load = vi
      .fn<PointConditionsLoader['load']>()
      .mockRejectedValueOnce(new Error('cache unavailable'))
      .mockResolvedValueOnce(point);
    const pointLoader: PointConditionsLoader = {
      load,
      loadWarnings: vi.fn(async () => ({
        requestKey: point.requestKey,
        warningAvailability: 'fresh' as const,
        warningsFetchedAt: now,
      })),
    };
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(WeatherConditions, {
        target,
        props: {
          origin: 'http://boat.local',
          providerId: 'provider',
          providerName: 'Provider',
          position: { latitude: 1, longitude: 2 },
          store: new WeatherStore(),
          units: { mode: 'metric' } as UnitsStore,
          pointLoader,
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
    expect(target.textContent).not.toContain('Loading conditions.');
    const retry = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Retry',
    );
    if (!retry) throw new Error('expected retry button');
    retry.click();

    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).toBeNull());
  });
});
