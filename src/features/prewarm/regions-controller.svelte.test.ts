import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegionsClient, SavedRegionDto, WarmStatus } from './regions-client.js';
import {
  createRegionsController,
  type RegionsControllerDeps,
} from './regions-controller.svelte.js';
import type { RegionRectangle } from './regions-draw.js';

const STATS = { rows: 0, bytes: 0, cap: 1000, perSourceAvgBytes: {} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function region(id: string): SavedRegionDto {
  return {
    id,
    name: id,
    bbox: [-1, -1, 1, 1],
    sourceIds: ['basemap'],
    minzoom: 1,
    maxzoom: 2,
    createdAt: 1,
    lastDownloadedAt: null,
    bytes: 0,
    cachedBytes: 0,
    status: 'ready',
  };
}

function client(overrides: Partial<RegionsClient> = {}): RegionsClient {
  return {
    getConfig: vi.fn(async () => ({ positionWarm: {} })),
    postConfig: vi.fn(async () => undefined),
    setCacheConfig: vi.fn(async () => undefined),
    clearScrollCache: vi.fn(async () => ({ freedBytes: 0, freedRows: 0 })),
    getCacheStats: vi.fn(async () => STATS),
    getRegions: vi.fn(async () => []),
    postRegion: vi.fn(async () => ({ region: region('new'), jobId: 'job' })),
    deleteRegion: vi.fn(async () => undefined),
    redownloadRegion: vi.fn(async () => ({ jobId: 'job' })),
    getRegionJobStatus: vi.fn(async () => null),
    geocode: vi.fn(async () => null),
    ...overrides,
  };
}

function rectangle(): RegionRectangle {
  return {
    start: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    onFinish: vi.fn(),
    destroy: vi.fn(),
  };
}

function setup(clientValue: RegionsClient, extra: Partial<RegionsControllerDeps> = {}) {
  const draw = rectangle();
  const controller = createRegionsController({
    getAdminAccess: () => true,
    getClient: () => clientValue,
    getMap: () => ({}) as never,
    getUnitsMode: () => 'metric',
    createRectangle: () => draw,
    pollMs: 100,
    ...extra,
  });
  let disposeRectangle = controller.syncRectangle();
  const cleanup = () => {
    disposeRectangle();
    controller.destroy();
  };
  const resyncRectangle = () => {
    disposeRectangle();
    disposeRectangle = controller.syncRectangle();
  };
  return { controller, cleanup, draw, resyncRectangle };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RegionsController', () => {
  it('waits for one poll to complete before scheduling the next', async () => {
    const first = deferred<WarmStatus | null>();
    const getStatus = vi
      .fn<RegionsClient['getRegionJobStatus']>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ total: 2, done: 1, skipped: 0, bytes: 10, errors: 0, state: 'running' });
    const { controller, cleanup } = setup(client({ getRegionJobStatus: getStatus }));
    controller.pollRegion('active');

    await vi.advanceTimersByTimeAsync(100);
    expect(getStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(getStatus).toHaveBeenCalledTimes(1);

    first.resolve({ total: 2, done: 0, skipped: 0, bytes: 0, errors: 0, state: 'running' });
    await vi.advanceTimersByTimeAsync(99);
    expect(getStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getStatus).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('aborts an in-flight poll and ignores its late completion', async () => {
    const pending = deferred<WarmStatus | null>();
    let signal: AbortSignal | undefined;
    const getStatus = vi.fn((_id: string, nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return pending.promise;
    });
    const { controller, cleanup } = setup(client({ getRegionJobStatus: getStatus }));
    controller.pollRegion('active');
    await vi.advanceTimersByTimeAsync(100);
    controller.stopRegionPoll('active');
    expect(signal?.aborted).toBe(true);
    pending.resolve({ total: 1, done: 1, skipped: 0, bytes: 1, errors: 0, state: 'done' });
    await vi.runAllTimersAsync();
    expect(controller.regionStatus.active).toBeUndefined();
    cleanup();
  });

  it('drops an older regions response after a newer refresh completes', async () => {
    const older = deferred<SavedRegionDto[]>();
    const newer = deferred<SavedRegionDto[]>();
    const getRegions = vi
      .fn<RegionsClient['getRegions']>()
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { controller, cleanup } = setup(client({ getRegions }));
    controller.start();
    const refresh = controller.loadRegions();
    newer.resolve([region('newer')]);
    await refresh;
    older.resolve([region('older')]);
    await Promise.resolve();
    expect(controller.regions?.map((item) => item.id)).toEqual(['newer']);
    cleanup();
  });

  it('recreates and destroys Terra Draw when the live map changes', () => {
    const maps = $state({ current: { id: 'one' } });
    const draws: RegionRectangle[] = [];
    const { cleanup, resyncRectangle } = setup(client(), {
      getMap: () => maps.current as never,
      createRectangle: () => {
        const draw = rectangle();
        draws.push(draw);
        return draw;
      },
    });
    expect(draws).toHaveLength(1);
    maps.current = { id: 'two' };
    resyncRectangle();
    expect(draws).toHaveLength(2);
    expect(draws[0].destroy).toHaveBeenCalledOnce();
    cleanup();
    expect(draws[1].destroy).toHaveBeenCalledOnce();
  });

  it('ignores non-finite values from every numeric commit boundary', async () => {
    const api = client();
    const { controller, cleanup } = setup(api);
    const original = {
      radius: controller.positionRadiusMeters,
      move: controller.positionMoveThresholdMeters,
      interval: controller.positionIntervalSecs,
      baseZoom: controller.positionBaseZoom,
      ttl: controller.ttlDays,
      minzoom: controller.minzoom,
      maxzoom: controller.maxzoom,
    };

    controller.commitPositionRadius(Number.NaN);
    controller.commitMoveThreshold(Number.POSITIVE_INFINITY);
    controller.commitPositionInterval(Number.NaN);
    controller.commitPositionBaseZoom(Number.NEGATIVE_INFINITY);
    controller.commitTtlDays(Number.NaN);
    controller.commitMinZoom(Number.NaN);
    controller.commitMaxZoom(Number.POSITIVE_INFINITY);
    await vi.runAllTimersAsync();

    expect({
      radius: controller.positionRadiusMeters,
      move: controller.positionMoveThresholdMeters,
      interval: controller.positionIntervalSecs,
      baseZoom: controller.positionBaseZoom,
      ttl: controller.ttlDays,
      minzoom: controller.minzoom,
      maxzoom: controller.maxzoom,
    }).toEqual(original);
    expect(api.postConfig).not.toHaveBeenCalled();
    expect(api.setCacheConfig).not.toHaveBeenCalled();
    cleanup();
  });

  it('restarts a download poll when deleting the region fails', async () => {
    const getStatus = vi.fn(async () => null);
    const api = client({
      deleteRegion: vi.fn(async () => {
        throw new Error('still present');
      }),
      getRegionJobStatus: getStatus,
    });
    const { controller, cleanup } = setup(api);
    controller.pollRegion('active');

    await controller.deleteRegion('active');
    await vi.advanceTimersByTimeAsync(100);

    expect(controller.error).toBe('still present');
    expect(getStatus).toHaveBeenCalledWith('active', expect.any(AbortSignal));
    cleanup();
  });
});
