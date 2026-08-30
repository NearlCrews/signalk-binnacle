import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatedAlarm } from '$shared/audio';
import { WARNING_REFRESH_MS } from './point-conditions';
import type { WeatherWarning } from './signalk-weather';
import { createWeatherWarningsWatch } from './warnings-watch.svelte';

const NOW = Date.parse('2026-08-29T12:00:00Z');

function warning(type: string, hoursFromNow = -1, hoursActive = 6): WeatherWarning {
  return {
    startTime: new Date(NOW + hoursFromNow * 3_600_000).toISOString(),
    endTime: new Date(NOW + (hoursFromNow + hoursActive) * 3_600_000).toISOString(),
    details: `${type} details`,
    source: 'NWS',
    type,
  };
}

function setup(options: { warnings?: WeatherWarning[]; pluginAlertActive?: boolean } = {}) {
  const state = $state({
    now: NOW,
    provider: { id: 'accuweather', name: 'AccuWeather' } as
      | { id: string; name: string }
      | undefined,
    position: { latitude: 42.35, longitude: -71.05 } as
      | { latitude: number; longitude: number }
      | undefined,
    pluginAlertActive: options.pluginAlertActive ?? false,
  });
  const loadWarnings = vi.fn().mockResolvedValue({
    requestKey: 'k',
    warnings: options.warnings ?? [],
    warningAvailability: 'fresh' as const,
    warningsFetchedAt: NOW,
  });
  const alarm = { update: vi.fn(), restart: vi.fn(), stop: vi.fn() };
  const announce = vi.fn();
  let watch!: ReturnType<typeof createWeatherWarningsWatch>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      watch = createWeatherWarningsWatch({
        origin: 'http://sk',
        token: () => 'tok',
        provider: () => state.provider,
        position: () => state.position,
        loader: { loadWarnings },
        clock: state,
        alarm: alarm as unknown as GatedAlarm,
        pluginAlertActive: () => state.pluginAlertActive,
        announce,
      });
    });
  });
  const cleanup = () => {
    watch.dispose();
    disposeRoot();
  };
  cleanups.push(cleanup);
  return { state, loadWarnings, alarm, announce, watch };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('createWeatherWarningsWatch', () => {
  it('announces and chirps a warning already in effect on the first poll', async () => {
    const test = setup({ warnings: [warning('Gale Warning')] });
    await vi.waitFor(() => expect(test.announce).toHaveBeenCalledOnce());
    expect(test.announce.mock.calls[0][0]).toContain('Gale Warning');
    expect(test.alarm.update).toHaveBeenCalledWith(true);
    expect(test.watch.headline).toBe('Gale Warning');
    expect(test.loadWarnings).toHaveBeenCalledWith(
      'http://sk',
      'accuweather',
      42.35,
      -71.05,
      'tok',
    );
  });

  it('does not re-announce a known warning, and announces a newly active one', async () => {
    const test = setup({ warnings: [warning('Gale Warning')] });
    await vi.waitFor(() => expect(test.announce).toHaveBeenCalledOnce());

    // Same list at the next cadence tick: no second announcement.
    test.state.now += WARNING_REFRESH_MS;
    flushSync();
    await vi.waitFor(() => expect(test.loadWarnings).toHaveBeenCalledTimes(2));
    expect(test.announce).toHaveBeenCalledOnce();

    // A new warning joins: exactly one more announcement, for the fresh one.
    test.loadWarnings.mockResolvedValue({
      requestKey: 'k',
      warnings: [warning('Gale Warning'), warning('Storm Warning', 0)],
      warningAvailability: 'fresh' as const,
      warningsFetchedAt: NOW,
    });
    test.state.now += WARNING_REFRESH_MS;
    flushSync();
    await vi.waitFor(() => expect(test.announce).toHaveBeenCalledTimes(2));
    expect(test.announce.mock.calls[1][0]).toContain('Storm Warning');
    // The severity sort puts the storm first for the chip.
    expect(test.watch.headline).toBe('Storm Warning');
  });

  it('stands down to the chip while a plugin weather notification is active', async () => {
    const test = setup({ warnings: [warning('Gale Warning')], pluginAlertActive: true });
    await vi.waitFor(() => expect(test.watch.headline).toBe('Gale Warning'));
    expect(test.announce).not.toHaveBeenCalled();
    expect(test.alarm.update).not.toHaveBeenCalled();
  });

  it('ignores expired warnings and polls nothing without a provider', async () => {
    const expired = setup({ warnings: [warning('Gale Warning', -10, 2)] });
    await vi.waitFor(() => expect(expired.loadWarnings).toHaveBeenCalledOnce());
    expect(expired.watch.headline).toBeUndefined();
    expect(expired.announce).not.toHaveBeenCalled();

    const absent = setup();
    absent.state.provider = undefined;
    flushSync();
    absent.state.now += WARNING_REFRESH_MS;
    flushSync();
    expect(absent.loadWarnings).toHaveBeenCalledTimes(1);
  });
});
