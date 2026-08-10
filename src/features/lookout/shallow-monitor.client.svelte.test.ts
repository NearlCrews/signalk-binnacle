import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitsStore } from '$entities/units';
import type { DepthReading } from '$entities/vessel';
import type { UnitsMode } from '$shared/lib';
import { DEFAULT_THRESHOLDS, PersistedValue, type Thresholds } from '$shared/settings';
import { RETRY_DELAY_MS } from '$shared/signalk';
import {
  createFakeAlarmControl,
  createFakeStorage,
  expectBearerAuth,
  jsonResponse,
} from '$shared/testing';
import { createShallowController } from './shallow-monitor.svelte';

const KEEL_PATH = 'environment.depth.belowKeel';
const TRANSDUCER_PATH = 'environment.depth.belowTransducer';

const reading = (overrides: Partial<DepthReading> = {}): DepthReading => ({
  meters: 10,
  source: 'keel',
  path: KEEL_PATH,
  stale: false,
  ...overrides,
});

// fetchPathMeta has several await hops before the cache is written.
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

interface Options {
  depth?: DepthReading;
  token?: string | undefined;
  mode?: UnitsMode;
  zones?: unknown;
  status?: number;
}

function harness(options: Options) {
  let depth = $state(options.depth ?? reading());
  const { control, events } = createFakeAlarmControl();
  const thresholds = new PersistedValue<Thresholds>(
    'binnacle:thresholds-test',
    { ...DEFAULT_THRESHOLDS },
    createFakeStorage(),
  );
  const units = new UnitsStore(
    new PersistedValue<UnitsMode>(
      'binnacle:units-test',
      options.mode ?? 'metric',
      createFakeStorage(),
    ),
  );
  const controller = createShallowController({
    getSafetyDepth: () => depth,
    thresholds,
    units,
    origin: 'http://sk',
    getToken: () => options.token,
    alarm: control,
  });
  return {
    controller,
    events,
    thresholds,
    setDepth(next: DepthReading) {
      depth = next;
      flushSync();
    },
  };
}

const cleanups: Array<() => void> = [];

function mount(options: Options = {}) {
  // Only the keel path carries zones, so a test can move the winning path to one the server has
  // nothing to say about.
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    options.zones !== undefined && url.includes('belowKeel/meta')
      ? jsonResponse(200, { zones: options.zones })
      : jsonResponse(options.status ?? 404, {}),
  );
  vi.stubGlobal('fetch', fetchMock);
  let test!: ReturnType<typeof harness>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      test = harness(options);
    });
  });
  cleanups.push(() => {
    test.controller.stop();
    disposeRoot();
  });
  return { ...test, fetchMock };
}

const metaCalls = (fetchMock: { mock: { calls: unknown[][] } }, path: string): string[] =>
  fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes(`${path.replaceAll('.', '/')}/meta`));

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
});

