import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitsStore } from '$entities/units';
import type { DepthReading } from '$entities/vessel';
import type { UnitsMode } from '$shared/lib';
import { DEFAULT_THRESHOLDS, PersistedValue, type Thresholds } from '$shared/settings';
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

  it('makes the server zones authoritative over the local threshold', async () => {
    // The local threshold would alarm at 2.5 m; the server's alarm band starts under 2 m.
    const test = mount({ token: 'tok-1', zones: [{ upper: 2, state: 'alarm' }] });
    await flushPromises();
    flushSync();

    expect(test.controller.thresholdSource).toBe('server');
    expect(test.controller.effectiveLimitMeters).toBe(2);
    expect(test.thresholds.value.shallowDepthMeters).toBe(DEFAULT_THRESHOLDS.shallowDepthMeters);

    test.setDepth(reading({ meters: 2.5 }));
    expect(test.controller.alarming).toBe(false);
    expect(test.events).toEqual([]);

    test.setDepth(reading({ meters: 1.5 }));
    expect(test.controller.alarming).toBe(true);
    expect(test.events).toEqual(['start']);
  });

  it('resolves a multi-zone configuration to the alarm band', async () => {
    const test = mount({
      token: 'tok-1',
      zones: [
        { upper: 5, state: 'warn' },
        { upper: 2, state: 'alarm' },
      ],
    });
    await flushPromises();
    flushSync();

    expect(test.controller.effectiveLimitMeters).toBe(2);
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
    const test = mount({ token: 'tok-1', zones: [{ upper: 2, state: 'alarm' }] });
    await flushPromises();
    flushSync();
    expect(test.controller.thresholdSource).toBe('server');

    // The keel path stops publishing, so the transducer path wins and the server has no zones for
    // it: the persisted local threshold takes over rather than leaving the boat unmonitored.
    test.setDepth(reading({ meters: 2.5, source: 'transducer', path: TRANSDUCER_PATH }));
    await flushPromises();
    flushSync();
    expect(test.controller.thresholdSource).toBe('local');
    expect(test.controller.effectiveLimitMeters).toBe(DEFAULT_THRESHOLDS.shallowDepthMeters);
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

  it('retries a tokenless zone fetch but caches a failure that had a token', async () => {
    const tokenless = mount({ status: 401 });
    await flushPromises();
    expect(metaCalls(tokenless.fetchMock, KEEL_PATH)).toHaveLength(1);
    // Leaving and returning to the path retries, so granting access later still finds the zones.
    tokenless.setDepth(reading({ source: 'transducer', path: TRANSDUCER_PATH }));
    await flushPromises();
    tokenless.setDepth(reading());
    await flushPromises();
    expect(metaCalls(tokenless.fetchMock, KEEL_PATH)).toHaveLength(2);

    const authed = mount({ token: 'tok-1', status: 401 });
    await flushPromises();
    authed.setDepth(reading({ source: 'transducer', path: TRANSDUCER_PATH }));
    await flushPromises();
    authed.setDepth(reading());
    await flushPromises();
    expect(metaCalls(authed.fetchMock, KEEL_PATH)).toHaveLength(1);
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
