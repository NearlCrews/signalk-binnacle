import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { InstrumentTrendDescriptor } from '$entities/instrument-trend';
import { PersistedValue } from '$shared/settings';
import { SignalKStore } from '$shared/signalk';
import { createTrendsController, type TrendsDeps } from './trends-controller.svelte';

function descriptor(id: string, path = `path.${id}`): InstrumentTrendDescriptor {
  return {
    id,
    label: id,
    description: `${id} description`,
    category: 'navigation',
    candidates: [{ path, minPeriodMs: 1000, staleAfterMs: 10_000 }],
    aggregate: 'average',
    display: 'count',
    metricPrecision: 0,
    imperialPrecision: 0,
  };
}

let setupId = 0;

function setup(
  selected: string[] = ['depth'],
  descriptors: InstrumentTrendDescriptor[] = [
    descriptor('depth'),
    descriptor('wind'),
    descriptor('pressure'),
  ],
  overrides: Partial<TrendsDeps> = {},
) {
  const byId = new Map(descriptors.map((entry) => [entry.id, entry]));
  setupId += 1;
  const selectionStore = new PersistedValue<string[]>(`test:trends:${setupId}`, selected);
  const subscribe = vi.fn();
  const unsubscribe = vi.fn();
  const refreshCatalog = vi.fn();
  const prepareDescriptors = vi.fn();
  const deps: TrendsDeps = {
    store: new SignalKStore(),
    origin: 'http://boat',
    getToken: () => undefined,
    getHistoryProviders: () => ({ ids: [] }),
    getHistoryProviderState: () => 'absent',
    subscribe,
    unsubscribe,
    selectionStore,
    getCatalog: () => descriptors,
    getDescriptor: (id) => byId.get(id),
    prepareDescriptors,
    refreshCatalog,
    getDiscovering: () => false,
    isHistoricalOnly: () => false,
    ...overrides,
  };
  let controller!: ReturnType<typeof createTrendsController>;
  const destroyRoot = $effect.root(() => {
    controller = createTrendsController(deps);
  });
  return {
    controller,
    selectionStore,
    subscribe,
    unsubscribe,
    refreshCatalog,
    prepareDescriptors,
    dispose() {
      controller.dispose();
      destroyRoot();
    },
  };
}

describe('createTrendsController in a reactive client root', () => {
  it('keeps selected instruments subscribed with the Instruments instant policy', () => {
    const harness = setup();
    expect(harness.subscribe).toHaveBeenCalledWith([
      { path: 'path.depth', policy: 'instant', minPeriod: 1000 },
    ]);
    expect(harness.controller.selectedIds).toEqual(['depth']);
    harness.dispose();
  });

  it('preserves unavailable stored ids until the navigator removes them', () => {
    const harness = setup(['future-sensor']);
    expect(harness.controller.selected).toMatchObject([
      {
        id: 'future-sensor',
        unavailable: true,
        label: 'Unavailable instrument · future-sensor',
      },
    ]);
    expect(harness.unsubscribe).not.toHaveBeenCalled();
    harness.controller.toggle('future-sensor');
    expect(harness.selectionStore.value).toEqual([]);
    harness.dispose();
  });

  it('caps selection at eight without hiding a ninth catalog option', () => {
    const descriptors = Array.from({ length: 9 }, (_, index) => descriptor(`trend-${index}`));
    const harness = setup(
      descriptors.slice(0, 8).map((entry) => entry.id),
      descriptors,
    );
    expect(harness.controller.catalog).toHaveLength(9);
    harness.controller.toggle('trend-8');
    expect(harness.controller.selectedIds).toHaveLength(8);
    harness.dispose();
  });

  it('reconciles subscriptions after an external profile selection change', async () => {
    const harness = setup();
    harness.subscribe.mockClear();
    harness.selectionStore.set(['wind']);
    await tick();
    expect(harness.subscribe).toHaveBeenCalledWith([
      { path: 'path.wind', policy: 'instant', minPeriod: 1000 },
    ]);
    expect(harness.unsubscribe).toHaveBeenCalledWith(['path.depth']);
    harness.dispose();
  });

  it('adds one transient focus slot, replaces it, and leaves the saved selection alone', () => {
    const harness = setup();
    harness.subscribe.mockClear();
    expect(harness.controller.setFocus('wind')).toBe(true);
    expect(harness.controller.focusedTransient).toBe(true);
    expect(harness.controller.selectedIds).toEqual(['depth']);
    expect(harness.subscribe).toHaveBeenLastCalledWith([
      { path: 'path.wind', policy: 'instant', minPeriod: 1000 },
    ]);
    expect(harness.controller.sessionSeries('wind').startedAtSec).toBeTypeOf('number');

    harness.controller.setFocus('pressure');
    expect(harness.unsubscribe).toHaveBeenCalledWith(['path.wind']);
    expect(harness.subscribe).toHaveBeenLastCalledWith([
      { path: 'path.pressure', policy: 'instant', minPeriod: 1000 },
    ]);
    harness.controller.setFocus(undefined);
    expect(harness.unsubscribe).toHaveBeenLastCalledWith(['path.pressure']);
    harness.dispose();
  });

  it('keeps the focused session explanation and selected buffer stable across catalog changes', async () => {
    const depth = descriptor('depth');
    const wind = descriptor('wind');
    let available = true;
    const harness = setup(['depth'], [depth, wind], {
      getDescriptor: (id) =>
        available ? [depth, wind].find((entry) => entry.id === id) : undefined,
      getCatalog: () => (available ? [depth, wind] : []),
    });

    expect(harness.controller.setFocus('wind')).toBe(true);
    expect(harness.controller.focusedTransient).toBe(true);
    harness.selectionStore.set(['depth', 'wind']);
    await tick();
    expect(harness.controller.focusedTransient).toBe(true);

    harness.controller.setFocus(undefined);
    expect(harness.controller.setFocus('depth')).toBe(true);
    expect(harness.controller.focusedTransient).toBe(false);
    harness.selectionStore.set(['wind']);
    await tick();
    expect(harness.controller.focusedTransient).toBe(false);

    const startedAt = harness.controller.sessionSeries('wind').startedAtSec;
    available = false;
    harness.controller.setFocus(undefined);
    expect(harness.controller.sessionSeries('wind').startedAtSec).toBe(startedAt);
    harness.dispose();
  });

  it('discovers on open, replays demand after worker restart, and disposes all demand', () => {
    const harness = setup();
    harness.controller.setOpen(true);
    expect(harness.refreshCatalog).toHaveBeenCalledOnce();
    expect(harness.prepareDescriptors).toHaveBeenCalledWith(['depth']);

    harness.subscribe.mockClear();
    harness.controller.resubscribe();
    expect(harness.subscribe).toHaveBeenCalledWith([
      { path: 'path.depth', policy: 'instant', minPeriod: 1000 },
    ]);

    harness.controller.dispose();
    expect(harness.unsubscribe).toHaveBeenCalledWith(['path.depth']);
    harness.dispose();
  });
});
