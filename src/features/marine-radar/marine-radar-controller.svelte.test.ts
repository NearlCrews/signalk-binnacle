import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    controller.dispose();
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
    controller.dispose();
  });

  it('setControl optimistically updates the store and writes the value', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
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
    controller.dispose();
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
    await second;
    resolveFirst?.(new Response('', { status: 500 }));
    await first;
    expect(controller.store.controlValues.gain).toBe(60);
    expect(controller.store.controlErrors.gain).toBeUndefined();
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
    controller.layer.setVisible({ map, beforeIdFor: () => undefined } as never, true);
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
});
