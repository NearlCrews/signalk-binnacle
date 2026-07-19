import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersistedValue } from '$shared/settings';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import { jsonResponse } from '$shared/testing';
import { createInstrumentsController } from './instruments-controller.svelte';
import { ALL_CATALOG_PATHS, DEFAULT_TILES, minPeriodFor, tileById } from './tile-catalog';

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

function makeDeps(opts: { tiles?: string[] } = {}) {
  const store = new SignalKStore();
  const subscribe = vi.fn();
  const unsubscribe = vi.fn();
  const tilesStore = new PersistedValue<string[]>(
    'binnacle:instrument-tiles',
    opts.tiles ?? [...DEFAULT_TILES],
    fakeStorage(),
  );
  const openStore = new PersistedValue<boolean>('binnacle:instruments-open', false, fakeStorage());
  return {
    store,
    origin: 'http://sk',
    getToken: (): string | undefined => undefined,
    getHistoryProviders: () => undefined,
    getHistoryProviderState: () => 'absent' as const,
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

  // Step 1 tests (written before implementation: RED phase)

  it('calls ensureCells with ALL_CATALOG_PATHS at construction, does not subscribe', () => {
    const deps = makeDeps();
    const spy = vi.spyOn(deps.store, 'ensureCells');
    const ctrl = createInstrumentsController(deps);
    expect(spy).toHaveBeenCalledWith(ALL_CATALOG_PATHS);
    expect(deps.subscribe).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  it('pre-creates cells for persisted dynamic battery ids at construction', () => {
    // A cell first created during a template read is untracked and never re-renders, so the
    // persisted selection's dynamic paths must be ensured before the first render.
    const deps = makeDeps({ tiles: ['sog', 'battery-soc:console'] });
    const spy = vi.spyOn(deps.store, 'ensureCells');
    const ctrl = createInstrumentsController(deps);
    const ensured = spy.mock.calls.flatMap((call) => call[0]);
    expect(ensured).toContain('electrical.batteries.console.capacity.stateOfCharge');
    ctrl.dispose();
  });

  it('toggleTile ensures the cells of the added tile before selecting it', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    const spy = vi.spyOn(deps.store, 'ensureCells');
    ctrl.toggleTile('battery-time:console');
    const ensured = spy.mock.calls.flatMap((call) => call[0]);
    expect(ensured).toContain('electrical.batteries.console.capacity.timeRemaining');
    ctrl.dispose();
  });

  it('setOpen(true) subscribes selected deduped paths with policy instant and per-path minPeriod', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);

    expect(deps.subscribe).toHaveBeenCalledTimes(1);
    const entries = deps.subscribe.mock.calls[0][0] as Array<{
      path: string;
      policy: string;
      minPeriod: number;
    }>;
    expect(entries.every((e) => e.policy === 'instant')).toBe(true);
    expect(entries.every((e) => e.minPeriod === minPeriodFor(e.path))).toBe(true);

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
    // sog: navigation.speedOverGround; stw: navigation.speedThroughWater: disjoint paths.
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
      (url as string).includes('belowKeel') ? jsonResponse(200, { zones }) : jsonResponse(404, {}),
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

    expect(fetchMock.mock.calls.some(([u]: [string]) => u.includes('belowKeel'))).toBe(true);

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
      getHistoryProviders: () => undefined,
      getHistoryProviderState: () => 'absent',
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

  it('construction with openStore true subscribes selected paths and fetches meta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );

    const deps = makeDeps();
    deps.openStore.set(true);
    const ctrl = createInstrumentsController(deps);

    expect(deps.subscribe).toHaveBeenCalledTimes(1);
    const entries = deps.subscribe.mock.calls[0][0] as Array<{ path: string }>;
    const expectedPaths = [...new Set(DEFAULT_TILES.flatMap((id) => mustTile(id).paths))].sort();
    expect(entries.map((e) => e.path).sort()).toEqual(expectedPaths);

    await flushPromises();
    expect(vi.mocked(fetch)).toHaveBeenCalled();

    ctrl.dispose();
  });

  it('meta fetch with no token removes sentinel so a later open with token retries', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    let token: string | undefined;
    const deps = { ...makeDeps(), getToken: () => token };
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    ctrl.setOpen(false);

    token = 'valid-token';
    ctrl.setOpen(true);
    await flushPromises();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);

    ctrl.dispose();
  });

  it('battery discovery is called on first open, catalog includes discovered instances', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if ((url as string).includes('electrical/batteries')) {
          return jsonResponse(200, { house: { voltage: {} }, starter: { voltage: {} } });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    // Before open: static catalog only.
    const staticCount = ctrl.catalog.length;

    ctrl.setOpen(true);
    await flushPromises();

    // Only concrete live paths are offered, not every possible reading for the instance.
    expect(ctrl.catalog.length).toBe(staticCount + 2);
    expect(ctrl.catalog.some((d) => d.id === 'battery:house')).toBe(true);
    expect(ctrl.catalog.some((d) => d.id === 'battery-soc:house')).toBe(false);
    expect(ctrl.catalog.some((d) => d.id === 'battery-time:house')).toBe(false);
    expect(ctrl.catalog.some((d) => d.id === 'battery-current:house')).toBe(false);
    expect(ctrl.catalog.some((d) => d.id === 'battery:starter')).toBe(true);

    ctrl.dispose();
  });

  it('battery discovery runs only once per construction even across multiple opens', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if ((url as string).includes('electrical/batteries')) {
        return jsonResponse(200, { house: { voltage: {} } });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();
    ctrl.setOpen(false);
    ctrl.setOpen(true);
    await flushPromises();

    const batteryCalls = fetchMock.mock.calls.filter(([u]: [string]) =>
      u.includes('electrical/batteries'),
    ).length;
    expect(batteryCalls).toBe(1);

    ctrl.dispose();
  });

  it('retains accepted live instances when a rescan has transport failures', async () => {
    let failing = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (failing) throw new TypeError('network down');
        if (url.includes('electrical/batteries')) {
          return jsonResponse(200, { house: { voltage: {} } });
        }
        return jsonResponse(404, {});
      }),
    );
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'battery:house')).toBe(true);

    failing = true;
    ctrl.refreshCatalog();
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'battery:house')).toBe(true);
    ctrl.dispose();
  });

  it('updates successful live families while retaining a failed family', async () => {
    let secondScan = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('electrical/batteries')) {
          return jsonResponse(200, {
            [secondScan ? 'starter' : 'house']: { voltage: {} },
          });
        }
        if (url.endsWith('/propulsion')) {
          if (secondScan) throw new TypeError('engine branch offline');
          return jsonResponse(200, { port: { revolutions: {} } });
        }
        return jsonResponse(404, {});
      }),
    );
    const ctrl = createInstrumentsController(makeDeps());
    ctrl.setOpen(true);
    await flushPromises();
    secondScan = true;
    ctrl.refreshLiveCatalog();
    await flushPromises();

    expect(ctrl.catalog.some((def) => def.id === 'battery:starter')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'battery:house')).toBe(false);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    ctrl.dispose();
  });

  it('ensures store cells for discovered instance paths when discovery lands', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('electrical/batteries')) {
          return jsonResponse(200, { house: { voltage: {} } });
        }
        if (url.endsWith('/propulsion')) return jsonResponse(200, { port: { revolutions: {} } });
        if (url.endsWith('/tanks')) {
          return jsonResponse(200, { freshWater: { main: { currentLevel: {} } } });
        }
        if (url.endsWith('/electrical/solar')) {
          return jsonResponse(200, { arch: { panelPower: {} } });
        }
        if (url.endsWith('/environment/inside')) {
          return jsonResponse(200, { cabin: { temperature: {} } });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = makeDeps();
    const spy = vi.spyOn(deps.store, 'ensureCells');
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const ensured = spy.mock.calls.flatMap((call) => call[0]);
    expect(ensured).toContain('electrical.batteries.house.voltage');
    expect(ensured).toContain('propulsion.port.revolutions');
    expect(ensured).toContain('tanks.freshWater.main.currentLevel');
    expect(ensured).toContain('electrical.solar.arch.panelPower');
    expect(ensured).toContain('environment.inside.cabin.temperature');
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'tank-level:freshWater.main')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'solar-power:arch')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'inside-temp:cabin')).toBe(true);

    ctrl.dispose();
  });

  it('offers historically seen readings without treating them as live', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/history/paths?')) {
          return jsonResponse(200, ['propulsion.port.revolutions', 'propulsion.port.engineLoad']);
        }
        if (url.includes('/history/values?')) {
          return jsonResponse(200, {
            range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
            values: [
              { path: 'propulsion.port.revolutions' },
              { path: 'propulsion.port.engineLoad' },
            ],
            data: [['2026-07-01T00:00:00Z', 20, 0.4]],
          });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = {
      ...makeDeps(),
      getHistoryProviders: () => ({ ids: ['signalk-questdb'] }),
      getHistoryProviderState: () => 'available' as const,
    };
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    await flushPromises();

    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-load:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-temp:port')).toBe(false);
    expect(ctrl.isHistoricalOnly('prop-rpm:port')).toBe(true);
    expect(deps.store.cell('propulsion.port.revolutions').epoch).toBe(0);

    ctrl.dispose();
  });

  it('keeps the newest catalog when an older anonymous history scan finishes later', async () => {
    let token: string | undefined;
    let anonymousSignal: AbortSignal | undefined;
    let resolveAnonymousPaths: (() => void) | undefined;
    const anonymousPathsReady = new Promise<void>((resolve) => {
      resolveAnonymousPaths = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/history/paths?')) {
          const authorization = (init?.headers as Record<string, string> | undefined)
            ?.Authorization;
          if (!authorization) {
            anonymousSignal = init?.signal ?? undefined;
            await anonymousPathsReady;
            return jsonResponse(200, ['propulsion.old.revolutions']);
          }
          return jsonResponse(200, ['propulsion.current.revolutions']);
        }
        if (url.includes('/history/values?')) {
          const authorization = (init?.headers as Record<string, string> | undefined)
            ?.Authorization;
          const path = authorization
            ? 'propulsion.current.revolutions'
            : 'propulsion.old.revolutions';
          return jsonResponse(200, {
            range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
            values: [{ path }],
            data: [['2026-07-01T00:00:00Z', 20]],
          });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = {
      ...makeDeps(),
      getToken: () => token,
      getHistoryProviders: () => ({ ids: ['signalk-questdb'] }),
      getHistoryProviderState: () => 'available' as const,
    };
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    token = 'approved';
    ctrl.refreshCatalog();
    await flushPromises();

    expect(anonymousSignal?.aborted).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:current')).toBe(true);
    resolveAnonymousPaths?.();
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:current')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:old')).toBe(false);

    ctrl.dispose();
  });

  it('merges new paths into accepted history when another provider fails', async () => {
    let secondScan = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/history/paths?') && url.includes('provider=kip')) {
          return jsonResponse(501, {});
        }
        if (url.includes('/history/paths?')) {
          return jsonResponse(200, [
            secondScan ? 'propulsion.starboard.revolutions' : 'propulsion.port.revolutions',
          ]);
        }
        if (url.includes('/history/values?')) {
          const path = secondScan
            ? 'propulsion.starboard.revolutions'
            : 'propulsion.port.revolutions';
          return jsonResponse(200, {
            range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
            values: [{ path }],
            data: [['2026-07-01T00:00:00Z', 20]],
          });
        }
        return jsonResponse(404, {});
      }),
    );
    const providers = () => ({
      ids: secondScan ? ['signalk-questdb', 'kip'] : ['signalk-questdb'],
    });
    const deps = {
      ...makeDeps(),
      getHistoryProviders: providers,
      getHistoryProviderState: () => 'available' as const,
    };
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);

    secondScan = true;
    ctrl.refreshCatalog();
    await flushPromises();
    expect(ctrl.historyStatus).toBe('partial');
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:starboard')).toBe(true);
    ctrl.dispose();
  });

  it("a selected 'battery:house' tile subscribes its voltage path while open", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['battery:house']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const entries = deps.subscribe.mock.calls.flat(2) as { path: string }[];
    expect(entries.some((e) => e.path === 'electrical.batteries.house.voltage')).toBe(true);

    ctrl.dispose();
  });

  it('zoneState falls back to CLIENT_DEFAULT_ZONES depth bands when the server meta has no zones', async () => {
    // Meta resolves (200) but carries no zones, the stock-server case.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/meta') ? jsonResponse(200, { units: 'm' }) : jsonResponse(404, {}),
      ),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const depthDef = mustTile('depth');
    // depth 1.5 m < 2 m upper → alarm; depth 3 m inside [2, 5) warn → warning; 10 m outside → normal
    expect(ctrl.zoneState(depthDef, 1.5)).toBe('alarm');
    expect(ctrl.zoneState(depthDef, 3)).toBe('warning');
    expect(ctrl.zoneState(depthDef, 10)).toBe('normal');

    ctrl.dispose();
  });

  it('zoneState stays normal when the token-less meta fetch failed and awaits a retry', async () => {
    // A 404 without a token removes the cache entry so a later authorized open can retry;
    // until then the client defaults are withheld.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    expect(ctrl.zoneState(mustTile('depth'), 1.5)).toBe('normal');

    ctrl.dispose();
  });

  it('server meta zones override client default zones', async () => {
    // Server says: only warn above 10 m (atypical; just verifies server wins over client defaults).
    const serverZones = [{ lower: 10, upper: 20, state: 'warn' }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if ((url as string).includes('belowKeel')) {
          return jsonResponse(200, { zones: serverZones });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const depthDef = mustTile('depth');
    // Client default would fire alarm at 1.5 m, but server zones say only warn above 10 m.
    expect(ctrl.zoneState(depthDef, 1.5)).toBe('normal');
    expect(ctrl.zoneState(depthDef, 15)).toBe('warning');

    ctrl.dispose();
  });
});
