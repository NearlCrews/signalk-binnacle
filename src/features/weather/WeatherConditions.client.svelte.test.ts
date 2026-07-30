import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import { WeatherStore } from '$entities/weather';
import type { PointConditionsLoader, ProviderPoint } from './point-conditions';
import WeatherConditions from './WeatherConditions.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
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
