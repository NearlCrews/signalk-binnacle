import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '$entities/route';
import {
  type RouteCoverageAssessment,
  routeCoverageAreasKey,
  routeCoverageCatalogKey,
  routeCoverageGeometryKey,
  type SavedRegionDto,
} from '$features/prewarm';
import { createRouteCoverageState } from './route-coverage-state.svelte';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const route: Route = {
    id: 'a',
    name: 'Route A',
    waypoints: [
      { position: { latitude: 40, longitude: -70 } },
      { position: { latitude: 41, longitude: -71 } },
    ],
  };
  const state = $state({ route, provider: 'http://fixture', online: true, now: 1_000_000 });
  const getRegions = vi.fn<() => Promise<SavedRegionDto[]>>().mockResolvedValue([]);
  let controller!: ReturnType<typeof createRouteCoverageState>;
  flushSync(() => {
    cleanups.push(
      $effect.root(() => {
        controller = createRouteCoverageState({
          route: () => state.route,
          provider: () => state.provider,
          online: () => state.online,
          clock: state,
          getRegions,
        });
      }),
    );
  });
  const assessment: RouteCoverageAssessment = {
    routeId: 'a',
    geometryKey: routeCoverageGeometryKey(route.waypoints),
    areasKey: routeCoverageAreasKey([]),
    catalogKey: routeCoverageCatalogKey([]),
    checkedAt: state.now,
    report: {
      verdict: 'complete',
      corridorNm: 1,
      detail: 'coastal',
      sampleCount: 2,
      uncoveredCount: 0,
      detailShortCount: 0,
      gaps: [],
    },
  };
  return { state, controller, getRegions, assessment };
}

async function settle() {
  flushSync();
  await Promise.resolve();
  flushSync();
}

describe('route coverage handoff context', () => {
  it('ignores an older completion queued before a newer assessment is accepted', async () => {
    const t = setup();
    let resolveOld!: (regions: SavedRegionDto[]) => void;
    t.getRegions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    t.controller.accept({ ...t.assessment, areasKey: 'obsolete-areas' });
    flushSync();

    // Queue the old callback first, then replace its assessment before effect cleanup can run.
    // Flushing synchronously here would abort the old request and miss this ordering.
    resolveOld([]);
    t.controller.accept(t.assessment);
    expect(t.controller.fact).toBeUndefined();
    await Promise.resolve();
    await settle();

    expect(t.getRegions).toHaveBeenCalledTimes(2);
    expect(t.controller.fact).toContain('Complete, checked');
  });

  it('withdraws prior verification synchronously and ignores superseded reads', async () => {
    const t = setup();
    t.controller.accept(t.assessment);
    await settle();
    expect(t.controller.fact).toContain('Complete');
    let resolveOld!: (regions: SavedRegionDto[]) => void;
    t.getRegions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    t.controller.accept({ ...t.assessment, checkedAt: t.state.now - 1 });
    expect(t.controller.fact).toBeUndefined();
    flushSync();
    t.controller.accept({ ...t.assessment, catalogKey: 'changed' });
    await settle();
    resolveOld([]);
    await settle();
    expect(t.controller.fact).toBeUndefined();
    t.controller.accept(t.assessment);
    await settle();
    t.state.online = false;
    expect(t.controller.fact).toBeUndefined();
  });

  it('only publishes a date-qualified assessment after verifying its saved areas', async () => {
    const t = setup();
    t.controller.accept(t.assessment);
    expect(t.controller.fact).toBeUndefined();
    await settle();
    expect(t.controller.fact).toContain('Complete, checked');
    expect(t.controller.fact).toContain('Route A');
  });

  it('permanently invalidates the old assessment on route or geometry changes while the panel is closed', async () => {
    const t = setup();
    t.controller.accept(t.assessment);
    await settle();
    t.state.route = { ...t.state.route, id: 'b', name: 'Route B' };
    await settle();
    expect(t.controller.fact).toBeUndefined();
    t.state.route = { ...t.state.route, id: 'a' };
    await settle();
    expect(t.controller.fact).toBeUndefined();
    t.controller.accept(t.assessment);
    await settle();
    t.state.route.waypoints[1].position.latitude = 42;
    await settle();
    expect(t.controller.fact).toBeUndefined();
  });

  it('withdraws coverage after provider loss or a failed background refresh', async () => {
    const t = setup();
    t.controller.accept(t.assessment);
    await settle();
    t.getRegions.mockRejectedValueOnce(new Error('Unavailable'));
    t.state.now += 60_000;
    await settle();
    expect(t.controller.fact).toBeUndefined();
    t.state.online = false;
    await settle();
    expect(t.controller.fact).toBeUndefined();
  });

  it('rejects changed saved areas, changed catalogs, future dates, and day-old checks', async () => {
    const t = setup();
    for (const patch of [
      { areasKey: 'changed' },
      { catalogKey: 'changed' },
      { checkedAt: t.state.now + 1 },
      { checkedAt: t.state.now - 86_400_001 },
    ]) {
      t.controller.accept({ ...t.assessment, ...patch });
      await settle();
      expect(t.controller.fact).toBeUndefined();
    }
  });
});
