import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersistedValue } from '$shared/settings/persisted.svelte';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { createInstrumentsController } from './instruments-controller.svelte';
import { ALL_CATALOG_PATHS, DEFAULT_TILES, tileById } from './tile-catalog';

// --- Helpers ---

function mustTile(id: string) {
  const def = tileById(id);
  if (!def) throw new Error(`Unknown tile id: ${id}`);
  return def;
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

function makeDeps() {
  const store = new SignalKStore();
  const subscribe = vi.fn();
  const unsubscribe = vi.fn();
  const tilesStore = new PersistedValue<string[]>(
    'binnacle:instrument-tiles',
    [...DEFAULT_TILES],
    fakeStorage(),
  );
  const openStore = new PersistedValue<boolean>('binnacle:instruments-open', false, fakeStorage());
  return {
    store,
    origin: 'http://sk',
    getToken: (): string | undefined => undefined,
    subscribe,
    unsubscribe,
    tilesStore,
    openStore,
  };
}

function selfFrame(self: Record<string, unknown>): SKFrame {
  return {
    self: new Map(Object.entries(self)),
    connection: { phase: 'open', attempt: 0 },
    epoch: Date.now(),
  };
}

// Advances past all pending microtasks (fetchPathMeta has several await hops).
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Tests ---

describe('createInstrumentsController', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Step 1 tests (written before implementation — RED phase)

  it('calls ensureCells with ALL_CATALOG_PATHS at construction, does not subscribe', () => {
    const deps = makeDeps();
    const spy = vi.spyOn(deps.store, 'ensureCells');
    const ctrl = createInstrumentsController(deps);
    expect(spy).toHaveBeenCalledWith(ALL_CATALOG_PATHS);
    expect(deps.subscribe).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  it('setOpen(true) subscribes selected deduped paths with policy instant and minPeriod 1000', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);

    expect(deps.subscribe).toHaveBeenCalledTimes(1);
    const entries = deps.subscribe.mock.calls[0][0] as Array<{
      path: string;
      policy: string;
      minPeriod: number;
    }>;
    expect(entries.every((e) => e.policy === 'instant' && e.minPeriod === 1000)).toBe(true);

    const expectedPaths = [...new Set(DEFAULT_TILES.flatMap((id) => mustTile(id).paths))].sort();
    expect(entries.map((e) => e.path).sort()).toEqual(expectedPaths);

    ctrl.dispose();
  });

  it('setOpen(false) after setOpen(true) unsubscribes the same paths', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    const subscribed = (deps.subscribe.mock.calls[0][0] as Array<{ path: string }>)
      .map((e) => e.path)
      .sort();

    ctrl.setOpen(false);
    expect(deps.unsubscribe).toHaveBeenCalledTimes(1);
    expect((deps.unsubscribe.mock.calls[0][0] as string[]).sort()).toEqual(subscribed);

    ctrl.dispose();
  });

  it('toggleTile while open subscribes new tile paths; toggling it off unsubscribes them', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);

    const subBefore = deps.subscribe.mock.calls.length;
    const unsubBefore = deps.unsubscribe.mock.calls.length;

    ctrl.toggleTile('stw');
    expect(deps.subscribe.mock.calls.length).toBe(subBefore + 1);
    const added = (deps.subscribe.mock.calls[subBefore][0] as Array<{ path: string }>).map(
      (e) => e.path,
    );
    expect(added).toEqual(mustTile('stw').paths);

    ctrl.toggleTile('stw');
    expect(deps.unsubscribe.mock.calls.length).toBe(unsubBefore + 1);
    expect(deps.unsubscribe.mock.calls[unsubBefore][0]).toEqual(mustTile('stw').paths);

    ctrl.dispose();
  });

  it('toggleTile while closed changes selection without subscribe or unsubscribe', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    expect(ctrl.open).toBe(false);
    ctrl.toggleTile('stw');
    expect(deps.subscribe).not.toHaveBeenCalled();
    expect(deps.unsubscribe).not.toHaveBeenCalled();
    expect(ctrl.selectedIds).toContain('stw');

    ctrl.dispose();
  });

  it('removing one tile does not unsubscribe paths a remaining selected tile still needs', () => {
    const deps = makeDeps();
    // sog: navigation.speedOverGround; stw: navigation.speedThroughWater — disjoint paths.
    deps.tilesStore.set(['sog', 'stw']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);

    const sogPaths = mustTile('sog').paths;
    const stwPaths = mustTile('stw').paths;
    const allSubscribed = (deps.subscribe.mock.calls[0][0] as Array<{ path: string }>).map(
      (e) => e.path,
    );
    expect(allSubscribed.sort()).toEqual([...sogPaths, ...stwPaths].sort());

    // Remove sog; stw is still selected, so stw's paths must stay subscribed.
    ctrl.toggleTile('sog');
    expect(deps.unsubscribe).toHaveBeenCalledTimes(1);
    const unsubbed = deps.unsubscribe.mock.calls[0][0] as string[];
    expect(unsubbed.sort()).toEqual([...sogPaths].sort());
    for (const p of stwPaths) {
      expect(unsubbed).not.toContain(p);
    }

    ctrl.dispose();
  });

  it('dispose after setOpen(true) unsubscribes all paths exactly once', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    const subPaths = (deps.subscribe.mock.calls[0][0] as Array<{ path: string }>)
      .map((e) => e.path)
      .sort();

    ctrl.dispose();
    expect(deps.unsubscribe).toHaveBeenCalledTimes(1);
    expect((deps.unsubscribe.mock.calls[0][0] as string[]).sort()).toEqual(subPaths);
  });

  it('fetches zone meta once per zonesPath on open, caches on second open', async () => {
    const zones = [{ upper: 3, state: 'alarm', message: 'Shallow' }];
    const fetchMock = vi.fn(async (url: string) =>
      (url as string).includes('belowTransducer')
        ? jsonResponse(200, { zones })
        : jsonResponse(404, {}),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const depthDef = mustTile('depth');
    // depth=2 < upper:3 → alarm zone
    expect(ctrl.zoneState(depthDef, 2)).toBe('alarm');
    // depth=10 outside zones → normal
    expect(ctrl.zoneState(depthDef, 10)).toBe('normal');

    // Close and re-open: must not refetch the same zonesPath.
    ctrl.setOpen(false);
    const callsBefore = fetchMock.mock.calls.filter(([u]: [string]) =>
      u.includes('belowTransducer'),
    ).length;
    ctrl.setOpen(true);
    await flushPromises();
    const callsAfter = fetchMock.mock.calls.filter(([u]: [string]) =>
      u.includes('belowTransducer'),
    ).length;
    expect(callsAfter).toBe(callsBefore);

    ctrl.dispose();
  });

  it('notification override: raised alarm notification returns alarm regardless of numeric band', () => {
    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    const depthDef = mustTile('depth');
    // No meta loaded and value well clear of any implicit zone → normal.
    expect(ctrl.zoneState(depthDef, 100)).toBe('normal');

    // Write a raised alarm under the depth zonesPath into the store mirror.
    deps.store.applyFrame(
      selfFrame({
        [`notifications.${depthDef.zonesPath}`]: { state: 'alarm', message: 'Shallow' },
      }),
    );

    // Notification override must fire even though no meta zones are loaded.
    expect(ctrl.zoneState(depthDef, 100)).toBe('alarm');

    ctrl.dispose();
  });

  it('selection persists to tilesStore; malformed stored value falls back to DEFAULT_TILES', () => {
    const map = new Map<string, string>([['binnacle:instrument-tiles', '"not-an-array"']]);
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    const tilesStore = new PersistedValue<string[]>(
      'binnacle:instrument-tiles',
      [...DEFAULT_TILES],
      storage,
    );
    const openStore = new PersistedValue<boolean>('binnacle:instruments-open', false, {
      getItem: () => null,
      setItem: () => {},
    });

    const ctrl = createInstrumentsController({
      store: new SignalKStore(),
      origin: 'http://sk',
      getToken: () => undefined,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      tilesStore,
      openStore,
    });

    // Malformed JSON → falls back to DEFAULT_TILES.
    expect([...ctrl.selectedIds]).toEqual([...DEFAULT_TILES]);

    // A valid toggle persists the new selection.
    ctrl.toggleTile('stw');
    expect(ctrl.selectedIds).toContain('stw');
    const stored = JSON.parse(map.get('binnacle:instrument-tiles') ?? '[]') as unknown;
    expect(stored).toContain('stw');

    ctrl.dispose();
  });

  it('tiles getter returns TileDef objects in the same order as selectedIds', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    expect(ctrl.tiles.map((t) => t.id)).toEqual([...ctrl.selectedIds]);
    ctrl.dispose();
  });

  it('reorderTile moves a tile to the requested slot', () => {
    const deps = makeDeps();
    deps.tilesStore.set(['sog', 'depth', 'stw']);
    const ctrl = createInstrumentsController(deps);

    ctrl.reorderTile('sog', 2);
    expect([...ctrl.selectedIds]).toEqual(['depth', 'stw', 'sog']);

    ctrl.dispose();
  });
});