describe('createShallowController', () => {
  it('sounds while the depth reads under the local threshold and stops when it clears', async () => {
    const test = mount({ depth: reading({ meters: 10 }) });
    await flushPromises();
    expect(test.events).toEqual([]);
    expect(test.controller.alarming).toBe(false);

    test.setDepth(reading({ meters: 2 }));
    expect(test.events).toEqual(['start']);
    expect(test.controller.alarming).toBe(true);

    test.setDepth(reading({ meters: 6 }));
    expect(test.events).toEqual(['start', 'stop']);
  });

  it('fetches the zones of the winning depth path with the auth token, once per path', async () => {
    const test = mount({ token: 'tok-1', zones: [{ upper: 2, state: 'alarm' }] });
    await flushPromises();

    const calls = metaCalls(test.fetchMock, KEEL_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('http://sk/signalk/v1/api/vessels/self/environment/depth/belowKeel/meta');
    expectBearerAuth(test.fetchMock.mock.calls[0][1] as RequestInit, 'tok-1');

    // A new depth sample on the same path must not refetch near-static meta.
    test.setDepth(reading({ meters: 4 }));
    await flushPromises();
    expect(metaCalls(test.fetchMock, KEEL_PATH)).toHaveLength(1);
  });

  it('keeps the deeper local threshold when the server bound is shallower', async () => {
    // The skipper set 3 m (the default); the server's alarm band starts under 2 m. The deeper
    // bound governs: the server must never quietly loosen a limit the skipper set.
    const test = mount({ token: 'tok-1', zones: [{ upper: 2, state: 'alarm' }] });
    await flushPromises();
    flushSync();

    expect(test.controller.thresholdSource).toBe('local');
    expect(test.controller.serverLimitMeters).toBe(2);
    expect(test.controller.effectiveLimitMeters).toBe(DEFAULT_THRESHOLDS.shallowDepthMeters);
    expect(test.thresholds.value.shallowDepthMeters).toBe(DEFAULT_THRESHOLDS.shallowDepthMeters);

    test.setDepth(reading({ meters: 2.5 }));
    expect(test.controller.alarming).toBe(true);
    expect(test.events).toEqual(['start']);
  });

  it('lets a deeper server bound tighten the alarm and claims the path only while alarming', async () => {
    // The server's alarm band reaches 4 m, deeper than the 3 m local default, so it governs. The
    // notification-path claim exists only while this monitor is actually sounding: that is the
    // only moment a double tone is possible, and any divergence must reach the generic surface.
    const test = mount({ token: 'tok-1', zones: [{ upper: 4, state: 'alarm' }] });
    await flushPromises();
    flushSync();

    expect(test.controller.thresholdSource).toBe('server');
    expect(test.controller.serverLimitMeters).toBe(4);
    expect(test.controller.effectiveLimitMeters).toBe(4);
    expect(test.controller.ownedNotificationPath).toBeUndefined();

    test.setDepth(reading({ meters: 4.5 }));
    expect(test.controller.alarming).toBe(false);
    test.setDepth(reading({ meters: 3.5 }));
    expect(test.controller.alarming).toBe(true);
    expect(test.controller.ownedNotificationPath).toBe(`notifications.${KEEL_PATH}`);
  });

  it('releases the notification-path claim when the reading goes stale or unusable', async () => {
    // A monitor that cannot sound (stale sounder, or fresh null values after bottom-lock loss)
    // must hand the server's still-raised depth notification back to the generic surface instead
    // of keeping it silenced everywhere.
    const test = mount({ token: 'tok-1', zones: [{ upper: 4, state: 'alarm' }] });
    await flushPromises();
    flushSync();
    test.setDepth(reading({ meters: 3.5 }));
    expect(test.controller.ownedNotificationPath).toBe(`notifications.${KEEL_PATH}`);

    test.setDepth(reading({ meters: 3.5, stale: true }));
    expect(test.controller.alarming).toBe(false);
    expect(test.controller.ownedNotificationPath).toBeUndefined();
    expect(test.controller.monitorState).toBe('stale');

    test.setDepth(reading({ meters: undefined }));
    expect(test.controller.alarming).toBe(false);
    expect(test.controller.ownedNotificationPath).toBeUndefined();
    expect(test.controller.monitorState).toBe('no-reading');
    expect(test.controller.alert).toBe(
      'Depth reading unavailable. Shallow-water monitoring is paused.',
    );
  });

  it('resolves a multi-zone configuration to the alarm band, merged with the local bound', async () => {
    const test = mount({
      token: 'tok-1',
      zones: [
        { upper: 5, state: 'warn' },
        { upper: 2, state: 'alarm' },
      ],
    });
    await flushPromises();
    flushSync();

    // The warn band never sets the server bound; the 2 m alarm band does, and the deeper 3 m
    // local default remains the governing limit.
    expect(test.controller.serverLimitMeters).toBe(2);
    expect(test.controller.effectiveLimitMeters).toBe(DEFAULT_THRESHOLDS.shallowDepthMeters);
    test.setDepth(reading({ meters: 4 }));
    expect(test.controller.alarming).toBe(false);
    test.setDepth(reading({ meters: 1 }));
    expect(test.controller.alarming).toBe(true);
  });

  it('keeps the local threshold when the server has no zones or no alarm band', async () => {
    const noZones = mount({ token: 'tok-1' });
    await flushPromises();
    flushSync();
    expect(noZones.controller.thresholdSource).toBe('local');
    expect(noZones.controller.effectiveLimitMeters).toBe(DEFAULT_THRESHOLDS.shallowDepthMeters);

    // A warning-only zone set must not disarm the shallow alarm: nothing would ever sound.
    const warnOnly = mount({ token: 'tok-1', zones: [{ upper: 5, state: 'warn' }] });
    await flushPromises();
    flushSync();
    expect(warnOnly.controller.thresholdSource).toBe('local');
    warnOnly.setDepth(reading({ meters: 2 }));
    expect(warnOnly.controller.alarming).toBe(true);
  });

  it('resumes the local threshold when a path without zones wins', async () => {
    const test = mount({ token: 'tok-1', zones: [{ upper: 4, state: 'alarm' }] });
    await flushPromises();
    flushSync();
    expect(test.controller.thresholdSource).toBe('server');

    // The fake hands the controller a transducer-won reading directly. In the entity a resolved
    // winner never falls back down (epoch is monotonic); the reachable real transitions are a keel
    // path appearing and taking the win, or a restart without the keel source. Either way a
    // zoneless winner means the persisted local threshold takes over rather than leaving the boat
    // unmonitored, and the notification-path claim is released with it.
    test.setDepth(reading({ meters: 2.5, source: 'transducer', path: TRANSDUCER_PATH }));
    await flushPromises();
    flushSync();
    expect(test.controller.thresholdSource).toBe('local');
    expect(test.controller.effectiveLimitMeters).toBe(DEFAULT_THRESHOLDS.shallowDepthMeters);
    expect(test.controller.ownedNotificationPath).toBeUndefined();
    expect(test.controller.alarming).toBe(true);
  });

  it('reports the monitor state for a live, stale, and absent depth source', async () => {
    const test = mount();
    await flushPromises();
    expect(test.controller.monitorState).toBe('monitoring');

    test.setDepth(reading({ meters: 2, stale: true }));
    expect(test.controller.monitorState).toBe('stale');
    expect(test.controller.alarming).toBe(false);
    expect(test.controller.alert).toBe('Depth data lost. Shallow-water monitoring is unavailable.');

    test.setDepth(reading({ meters: undefined, source: undefined, path: TRANSDUCER_PATH }));
    expect(test.controller.monitorState).toBe('no-source');
    expect(test.controller.alert).toBe('');
  });

  it('never asks for zones when no depth source has published', async () => {
    const test = mount({
      token: 'tok-1',
      depth: reading({ meters: undefined, source: undefined, path: TRANSDUCER_PATH }),
    });
    await flushPromises();
    expect(metaCalls(test.fetchMock, TRANSDUCER_PATH)).toHaveLength(0);
  });

  it('retries a failed zone fetch up to the cap, then settles for the session', async () => {
    // A transient failure must not pin the whole session to the local threshold: each reopened
    // retry window spends one more attempt through the version-reactive effect. The cache's
    // per-path attempt cap then stops a dead endpoint from being hammered forever.
    vi.useFakeTimers();
    try {
      const test = mount({ token: 'tok-1', status: 500 });
      for (let round = 0; round < 6; round += 1) {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
        flushSync();
      }
      expect(metaCalls(test.fetchMock, KEEL_PATH)).toHaveLength(3);

      // Settled: revisiting the path does not spend more attempts, even across retry windows.
      test.setDepth(reading({ source: 'transducer', path: TRANSDUCER_PATH }));
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      flushSync();
      test.setDepth(reading());
      for (let round = 0; round < 3; round += 1) {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
        flushSync();
      }
      expect(metaCalls(test.fetchMock, KEEL_PATH)).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('phrases the alert as a zone hit when the depth is not under the displayed limit', async () => {
    // An open-topped alarm band has no nameable bound: the local number is the displayed limit,
    // but the zone can fire above it, and the sentence must not claim the depth is under a limit
    // it is not under.
    const test = mount({ token: 'tok-1', zones: [{ lower: 0, state: 'alarm' }] });
    await flushPromises();
    flushSync();
    expect(test.controller.serverLimitMeters).toBeUndefined();
    test.setDepth(reading({ meters: 8 }));
    expect(test.controller.alarming).toBe(true);
    expect(test.controller.alert).toBe(
      "Shallow water: depth 8.0 m, inside the server's depth alarm zone.",
    );
  });

  it('announces the depth and the threshold that fired, in the display unit', async () => {
    const test = mount({ mode: 'imperial' });
    await flushPromises();
    test.setDepth(reading({ meters: 2 }));
    // 2 m is 6.6 ft, under the 3 m (9.8 ft) default threshold.
    expect(test.controller.alert).toBe(
      'Shallow water: depth 6.6 ft, under the 9.8 ft alarm threshold.',
    );
  });

  it('silences the tone outright on stop', async () => {
    const test = mount();
    await flushPromises();
    test.setDepth(reading({ meters: 1 }));
    expect(test.events).toEqual(['start']);
    test.controller.stop();
    expect(test.events).toEqual(['start', 'stop']);
  });
});
