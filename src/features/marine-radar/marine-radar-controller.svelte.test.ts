import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';

const workerMock = vi.hoisted(() => ({
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  recycle: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./radar-worker-client', () => ({
  createRadarWorkerClient: () => workerMock,
}));

import {
  createMarineRadarController,
  type MarineRadarDeps,
} from './marine-radar-controller.svelte';
import { makeRadar } from './radar-test-fixtures';
import type { RadarInfo } from './radar-types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  workerMock.open.mockResolvedValue(undefined);
  workerMock.close.mockResolvedValue(undefined);
});

// A minimal valid RadarInfo as the server would return it in the discovery array.
const fakeRadar = makeRadar();

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

function gainCapabilities(): Response {
  return jsonResponse({
    controls: {
      gain: {
        name: 'Gain',
        dataType: 'number',
        minValue: 0,
        maxValue: 100,
        hasAuto: true,
      },
    },
  });
}

function makeController(overrides: Partial<MarineRadarDeps> = {}) {
  return createMarineRadarController({
    origin: '',
    getToken: () => undefined,
    getCenter: () => ({ latitude: 0, longitude: 0 }),
    radarAvailable: () => true,
    ...overrides,
  });
}

type RadarFetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

// Stubs the four routes the controller fetches: discovery, per-radar capabilities, per-radar
// controls, and everything else, which is where control writes land. An omitted route falls through
// to `rest`, which itself defaults to an empty 200 object for the routes a test does not care
// about. Returns the mock so a test can assert on the calls it made.
function stubRadarFetch(
  handlers: {
    radars?: RadarInfo[] | RadarFetchHandler;
    capabilities?: RadarFetchHandler;
    controls?: RadarFetchHandler;
    rest?: RadarFetchHandler;
  } = {},
) {
  const { radars, capabilities, controls, rest } = handlers;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (radars && url.endsWith('/radars'))
      return typeof radars === 'function' ? radars(url, init) : jsonResponse(radars);
    if (capabilities && url.includes('/capabilities')) return capabilities(url, init);
    if (controls && url.endsWith('/controls')) return controls(url, init);
    return rest ? rest(url, init) : jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('createMarineRadarController', () => {
  it('does not discover or open a worker when radar is unavailable', async () => {
    stubRadarFetch({ rest: () => new Response('', { status: 404 }) });
    const controller = makeController({ radarAvailable: () => false });
    await controller.start();
    expect(controller.store.radars).toHaveLength(0);
    await controller.dispose();
  });

  it('discovers radars and selects the first when available', async () => {
    stubRadarFetch({ radars: [fakeRadar], rest: () => new Response('', { status: 404 }) });
    const controller = makeController();
    await controller.start();
    expect(controller.store.selectedId).toBe('a');
    await controller.dispose();
  });

  it('setControl optimistically updates the store and writes the value', async () => {
    const fetchMock = stubRadarFetch({
      radars: [fakeRadar],
      capabilities: gainCapabilities,
      controls: () => jsonResponse({ gain: { value: 50 } }),
    });
    const controller = makeController();
    await controller.start();
    await controller.setControl('gain', { value: 55 });
    expect(controller.store.controlValues.gain).toBe(55);
    // A manual value also takes the control out of auto.
    expect(controller.store.controlAuto.gain).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/controls/gain'))).toBe(true);

    await controller.setControl('gain', { auto: true });
    expect(controller.store.controlAuto.gain).toBe(true);
    await controller.dispose();
  });

  it('refresh removes a provider that disappeared and clears the selection', async () => {
    let discoveryCount = 0;
    stubRadarFetch({
      radars: () => {
        discoveryCount += 1;
        return jsonResponse(discoveryCount === 1 ? [fakeRadar] : []);
      },
    });
    const controller = makeController();
    await controller.start();
    expect(controller.store.selectedId).toBe('a');
    await controller.refresh();
    expect(controller.store.availability).toBe('absent');
    expect(controller.store.selectedId).toBeUndefined();
    await controller.dispose();
  });

  it('clears control polling during dispose', async () => {
    vi.useFakeTimers();
    const fetchMock = stubRadarFetch({ radars: [fakeRadar] });
    const controller = makeController();
    try {
      await controller.start();
      controller.setPolling(true);
      await vi.advanceTimersByTimeAsync(0);
      await controller.dispose();
      const callsAfterDispose = fetchMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchMock).toHaveBeenCalledTimes(callsAfterDispose);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the latest control write when an older request fails later', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    let controlWrites = 0;
    stubRadarFetch({
      radars: [fakeRadar],
      capabilities: gainCapabilities,
      controls: () => jsonResponse({ gain: { value: 50 } }),
      rest: (url) => {
        if (!url.includes('/controls/gain')) return jsonResponse({});
        controlWrites += 1;
        if (controlWrites === 1)
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        return new Response('', { status: 200 });
      },
    });
    const controller = makeController();
    await controller.start();
    const first = controller.setControl('gain', { value: 55 });
    const second = controller.setControl('gain', { value: 60 });
    expect(controlWrites).toBe(1);
    resolveFirst?.(new Response('', { status: 500 }));
    await first;
    await second;
    expect(controlWrites).toBe(2);
    expect(controller.store.controlValues.gain).toBe(60);
    expect(controller.store.controlErrors.gain).toBeUndefined();
    await controller.dispose();
  });

  it('keeps an active write pending across a same-radar refresh', async () => {
    let resolveWrite: ((response: Response) => void) | undefined;
    stubRadarFetch({
      radars: [fakeRadar],
      capabilities: gainCapabilities,
      controls: () => jsonResponse({ gain: { value: 50 } }),
      rest: (url) =>
        url.includes('/controls/gain')
          ? new Promise<Response>((resolve) => {
              resolveWrite = resolve;
            })
          : jsonResponse({}),
    });
    const controller = makeController();
    await controller.start();
    const write = controller.setControl('gain', { value: 55 });
    expect(controller.store.pendingControls.gain).toBe(true);
    await controller.refresh();
    expect(controller.store.controlValues.gain).toBe(55);
    expect(controller.store.pendingControls.gain).toBe(true);
    resolveWrite?.(new Response('', { status: 200 }));
    await write;
    expect(controller.store.pendingControls.gain).toBeUndefined();
    expect(controller.store.controlValues.gain).toBe(55);
    await controller.dispose();
  });

  it('ignores an old A write after switching A to B to A', async () => {
    let resolveWrite: ((response: Response) => void) | undefined;
    const radarB = { ...fakeRadar, id: 'b', name: 'B', controls: { gain: { value: 25 } } };
    stubRadarFetch({
      radars: [fakeRadar, radarB],
      capabilities: gainCapabilities,
      controls: (url) => jsonResponse({ gain: { value: url.includes('/radars/b/') ? 25 : 50 } }),
      rest: (url) =>
        url.includes('/radars/a/controls/gain')
          ? new Promise<Response>((resolve) => {
              resolveWrite = resolve;
            })
          : new Response('', { status: 200 }),
    });
    const controller = makeController();
    await controller.start();
    const oldWrite = controller.setControl('gain', { value: 55 });
    controller.selectRadar('b');
    controller.selectRadar('a');
    await vi.waitFor(() => expect(controller.store.capabilities).not.toHaveLength(0));
    resolveWrite?.(new Response('', { status: 500 }));
    await oldWrite;
    expect(controller.store.selectedId).toBe('a');
    expect(controller.store.controlValues.gain).toBe(50);
    expect(controller.store.controlErrors.gain).toBeUndefined();
    expect(controller.store.pendingControls.gain).toBeUndefined();
    await controller.dispose();
  });

  it('writes one complete native guard zone and restores the exact entry after rejection', async () => {
    let capturedBody: unknown;
    const zone = {
      value: -1,
      endValue: 1,
      startDistance: 200,
      endDistance: 500,
      enabled: false,
      allowed: true,
    };
    stubRadarFetch({
      radars: [{ ...fakeRadar, controls: { guardZone1: zone } }],
      capabilities: () =>
        jsonResponse({
          controls: {
            guardZone1: {
              name: 'Guard zone 1',
              dataType: 'zone',
              minValue: -Math.PI,
              maxValue: Math.PI,
              stepValue: Math.PI / 180,
              units: 'rad',
              maxDistance: 100_000,
              hasEnabled: true,
            },
          },
        }),
      controls: () => jsonResponse({ guardZone1: zone }),
      rest: (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response('', { status: 500 });
      },
    });
    const controller = makeController();
    await controller.start();
    const accepted = { ...controller.store.controlEntries.guardZone1 };
    const write = controller.setStructuredControl('guardZone1', {
      value: -0.5,
      endValue: 0.75,
      startDistance: 250,
      endDistance: 750,
      enabled: false,
    });
    expect(controller.store.controlEntries.guardZone1).toMatchObject({
      value: -0.5,
      endValue: 0.75,
      startDistance: 250,
      endDistance: 750,
      enabled: false,
      allowed: true,
    });
    await write;
    expect(capturedBody).toEqual({
      value: {
        guardZone1: {
          value: -0.5,
          endValue: 0.75,
          startDistance: 250,
          endDistance: 750,
          enabled: false,
        },
      },
    });
    expect(controller.store.controlEntries.guardZone1).toEqual(accepted);
    expect(controller.store.controlErrors.guardZone1).toContain('HTTP 500');
    await controller.dispose();
  });

  it('writes complete native sector and rectangle values through the atomic bulk route', async () => {
    const writes: unknown[] = [];
    const controls = {
      noTransmitSector1: { value: -1, endValue: 1, enabled: false, allowed: true },
      exclusionRect1: {
        x1: -100,
        y1: 50,
        x2: 100,
        y2: 50,
        width: 20,
        enabled: true,
        allowed: true,
      },
    };
    stubRadarFetch({
      radars: [{ ...fakeRadar, controls }],
      capabilities: () =>
        jsonResponse({
          controls: {
            noTransmitSector1: {
              name: 'No-transmit sector 1',
              dataType: 'sector',
              minValue: -Math.PI,
              maxValue: Math.PI,
              stepValue: Math.PI / 180,
              units: 'rad',
              hasEnabled: true,
            },
            exclusionRect1: {
              name: 'Exclusion rectangle 1',
              dataType: 'rect',
              minValue: 0,
              maxValue: 100_000,
              units: 'm',
              maxDistance: 100_000,
              hasEnabled: true,
            },
          },
        }),
      controls: () => jsonResponse(controls),
      rest: (_url, init) => {
        writes.push(JSON.parse(init?.body as string));
        return new Response('', { status: 200 });
      },
    });
    const controller = makeController();
    await controller.start();

    await controller.setStructuredControl('noTransmitSector1', {
      value: -0.5,
      endValue: 0.75,
      enabled: true,
    });
    await controller.setStructuredControl('exclusionRect1', {
      x1: -200,
      y1: 100,
      x2: 200,
      y2: 100,
      width: 40,
      enabled: false,
    });

    expect(writes).toEqual([
      {
        value: {
          noTransmitSector1: { value: -0.5, endValue: 0.75, enabled: true },
        },
      },
      {
        value: {
          exclusionRect1: {
            x1: -200,
            y1: 100,
            x2: 200,
            y2: 100,
            width: 40,
            enabled: false,
          },
        },
      },
    ]);

    await controller.setStructuredControl('exclusionRect1', {
      x1: -200,
      y1: 100,
      x2: 200,
      y2: 100,
      width: 0,
      enabled: false,
    });
    expect(writes).toHaveLength(2);
    expect(controller.store.controlErrors.exclusionRect1).toContain('Width');
    await controller.dispose();
  });

  it('starts chart editing only with an active draft, fresh inputs, and no competing tool', async () => {
    let blocked: string | undefined = 'Finish the measurement first.';
    const controller = makeController({
      getHeading: () => 0,
      chartEditBlockedReason: () => blocked,
    });
    controller.store.setDiscovered([
      {
        ...fakeRadar,
        status: 'standby' as const,
        controls: { noTransmitSector1: { value: -1, endValue: 1, enabled: false } },
      },
    ]);
    controller.store.setAreaDraft({
      radarId: 'a',
      controlId: 'noTransmitSector1',
      type: 'sector',
      value: { value: -1, endValue: 1, enabled: false },
      chartEditing: false,
      chartStep: 0,
    });

    expect(controller.startAreaChartEdit('noTransmitSector1')).toBe(blocked);
    blocked = undefined;
    expect(controller.startAreaChartEdit('noTransmitSector1')).toBeUndefined();
    expect(controller.store.areaDraft?.chartEditing).toBe(true);
    controller.stopAreaChartEdit();
    expect(controller.store.areaDraft?.chartEditing).toBe(false);
    await controller.dispose();
  });

  it('rechecks the live allowed flag before writing', async () => {
    let writes = 0;
    const blockedGain = { gain: { value: 50, allowed: false } };
    stubRadarFetch({
      radars: [{ ...fakeRadar, controls: blockedGain }],
      capabilities: gainCapabilities,
      controls: () => jsonResponse(blockedGain),
      rest: () => {
        writes += 1;
        return new Response('', { status: 200 });
      },
    });
    const controller = makeController();
    await controller.start();
    await controller.setControl('gain', { value: 60 });
    expect(writes).toBe(0);
    expect(controller.store.controlValues.gain).toBe(50);
    expect(controller.store.controlErrors.gain).toContain('not allowing changes');
    await controller.dispose();
  });

  it('finishes a pending close before reopening the worker', async () => {
    let finishClose: (() => void) | undefined;
    const testDocument = new EventTarget();
    Object.defineProperty(testDocument, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('document', testDocument);
    stubRadarFetch({ radars: [{ ...fakeRadar, status: 'transmit' }] });
    const controller = makeController({ origin: 'http://pi' });
    await controller.start();
    workerMock.close.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishClose = resolve)),
    );
    const map = createFakeMap();
    // Keep the lifecycle test independent of discovery-control reconciliation.
    expect(controller.store.selectedId).toBe('a');
    controller.store.setOperationalStatus('transmit');
    controller.layer.setVisible(fakeOverlayContext(map), true);
    await vi.waitFor(() => expect(workerMock.open).toHaveBeenCalledOnce());

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(finishClose).toBeTypeOf('function'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(workerMock.open).toHaveBeenCalledOnce();
    finishClose?.();
    await vi.waitFor(() => expect(workerMock.open).toHaveBeenCalledTimes(2));
    await controller.dispose();
  });

  it('serializes a timer-driven reopen with a visibility close', async () => {
    vi.useFakeTimers();
    const testDocument = new EventTarget();
    Object.defineProperty(testDocument, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('document', testDocument);
    stubRadarFetch({ radars: [{ ...fakeRadar, status: 'transmit' }] });
    const controller = makeController({ origin: 'http://pi' });
    await controller.start();
    controller.store.setOperationalStatus('transmit');
    controller.layer.setVisible(fakeOverlayContext(createFakeMap()), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(workerMock.open).toHaveBeenCalledOnce();

    const onWorkerStatus = workerMock.open.mock.calls[0]?.[6] as
      | ((status: 'open' | 'closed') => void)
      | undefined;
    let finishReopen: (() => void) | undefined;
    workerMock.open.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishReopen = resolve)),
    );
    onWorkerStatus?.('closed');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(finishReopen).toBeTypeOf('function');

    const closesBeforeHide = workerMock.close.mock.calls.length;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(workerMock.close).toHaveBeenCalledTimes(closesBeforeHide);

    finishReopen?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(workerMock.close.mock.calls.length).toBeGreaterThan(closesBeforeHide);
    await controller.dispose();
    vi.useRealTimers();
  });

  it('escalates a stale stream into a forced close and backed-off reopen', async () => {
    vi.useFakeTimers();
    const testDocument = new EventTarget();
    Object.defineProperty(testDocument, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('document', testDocument);
    stubRadarFetch({ radars: [{ ...fakeRadar, status: 'transmit' }] });
    const controller = makeController({ origin: 'http://pi' });
    await controller.start();
    controller.store.setOperationalStatus('transmit');
    controller.layer.setVisible(fakeOverlayContext(createFakeMap()), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(workerMock.open).toHaveBeenCalledOnce();

    // A half-open socket: spokes flowed once, then stopped, and no close event ever fires.
    controller.store.lastSpokeAt = Date.now();
    controller.store.setStatus('live');
    await vi.advanceTimersByTimeAsync(6_000);
    expect(controller.store.status).toBe('stale');

    // Past the escalation window the freshness watch forces the close the transport never
    // signaled and hands the reopen to the backoff.
    const closesBefore = workerMock.close.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(workerMock.close.mock.calls.length).toBeGreaterThan(closesBefore);
    expect(controller.store.status).toBe('error');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(workerMock.open.mock.calls.length).toBeGreaterThan(1);
    await controller.dispose();
    vi.useRealTimers();
  });

  it('leaves the waiting status to its own label rather than repeating it as detail', async () => {
    const testDocument = new EventTarget();
    Object.defineProperty(testDocument, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('document', testDocument);
    stubRadarFetch({ radars: [{ ...fakeRadar, status: 'transmit' }] });
    const controller = makeController({ origin: 'http://pi' });
    await controller.start();
    controller.store.setOperationalStatus('transmit');
    controller.layer.setVisible(fakeOverlayContext(createFakeMap()), true);
    await vi.waitFor(() => expect(workerMock.open).toHaveBeenCalledOnce());

    const onWorkerStatus = workerMock.open.mock.calls[0]?.[6] as
      | ((status: 'open' | 'closed') => void)
      | undefined;
    onWorkerStatus?.('open');
    expect(controller.store.status).toBe('waiting');
    expect(controller.store.statusDetail).toBeUndefined();
    await controller.dispose();
  });

  it('keeps a discovery failure detail through the stream settling to idle', async () => {
    stubRadarFetch({ rest: () => new Response('', { status: 503 }) });
    const controller = makeController();
    await controller.start();
    expect(controller.store.availability).toBe('unreachable');
    expect(controller.store.discoveryDetail).toBe('Radar discovery returned HTTP 503.');
    // The zero-radar path settles the stream to idle, whose setStatus clears the shared detail.
    expect(controller.store.status).toBe('idle');
    expect(controller.store.statusDetail).toBeUndefined();
    await controller.dispose();
  });

  it('merges a scalar control delta into the stored entry, keeping allowed and auto', async () => {
    const blockedGain = { gain: { value: 50, auto: true, allowed: false } };
    stubRadarFetch({
      radars: [{ ...fakeRadar, controls: blockedGain }],
      capabilities: gainCapabilities,
      controls: () => jsonResponse(blockedGain),
    });
    const controller = makeController();
    await controller.start();
    controller.applyControlDelta('radars.a.controls.gain', 55);
    expect(controller.store.controlValues.gain).toBe(55);
    expect(controller.store.controlEntries.gain).toMatchObject({
      value: 55,
      auto: true,
      allowed: false,
    });
    // A record-shaped delta is also a merge: deltas carry only what changed, so a partial
    // record must not wipe the fields hydration established either.
    controller.applyControlDelta('radars.a.controls.gain', { value: 60, allowed: true });
    expect(controller.store.controlEntries.gain).toMatchObject({
      value: 60,
      allowed: true,
      auto: true,
    });
    // The discovery snapshot follows the selected radar's deltas too, so a switch away and back
    // seeds live state rather than the discovery-time values.
    expect(controller.store.radars.find((r) => r.id === 'a')?.controls.gain).toMatchObject({
      value: 60,
      allowed: true,
    });
    await controller.dispose();
  });

  it('resyncs the spoke stream when a controls poll flips power', async () => {
    vi.useFakeTimers();
    let power = 'transmit';
    stubRadarFetch({
      radars: [{ ...fakeRadar, status: 'transmit' }],
      controls: () => jsonResponse({ power: { value: power } }),
    });
    const controller = makeController({ origin: 'http://pi' });
    try {
      await controller.start();
      const clearSpy = vi.spyOn(controller.layer, 'clearFrame');
      controller.layer.setVisible(fakeOverlayContext(createFakeMap()), true);
      await vi.advanceTimersByTimeAsync(0);
      expect(workerMock.open).toHaveBeenCalledOnce();
      controller.setPolling(true);
      await vi.advanceTimersByTimeAsync(0);

      power = 'standby';
      await vi.advanceTimersByTimeAsync(15_000);
      expect(workerMock.close).toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
      expect(controller.store.status).toBe('paused');

      power = 'transmit';
      await vi.advanceTimersByTimeAsync(15_000);
      expect(workerMock.open).toHaveBeenCalledTimes(2);
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('lets the armed reconnect backoff own the reopen instead of any lifecycle sync', async () => {
    vi.useFakeTimers();
    const testDocument = new EventTarget();
    Object.defineProperty(testDocument, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('document', testDocument);
    stubRadarFetch({ radars: [{ ...fakeRadar, status: 'transmit' }] });
    const controller = makeController({ origin: 'http://pi' });
    try {
      await controller.start();
      controller.layer.setVisible(fakeOverlayContext(createFakeMap()), true);
      await vi.advanceTimersByTimeAsync(0);
      expect(workerMock.open).toHaveBeenCalledOnce();

      const onWorkerStatus = workerMock.open.mock.calls[0]?.[6] as
        | ((status: 'open' | 'closed') => void)
        | undefined;
      onWorkerStatus?.('closed');
      expect(controller.store.status).toBe('error');

      // A gain delta changes no gating: even if it reached the lifecycle, the armed timer would
      // refuse the reopen, so the discriminating assertion for timer authority is the
      // visibility sync below.
      controller.applyControlDelta('radars.a.controls.gain', 55);
      await vi.advanceTimersByTimeAsync(0);
      expect(workerMock.open).toHaveBeenCalledOnce();

      // A lifecycle sync while the backoff is armed (here a visibility event) must not reconnect
      // early either; the timer stays the single reconnect authority.
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(workerMock.open).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(workerMock.open).toHaveBeenCalledTimes(2);
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('does not tear down a stale-but-open stream on an unrelated lifecycle sync', async () => {
    const testDocument = new EventTarget();
    Object.defineProperty(testDocument, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('document', testDocument);
    stubRadarFetch({ radars: [{ ...fakeRadar, status: 'transmit' }] });
    const controller = makeController({ origin: 'http://pi' });
    await controller.start();
    controller.layer.setVisible(fakeOverlayContext(createFakeMap()), true);
    await vi.waitFor(() => expect(workerMock.open).toHaveBeenCalledOnce());

    controller.store.setStatus('stale', 'No new spokes in 5 s. Echo cleared.');
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workerMock.open).toHaveBeenCalledOnce();
    expect(workerMock.close).not.toHaveBeenCalled();
    await controller.dispose();
  });

  it('reconciles deltas for non-selected radars and both power spellings', async () => {
    const radarB = { ...fakeRadar, id: 'b', name: 'B', controls: { gain: { value: 25 } } };
    stubRadarFetch({ radars: [fakeRadar, radarB], capabilities: gainCapabilities });
    const controller = makeController();
    await controller.start();
    expect(controller.store.selectedId).toBe('a');

    controller.applyControlDelta('radars.b.controls.power', 'transmit');
    const b = controller.store.radars.find((r) => r.id === 'b');
    expect(b?.status).toBe('transmit');
    expect(b?.controls.power?.value).toBe('transmit');
    expect(controller.store.operationalStatus).toBe('standby');

    // Selecting b seeds the live reconciled state rather than the discovery snapshot.
    controller.selectRadar('b');
    expect(controller.store.operationalStatus).toBe('transmit');

    // The status spelling drives the operational state for the selected radar too.
    controller.applyControlDelta('radars.b.controls.status', 'standby');
    expect(controller.store.operationalStatus).toBe('standby');
    await controller.dispose();
  });

  it('clears a stale discovery detail once the provider answers', async () => {
    let failing = true;
    stubRadarFetch({
      radars: () => (failing ? new Response('', { status: 503 }) : jsonResponse([fakeRadar])),
      rest: () => (failing ? new Response('', { status: 503 }) : jsonResponse({})),
    });
    const controller = makeController();
    await controller.start();
    expect(controller.store.discoveryDetail).toBe('Radar discovery returned HTTP 503.');

    failing = false;
    await controller.refresh();
    expect(controller.store.availability).toBe('available');
    expect(controller.store.discoveryDetail).toBeUndefined();
    await controller.dispose();
  });
});

// One wire target as the targets endpoint serves it, georeferenced with a provider assessment.
const wireArpaTarget = {
  id: 7,
  status: 'tracking',
  position: { bearing: 1.2, distance: 1400, latitude: 59.1, longitude: 10.5 },
  motion: { course: 0.5, speed: 3.2 },
  danger: { cpa: 200, tcpa: 120 },
};

// Adds a targets route to stubRadarFetch, above the rest fallback the base helper answers with.
function stubArpaFetch(
  targets: RadarFetchHandler,
  handlers: Parameters<typeof stubRadarFetch>[0] = {},
) {
  const { rest, ...others } = handlers;
  return stubRadarFetch({
    ...others,
    rest: (url, init) => {
      if (url.endsWith('/targets')) return targets(url, init);
      return rest ? rest(url, init) : jsonResponse({});
    },
  });
}

describe('ARPA targets polling', () => {
  it('polls targets on a 5 s cadence while transmitting and maps collision contacts', async () => {
    vi.useFakeTimers();
    let polls = 0;
    stubArpaFetch(
      () => {
        polls += 1;
        return jsonResponse([wireArpaTarget]);
      },
      { radars: [{ ...fakeRadar, status: 'transmit' }] },
    );
    const controller = makeController();
    try {
      await controller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(polls).toBe(1);
      expect(controller.store.arpaTargets?.targets).toHaveLength(1);
      expect(controller.store.collisionContacts).toEqual([
        {
          id: 'radar:a:7',
          name: 'Radar 7',
          position: { latitude: 59.1, longitude: 10.5 },
          sogMps: 3.2,
          cogRad: 0.5,
          cpaMeters: 200,
          tcpaSeconds: 120,
        },
      ]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(polls).toBe(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(polls).toBe(3);
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('does not poll targets while the radar is on standby', async () => {
    vi.useFakeTimers();
    let polls = 0;
    stubArpaFetch(
      () => {
        polls += 1;
        return jsonResponse([wireArpaTarget]);
      },
      { radars: [fakeRadar] },
    );
    const controller = makeController();
    try {
      await controller.start();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(polls).toBe(0);
      expect(controller.store.arpaTargets).toBeUndefined();
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('stops polling and clears contacts when a delta reconciles the radar to standby', async () => {
    vi.useFakeTimers();
    let polls = 0;
    stubArpaFetch(
      () => {
        polls += 1;
        return jsonResponse([wireArpaTarget]);
      },
      { radars: [{ ...fakeRadar, status: 'transmit' }] },
    );
    const controller = makeController();
    try {
      await controller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.store.arpaTargets?.targets).toHaveLength(1);

      controller.applyControlDelta('radars.a.controls.status', 'standby');
      expect(controller.store.arpaTargets).toBeUndefined();
      expect(controller.store.collisionContacts).toEqual([]);
      const pollsAtStandby = polls;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(polls).toBe(pollsAtStandby);

      // Transmit reopens the poll, like the spoke stream.
      controller.applyControlDelta('radars.a.controls.status', 'transmit');
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.store.arpaTargets?.targets).toHaveLength(1);
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('discards a late targets response that lands after standby cleared the picture', async () => {
    vi.useFakeTimers();
    let release: ((response: Response) => void) | undefined;
    stubArpaFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      { radars: [{ ...fakeRadar, status: 'transmit' }] },
    );
    const controller = makeController();
    try {
      await controller.start();
      await vi.advanceTimersByTimeAsync(0);
      controller.applyControlDelta('radars.a.controls.status', 'standby');
      release?.(jsonResponse([wireArpaTarget]));
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.store.arpaTargets).toBeUndefined();
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('goes dormant once the endpoint reports no ARPA support, and re-probes on refresh', async () => {
    vi.useFakeTimers();
    let polls = 0;
    let supported = false;
    stubArpaFetch(
      () => {
        polls += 1;
        return supported ? jsonResponse([wireArpaTarget]) : new Response('', { status: 501 });
      },
      { radars: [{ ...fakeRadar, status: 'transmit' }] },
    );
    const controller = makeController();
    try {
      await controller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(polls).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(polls).toBe(1);

      supported = true;
      await controller.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.store.arpaTargets?.targets).toHaveLength(1);
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('holds contacts through a transient poll failure, then clears past the hold window', async () => {
    vi.useFakeTimers();
    let failing = false;
    stubArpaFetch(
      () => (failing ? new Response('', { status: 500 }) : jsonResponse([wireArpaTarget])),
      { radars: [{ ...fakeRadar, status: 'transmit' }] },
    );
    const controller = makeController();
    try {
      await controller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.store.arpaTargets?.targets).toHaveLength(1);

      failing = true;
      // Two failed polls inside the 15 s hold keep the last picture.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(controller.store.arpaTargets?.targets).toHaveLength(1);
      // The next failed poll is past the hold and clears it.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(controller.store.arpaTargets).toBeUndefined();
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  });

  it('stops targets polling on dispose', async () => {
    vi.useFakeTimers();
    let polls = 0;
    stubArpaFetch(
      () => {
        polls += 1;
        return jsonResponse([wireArpaTarget]);
      },
      { radars: [{ ...fakeRadar, status: 'transmit' }] },
    );
    const controller = makeController();
    try {
      await controller.start();
      await vi.advanceTimersByTimeAsync(0);
      await controller.dispose();
      const pollsAtDispose = polls;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(polls).toBe(pollsAtDispose);
      expect(controller.store.arpaTargets).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
