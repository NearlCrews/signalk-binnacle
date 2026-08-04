import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeOverlayContext } from '$shared/testing';

const workerMock = vi.hoisted(() => ({
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  recycle: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./radar-worker-client', () => ({
  createRadarWorkerClient: () => workerMock,
}));

import { createMarineRadarController } from './marine-radar-controller.svelte';

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
const fakeRadar = {
  id: 'a',
  name: 'A',
  status: 'standby',
  spokesPerRevolution: 2048,
  maxSpokeLen: 1024,
  range: 1852,
  controls: { gain: { value: 50 } },
};

function gainCapabilities(): Response {
  return new Response(
    JSON.stringify({
      controls: {
        gain: {
          name: 'Gain',
          dataType: 'number',
          minValue: 0,
          maxValue: 100,
          hasAuto: true,
        },
      },
    }),
    { status: 200 },
  );
}

describe('createMarineRadarController', () => {
  it('does not discover or open a worker when radar is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => false,
    });
    await controller.start();
    expect(controller.store.radars).toHaveLength(0);
    await controller.dispose();
  });

  it('discovers radars and selects the first when available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/signalk/v2/api/vessels/self/radars')
          ? new Response(JSON.stringify([fakeRadar]), { status: 200 })
          : new Response('', { status: 404 }),
      ),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    expect(controller.store.selectedId).toBe('a');
    await controller.dispose();
  });

  it('setControl optimistically updates the store and writes the value', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('/capabilities')) return gainCapabilities();
        if (url.endsWith('/controls'))
          return new Response(JSON.stringify({ gain: { value: 50 } }), { status: 200 });
        if (
          url.includes('/radars') &&
          !url.includes('/controls') &&
          !url.includes('/capabilities')
        ) {
          return new Response(
            JSON.stringify([
              {
                id: 'a',
                name: 'A',
                status: 'standby',
                spokesPerRevolution: 16,
                maxSpokeLen: 8,
                range: 100,
                controls: { gain: { value: 50 } },
              },
            ]),
            { status: 200 },
          );
        }
        return new Response('', { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    await controller.setControl('gain', { value: 55 });
    expect(controller.store.controlValues.gain).toBe(55);
    // A manual value also takes the control out of auto.
    expect(controller.store.controlAuto.gain).toBe(false);
    expect(urls.some((u) => u.includes('/controls/gain'))).toBe(true);

    await controller.setControl('gain', { auto: true });
    expect(controller.store.controlAuto.gain).toBe(true);
    await controller.dispose();
  });

  it('refresh removes a provider that disappeared and clears the selection', async () => {
    let discoveryCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars')) {
          discoveryCount += 1;
          return new Response(JSON.stringify(discoveryCount === 1 ? [fakeRadar] : []), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    expect(controller.store.selectedId).toBe('a');
    await controller.refresh();
    expect(controller.store.availability).toBe('absent');
    expect(controller.store.selectedId).toBeUndefined();
    await controller.dispose();
  });

  it('clears control polling during dispose', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/radars')) {
        return new Response(JSON.stringify([fakeRadar]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars'))
          return new Response(JSON.stringify([fakeRadar]), { status: 200 });
        if (url.includes('/capabilities')) return gainCapabilities();
        if (url.endsWith('/controls'))
          return new Response(JSON.stringify({ gain: { value: 50 } }), { status: 200 });
        if (url.includes('/controls/gain')) {
          controlWrites += 1;
          if (controlWrites === 1)
            return new Promise<Response>((resolve) => {
              resolveFirst = resolve;
            });
          return new Response('', { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars'))
          return new Response(JSON.stringify([fakeRadar]), { status: 200 });
        if (url.includes('/capabilities')) return gainCapabilities();
        if (url.endsWith('/controls'))
          return new Response(JSON.stringify({ gain: { value: 50 } }), { status: 200 });
        if (url.includes('/controls/gain'))
          return new Promise<Response>((resolve) => {
            resolveWrite = resolve;
          });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars'))
          return new Response(JSON.stringify([fakeRadar, radarB]), { status: 200 });
        if (url.includes('/capabilities')) return gainCapabilities();
        if (url.endsWith('/controls')) {
          return new Response(
            JSON.stringify({ gain: { value: url.includes('/radars/b/') ? 25 : 50 } }),
            { status: 200 },
          );
        }
        if (url.includes('/radars/a/controls/gain'))
          return new Promise<Response>((resolve) => {
            resolveWrite = resolve;
          });
        return new Response('', { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/radars')) {
          return new Response(
            JSON.stringify([
              {
                ...fakeRadar,
                controls: {
                  guardZone1: {
                    value: -1,
                    endValue: 1,
                    startDistance: 200,
                    endDistance: 500,
                    enabled: false,
                    allowed: true,
                  },
                },
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes('/capabilities')) {
          return new Response(
            JSON.stringify({
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
            { status: 200 },
          );
        }
        if (url.endsWith('/controls')) {
          return new Response(
            JSON.stringify({
              guardZone1: {
                value: -1,
                endValue: 1,
                startDistance: 200,
                endDistance: 500,
                enabled: false,
                allowed: true,
              },
            }),
            { status: 200 },
          );
        }
        capturedBody = JSON.parse(init?.body as string);
        return new Response('', { status: 500 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    const accepted = { ...controller.store.controlEntries.guardZone1 };
    const write = controller.setZoneControl('guardZone1', {
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/radars')) {
          return new Response(JSON.stringify([{ ...fakeRadar, controls }]), { status: 200 });
        }
        if (url.includes('/capabilities')) {
          return new Response(
            JSON.stringify({
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
            { status: 200 },
          );
        }
        if (url.endsWith('/controls')) {
          return new Response(JSON.stringify(controls), { status: 200 });
        }
        writes.push(JSON.parse(init?.body as string));
        return new Response('', { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();

    await controller.setSectorControl('noTransmitSector1', {
      value: -0.5,
      endValue: 0.75,
      enabled: true,
    });
    await controller.setRectControl('exclusionRect1', {
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

    await controller.setRectControl('exclusionRect1', {
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
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      getHeading: () => 0,
      radarAvailable: () => true,
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars'))
          return new Response(
            JSON.stringify([{ ...fakeRadar, controls: { gain: { value: 50, allowed: false } } }]),
            { status: 200 },
          );
        if (url.includes('/capabilities')) return gainCapabilities();
        if (url.endsWith('/controls'))
          return new Response(JSON.stringify({ gain: { value: 50, allowed: false } }), {
            status: 200,
          });
        writes += 1;
        return new Response('', { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars'))
          return new Response(JSON.stringify([{ ...fakeRadar, status: 'transmit' }]), {
            status: 200,
          });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: 'http://pi',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    workerMock.close.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishClose = resolve)),
    );
    const map = {
      getLayer: () => undefined,
      triggerRepaint: vi.fn(),
    };
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars'))
          return new Response(JSON.stringify([{ ...fakeRadar, status: 'transmit' }]), {
            status: 200,
          });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: 'http://pi',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    controller.store.setOperationalStatus('transmit');
    controller.layer.setVisible(
      { map: { getLayer: () => undefined, triggerRepaint: vi.fn() } } as never,
      true,
    );
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

  it('leaves the waiting status to its own label rather than repeating it as detail', async () => {
    const testDocument = new EventTarget();
    Object.defineProperty(testDocument, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('document', testDocument);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/radars'))
          return new Response(JSON.stringify([{ ...fakeRadar, status: 'transmit' }]), {
            status: 200,
          });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: 'http://pi',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    controller.store.setOperationalStatus('transmit');
    controller.layer.setVisible(
      fakeOverlayContext({ getLayer: () => undefined, triggerRepaint: vi.fn() }),
      true,
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    expect(controller.store.availability).toBe('unreachable');
    expect(controller.store.discoveryDetail).toBe('Radar discovery returned HTTP 503.');
    // The zero-radar path settles the stream to idle, whose setStatus clears the shared detail.
    expect(controller.store.status).toBe('idle');
    expect(controller.store.statusDetail).toBeUndefined();
    await controller.dispose();
  });

  it('clears a stale discovery detail once the provider answers', async () => {
    let failing = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (failing) return new Response('', { status: 503 });
        if (url.endsWith('/radars'))
          return new Response(JSON.stringify([fakeRadar]), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const controller = createMarineRadarController({
      origin: '',
      getToken: () => undefined,
      getCenter: () => ({ latitude: 0, longitude: 0 }),
      radarAvailable: () => true,
    });
    await controller.start();
    expect(controller.store.discoveryDetail).toBe('Radar discovery returned HTTP 503.');

    failing = false;
    await controller.refresh();
    expect(controller.store.availability).toBe('available');
    expect(controller.store.discoveryDetail).toBeUndefined();
    await controller.dispose();
  });
});
