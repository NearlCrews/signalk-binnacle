import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASEMAP_SOURCE_ID } from '$shared/map';
import type { CoverageRoute } from './coverage-context';
import type { RegionsClient, SavedRegionDto, WarmStatus } from './regions-client.js';
import {
  createRegionsController,
  type RegionsControllerDeps,
} from './regions-controller.svelte.js';
import type { RegionRectangle } from './regions-draw.js';

const STATS = { rows: 0, bytes: 0, cap: 1000, perSourceAvgBytes: {} };
const POSITION_POLICY = {
  enabled: false,
  radiusMeters: 14816,
  moveThresholdMeters: 3704,
  intervalSecs: 300,
  baseZoom: 15,
  sources: ['seamark'],
};

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
    unavailableSourceIds: [],
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
  it('cancels only the rectangle placement and restores the previous selected area', () => {
    const { controller, cleanup, draw } = setup(client());
    controller.startNewRegion();
    controller.startDrawing();
    expect(controller.drawing).toBe(true);
    expect(controller.panelCollapsed).toBe(true);
    controller.cancelDrawing();
    expect(controller.subView).toBe('build');
    expect(controller.drawing).toBe(false);
    expect(controller.panelCollapsed).toBe(false);
    expect(draw.clear).toHaveBeenCalled();
    controller.bbox = [-1, -1, 1, 1];
    controller.startDrawing();
    controller.cancelDrawing();
    expect(draw.set).toHaveBeenLastCalledWith([-1, -1, 1, 1]);
    expect(controller.bbox).toEqual([-1, -1, 1, 1]);
    cleanup();
  });
  it('blocks every automatic-cache write until a current policy has loaded, then preserves untouched fields', async () => {
    const pending = deferred<unknown>();
    const api = client({ getConfig: vi.fn(() => pending.promise) });
    const { controller, cleanup } = setup(api);
    const loading = controller.loadPositionWarm();
    expect(controller.positionLoading).toBe(true);
    expect(controller.positionSettingsReady).toBe(false);
    controller.setPositionEnabled(true);
    controller.togglePositionSource('basemap', true);
    controller.commitPositionRadius(1);
    controller.commitMoveThreshold(2);
    controller.commitPositionInterval(60);
    controller.commitPositionBaseZoom(1);
    controller.savePositionWarm();
    controller.retryPositionWrite();
    await vi.runAllTimersAsync();
    expect(api.postConfig).not.toHaveBeenCalled();
    pending.resolve(POSITION_POLICY);
    await loading;
    expect(controller.positionLoading).toBe(false);
    expect(controller.positionSettingsReady).toBe(true);
    controller.setPositionEnabled(true);
    await vi.runAllTimersAsync();
    expect(api.postConfig).toHaveBeenCalledExactlyOnceWith({
      positionWarm: { ...POSITION_POLICY, enabled: true },
    });
    cleanup();
  });

  it.each(['rejected', 'malformed'])(
    'keeps automatic caching unknown after a %s initial read and recovers locally',
    async (kind) => {
      const getConfig = vi.fn<RegionsClient['getConfig']>();
      if (kind === 'rejected') getConfig.mockRejectedValueOnce(new Error('offline'));
      else getConfig.mockResolvedValueOnce({ enabled: true });
      getConfig.mockResolvedValueOnce(POSITION_POLICY);
      const api = client({ getConfig });
      const { controller, cleanup } = setup(api);
      await controller.loadPositionWarm();
      expect(controller.positionLoading).toBe(false);
      expect(controller.positionLoadError).not.toBeNull();
      expect(controller.positionSettingsReady).toBe(false);
      controller.setPositionEnabled(true);
      expect(api.postConfig).not.toHaveBeenCalled();
      await controller.loadPositionWarm();
      expect(controller.positionLoadError).toBeNull();
      expect(controller.positionSettingsReady).toBe(true);
      expect(controller.positionSources).toEqual(['seamark']);
      cleanup();
    },
  );

  it('retires the accepted policy when the companion client changes', async () => {
    let api = client({ getConfig: vi.fn(async () => POSITION_POLICY) });
    const { controller, cleanup } = setup(api, { getClient: () => api });
    controller.start();
    await vi.runAllTimersAsync();
    expect(controller.positionSettingsReady).toBe(true);
    api = client({
      getConfig: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    controller.syncClient();
    expect(controller.positionSettingsReady).toBe(false);
    controller.setPositionEnabled(true);
    await vi.runAllTimersAsync();
    expect(api.postConfig).not.toHaveBeenCalled();
    cleanup();
  });

  it('finishes failed area and storage loads, then accepts a local retry', async () => {
    const api = client({
      getRegions: vi
        .fn<RegionsClient['getRegions']>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce([region('accepted')]),
      getCacheStats: vi
        .fn<RegionsClient['getCacheStats']>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(STATS),
    });
    const { controller, cleanup } = setup(api);
    await Promise.all([controller.loadRegions(), controller.loadStats()]);
    expect(controller.regionsLoading).toBe(false);
    expect(controller.statsLoading).toBe(false);
    expect(controller.loadError).not.toBeNull();
    expect(controller.statsError).not.toBeNull();
    await Promise.all([controller.loadRegions(), controller.loadStats()]);
    expect(controller.regions?.[0].id).toBe('accepted');
    expect(controller.stats).toEqual(STATS);
    expect(controller.loadError).toBeNull();
    expect(controller.statsError).toBeNull();
    cleanup();
  });

  it('checks only the selected passage without writing to the server', () => {
    let selected: CoverageRoute | undefined = {
      id: 'plan-a',
      name: 'Plan A',
      waypoints: [
        { position: { latitude: 0, longitude: 0 } },
        { position: { latitude: 0, longitude: 1 } },
      ],
    };
    const api = client();
    const { controller, cleanup } = setup(api, {
      getCoverageRoute: () => selected,
      createHighlight: () => ({ set: vi.fn(), clear: vi.fn(), destroy: vi.fn() }),
    });
    controller.regions = [];
    controller.runCoverageCheck();
    expect(controller.coverageAssessment?.routeId).toBe('plan-a');
    expect(controller.coverageReport?.sampleCount).toBeGreaterThan(0);
    expect(api.postConfig).not.toHaveBeenCalled();
    expect(api.postRegion).not.toHaveBeenCalled();
    selected = undefined;
    controller.runCoverageCheck();
    expect(controller.coverageReport).toBeNull();
    expect(controller.coverageRoute).toBeUndefined();
    cleanup();
  });

  it('selects and adjusts an area without drawing on the chart, including the antimeridian', () => {
    const api = client();
    const { controller, cleanup, draw } = setup(api, {
      getMap: () =>
        ({
          getBounds: () => ({
            getWest: () => 170,
            getEast: () => 190,
            getSouth: () => -10,
            getNorth: () => 10,
          }),
        }) as never,
    });
    controller.startNewRegion();
    controller.useCurrentView();
    expect(controller.bbox).toEqual([170, -10, -170, 10]);
    expect(draw.start).not.toHaveBeenCalled();
    expect(draw.set).toHaveBeenLastCalledWith([170, -10, -170, 10]);
    expect(controller.selectedSources.length).toBeGreaterThan(0);
    controller.selectedSources = ['seamark'];
    controller.commitAreaBound(1, -5);
    expect(controller.bbox).toEqual([170, -5, -170, 10]);
    expect(controller.selectedSources).toEqual(['seamark']);
    controller.commitAreaBound(3, -6);
    expect(controller.bbox).toEqual([170, -5, -170, 10]);
    expect(controller.error).not.toBeNull();
    controller.commitAreaBound(0, 181);
    expect(controller.bbox?.[0]).toBe(170);
    expect(api.postRegion).not.toHaveBeenCalled();
    cleanup();
  });

  it('invalidates checked coverage on saved-area refresh, route switch, and geometry edits', async () => {
    const route = {
      id: 'first',
      name: 'First',
      waypoints: [
        { position: { latitude: 0, longitude: 0 } },
        { position: { latitude: 0, longitude: 1 } },
      ],
    };
    const highlight = { set: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
    const { controller, cleanup } = setup(client(), {
      getCoverageRoute: () => route,
      createHighlight: () => highlight,
    });
    controller.regions = [region('old')];
    controller.runCoverageCheck();
    expect(controller.coverageReport).not.toBeNull();
    await controller.loadRegions();
    expect(controller.coverageReport).toBeNull();
    expect(highlight.clear).toHaveBeenCalled();
    controller.runCoverageCheck();
    route.name = 'Second';
    expect(controller.coverageReport).toBeNull();
    controller.syncCoverageContext();
    controller.runCoverageCheck();
    route.waypoints[1].position.longitude = 2;
    expect(controller.coverageReport).toBeNull();
    controller.syncCoverageContext();
    cleanup();
  });
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

  it('bounds typed region names and rejects control characters at submission', async () => {
    const api = client();
    const { controller, cleanup } = setup(api);
    controller.bbox = [-1, -1, 1, 1];
    controller.selectedSources = ['basemap'];

    controller.setRegionName('x'.repeat(121));
    expect(controller.regionName).toHaveLength(120);

    controller.regionName = 'unsafe\nname';
    await controller.saveRegion();

    expect(controller.error).toContain('contain no control characters');
    expect(api.postRegion).not.toHaveBeenCalled();
    cleanup();
  });

  it('starts region polling after a recovery-pending create response', async () => {
    const getStatus = vi.fn(async () => null);
    const api = client({
      postRegion: vi.fn(async () => ({ region: region('new'), recovery: 'pending' as const })),
      getRegionJobStatus: getStatus,
    });
    const { controller, cleanup } = setup(api);
    controller.bbox = [-1, -1, 1, 1];
    controller.selectedSources = ['basemap'];
    controller.regionName = 'Passage';

    await controller.saveRegion();
    await vi.advanceTimersByTimeAsync(100);

    expect(controller.error).toBeNull();
    expect(getStatus).toHaveBeenCalledWith('new', expect.any(AbortSignal));
    cleanup();
  });

  it('starts region polling after a recovery-pending redownload response', async () => {
    const getStatus = vi.fn(async () => null);
    const downloadingRegion: SavedRegionDto = { ...region('existing'), status: 'downloading' };
    const api = client({
      redownloadRegion: vi.fn(async () => ({ recovery: 'pending' as const })),
      getRegions: vi.fn(async () => [downloadingRegion]),
      getRegionJobStatus: getStatus,
    });
    const { controller, cleanup } = setup(api);
    controller.regions = [region('existing')];

    await controller.redownloadRegion('existing');
    await vi.advanceTimersByTimeAsync(100);

    expect(controller.error).toBeNull();
    expect(getStatus).toHaveBeenCalledWith('existing', expect.any(AbortSignal));
    expect(controller.pendingRegion.existing).toBeUndefined();
    cleanup();
  });

  it('clears stale progress when a new download poll starts', () => {
    const { controller, cleanup } = setup(client());
    controller.regionStatus = {
      existing: { total: 1, done: 1, skipped: 0, bytes: 10, errors: 0, state: 'done' },
    };

    controller.pollRegion('existing');

    expect(controller.regionStatus.existing).toBeUndefined();
    cleanup();
  });

  it('offers an explicit status retry after repeated poll failures', async () => {
    const getStatus = vi.fn(async () => {
      throw new Error('offline');
    });
    const { controller, cleanup } = setup(client({ getRegionJobStatus: getStatus }));
    controller.regions = [{ ...region('active'), status: 'downloading' }];
    controller.pollRegion('active');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(getStatus).toHaveBeenCalledTimes(5);
    expect(controller.regionPollError.active).toBe(true);

    controller.retryRegionPoll('active');
    expect(controller.regionPollError.active).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(getStatus).toHaveBeenCalledTimes(6);
    cleanup();
  });

  it('does not retry status while another region action is submitting', () => {
    const getStatus = vi.fn();
    const { controller, cleanup } = setup(client({ getRegionJobStatus: getStatus }));
    controller.regions = [{ ...region('active'), status: 'downloading' }];
    controller.regionPollError = { active: true };
    controller.submitting = true;

    controller.retryRegionPoll('active');

    expect(controller.regionPollError.active).toBe(true);
    expect(getStatus).not.toHaveBeenCalled();
    cleanup();
  });

  it('does not re-download active areas or areas with removed chart sources', async () => {
    const redownload = vi.fn(async () => ({ jobId: 'job' }));
    const { controller, cleanup } = setup(client({ redownloadRegion: redownload }));
    controller.regions = [
      { ...region('active'), status: 'downloading' },
      { ...region('retired'), unavailableSourceIds: ['retired-chart'] },
    ];

    await controller.redownloadRegion('active');
    await controller.redownloadRegion('retired');
    await controller.redownloadRegion('missing');

    expect(redownload).not.toHaveBeenCalled();
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

  it('runs the route coverage check against the live route and highlights the gaps', () => {
    const highlight = { set: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
    const { controller, cleanup } = setup(client(), {
      getCoverageRoute: () => ({
        id: 'passage',
        name: 'Passage',
        waypoints: [
          { position: { latitude: 0, longitude: 0 } },
          { position: { latitude: 0, longitude: 1 } },
        ],
      }),
      createHighlight: () => highlight,
    });
    controller.regions = [
      { ...region('half'), bbox: [-0.5, -1, 0.4, 1], sourceIds: [BASEMAP_SOURCE_ID], maxzoom: 12 },
    ];
    controller.setCoverageDetail('coastal');
    controller.setCoverageCorridor(1);
    controller.runCoverageCheck();

    expect(controller.coverageReport?.verdict).toBe('partial');
    expect(highlight.set).toHaveBeenCalledWith(controller.coverageReport?.gaps);

    controller.clearCoverageCheck();
    expect(controller.coverageReport).toBeNull();
    expect(highlight.clear).toHaveBeenCalled();

    cleanup();
    expect(highlight.destroy).toHaveBeenCalled();
  });

  it('re-runs a standing coverage result when its corridor or detail changes', () => {
    const highlight = { set: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
    const { controller, cleanup } = setup(client(), {
      getCoverageRoute: () => ({
        id: 'passage',
        name: 'Passage',
        waypoints: [
          { position: { latitude: 0, longitude: 0 } },
          { position: { latitude: 0, longitude: 1 } },
        ],
      }),
      createHighlight: () => highlight,
    });
    controller.regions = [];
    controller.runCoverageCheck();
    const first = controller.coverageReport;
    controller.setCoverageDetail('harbor');
    expect(controller.coverageReport).not.toBe(first);
    expect(controller.coverageReport?.detail).toBe('harbor');
    cleanup();
  });

  it('clears the coverage result when no passage is selected', () => {
    const highlight = { set: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
    const { controller, cleanup } = setup(client(), {
      getCoverageRoute: () => undefined,
      createHighlight: () => highlight,
    });
    controller.runCoverageCheck();
    expect(controller.coverageReport).toBeNull();
    expect(highlight.set).not.toHaveBeenCalled();
    cleanup();
  });
});
