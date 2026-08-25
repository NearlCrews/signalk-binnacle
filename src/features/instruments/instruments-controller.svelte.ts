import { untrack } from 'svelte';
import type { InstrumentTrendDescriptor } from '$entities/instrument-trend';
import { hasControlCharacters } from '$shared/lib';
import type { PersistedValue } from '$shared/settings';
import {
  createPathMetaCache,
  type HistoryProviders,
  type SignalKStore,
  type SubscribeEntry,
  type ZoneState,
  zoneStateFor,
} from '$shared/signalk';
import {
  discoverHistoricalInstrumentInstances,
  discoverInstrumentInstances,
  type InstrumentInstances,
} from './instance-discovery';

type InstrumentHistoryStatus =
  | 'idle'
  | 'checking'
  | 'scanning'
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'failed';

import {
  ALL_CATALOG_PATHS,
  batteryDefsFor,
  CLIENT_DEFAULT_ZONES,
  DEFAULT_TILES,
  insideDefsFor,
  minPeriodFor,
  propulsionDefsFor,
  solarDefsFor,
  TILE_CATALOG,
  type TileDef,
  tankDefsFor,
  tileById,
  trendDescriptorFor,
} from './tile-catalog';

export interface InstrumentsDeps {
  store: SignalKStore;
  origin: string;
  getToken: () => string | undefined;
  getHistoryProviders: () => HistoryProviders | undefined;
  getHistoryProviderState: () => 'checking' | 'retrying' | 'available' | 'absent' | 'failed';
  subscribe: (entries: SubscribeEntry[]) => void;
  unsubscribe: (paths: string[]) => void;
  tilesStore: PersistedValue<string[]>;
  openStore: PersistedValue<boolean>;
}

export interface InstrumentsController {
  readonly open: boolean;
  readonly tiles: TileDef[];
  readonly selectedIds: readonly string[];
  // The full catalog available in Customize mode: static tiles plus discovered Signal K instances.
  readonly catalog: TileDef[];
  readonly discovering: boolean;
  readonly historyStatus: InstrumentHistoryStatus;
  readonly trendCatalog: readonly InstrumentTrendDescriptor[];
  isHistoricalOnly(id: string): boolean;
  isLiveDiscovered(id: string): boolean;
  trendDescriptor(id: string): InstrumentTrendDescriptor | undefined;
  prepareTrendDescriptors(ids: readonly string[]): void;
  toggleOpen(): void;
  setOpen(open: boolean): void;
  toggleTile(id: string): void;
  reorderTile(id: string, slot: number): void;
  refreshCatalog(): void;
  refreshLiveCatalog(): void;
  // The name to show for a tile: the server's meta displayName when it is usable, else the catalog label.
  resolvedLabel(def: TileDef): string;
  zoneState(def: TileDef, value: number | undefined): ZoneState;
  resubscribe(): void;
  dispose(): void;
}

export function createInstrumentsController(deps: InstrumentsDeps): InstrumentsController {
  const MAX_SELECTED_TILES = 100;
  deps.store.ensureCells(ALL_CATALOG_PATHS);
  // Every instrument path is watch-critical: trace source handoffs for the detail's source cue.
  deps.store.traceSources(ALL_CATALOG_PATHS);

  // Handing the store in lets meta settling carry each path's declared staleness window onto its
  // cell, so grade() honors a legitimately slow sensor's own meta.timeout instead of the
  // ten-second default.
  const metaCache = createPathMetaCache(deps.origin, deps.getToken, deps.store);
  const dynamicDefCache = new Map<string, TileDef[]>();

  // Dynamic definitions discovered from the live model and the optional history path catalog.
  // Replace-only (assigned wholesale, never mutated in place), so raw state skips deep proxy wrapping.
  let liveCatalog = $state.raw<TileDef[]>([]);
  let historicalCatalog = $state.raw<TileDef[]>([]);
  let dynamicCatalog = $state.raw<TileDef[]>([]);
  let historicalOnlyIds = $state.raw<Set<string>>(new Set());
  let liveDiscoveredIds = $state.raw<Set<string>>(new Set());
  let historyStatus = $state<InstrumentHistoryStatus>('idle');
  let discoveryDone = false;
  let liveDiscovering = $state(false);
  let historyDiscovering = $state(false);
  let liveDiscoveryGeneration = 0;
  let historyDiscoveryGeneration = 0;
  let historyDiscoveryAbort: AbortController | undefined;
  // A history scan asked for while the provider probe was still in flight. Plain, not $state: the
  // probe watcher below reads it untracked, so it must not enlarge that effect's dependency set.
  let historyScanArmed = false;
  let disposed = false;

  // Tracks which paths are currently subscribed via deps.subscribe, so syncSubscriptions can
  // diff desired against live and issue only the delta.
  const subscribedPaths = new Set<string>();

  function resolveSelectedIds(): string[] {
    const raw = deps.tilesStore.value;
    // Runtime guard: PersistedValue without a validator can hold any JSON shape if storage drifted.
    if (!Array.isArray(raw)) return [...DEFAULT_TILES];
    const seen = new Set<string>();
    const valid: string[] = [];
    for (const id of raw) {
      if (typeof id !== 'string' || seen.has(id) || tileById(id) === undefined) continue;
      seen.add(id);
      valid.push(id);
      if (valid.length >= MAX_SELECTED_TILES) break;
    }
    return valid;
  }

  function resolveTiles(): TileDef[] {
    return resolveSelectedIds().flatMap((id) => {
      const def = tileById(id);
      return def ? [def] : [];
    });
  }

  // Memoized derived values so the resolution runs once per dependency change rather than on
  // every getter access. A plain getter would re-run resolveTiles/resolveSelectedIds each time a
  // reactive consumer reads it (template plus effects), which is redundant for small-but-not-free work.
  const selectedIds = $derived.by<readonly string[]>(() => resolveSelectedIds());
  const tiles = $derived.by<TileDef[]>(() =>
    selectedIds.flatMap((id) => {
      const def = tileById(id);
      return def ? [def] : [];
    }),
  );

  // Shared paths (two tiles using the same path) are deduplicated naturally: the desired set is a
  // union, and removal only drops paths absent from the new union.
  function syncSubscriptions(): void {
    const desired =
      deps.openStore.value === true
        ? new Set(resolveTiles().flatMap((def) => def.paths))
        : new Set<string>();

    const toAdd = [...desired].filter((p) => !subscribedPaths.has(p));
    const toRemove = [...subscribedPaths].filter((p) => !desired.has(p));

    if (toAdd.length > 0) {
      deps.subscribe(
        toAdd.map((path) => ({ path, policy: 'instant', minPeriod: minPeriodFor(path) })),
      );
      for (const p of toAdd) subscribedPaths.add(p);
    }
    if (toRemove.length > 0) {
      deps.unsubscribe(toRemove);
      for (const p of toRemove) subscribedPaths.delete(p);
    }
  }

  function fetchMetaForSelected(): void {
    for (const def of resolveTiles()) metaCache.load(def.zonesPath);
  }

  // Runs once per controller construction when the dock is first opened and remains user-refreshable.
  function cachedDefs(family: string, id: string, create: () => TileDef[]): TileDef[] {
    const key = `${family}:${id}`;
    let defs = dynamicDefCache.get(key);
    if (!defs) {
      defs = create();
      dynamicDefCache.set(key, defs);
    }
    return defs;
  }

  function defsForInstances(instances: InstrumentInstances): TileDef[] {
    return [
      ...instances.batteries.flatMap((id) => cachedDefs('battery', id, () => batteryDefsFor(id))),
      ...instances.propulsion.flatMap((id) =>
        cachedDefs('propulsion', id, () => propulsionDefsFor(id)),
      ),
      ...instances.tanks.flatMap((id) => cachedDefs('tank', id, () => tankDefsFor(id))),
      ...instances.solar.flatMap((id) => cachedDefs('solar', id, () => solarDefsFor(id))),
      ...instances.inside.flatMap((id) => cachedDefs('inside', id, () => insideDefsFor(id))),
    ];
  }

  function defsForObservedPaths(instances: InstrumentInstances): TileDef[] {
    const paths = new Set(instances.paths);
    return defsForInstances(instances).filter((def) => def.paths.some((path) => paths.has(path)));
  }

  function rebuildDynamicCatalog(): void {
    const liveIds = new Set(liveCatalog.map((def) => def.id));
    const historicalOnly = historicalCatalog.filter((def) => !liveIds.has(def.id));
    dynamicCatalog = [...liveCatalog, ...historicalOnly];
    historicalOnlyIds = new Set(historicalOnly.map((def) => def.id));
    liveDiscoveredIds = liveIds;
    const dynamicPaths = dynamicCatalog.flatMap((def) => def.paths);
    deps.store.ensureCells(dynamicPaths);
    deps.store.traceSources(dynamicPaths);
  }

  function familyForDef(def: TileDef): keyof Omit<InstrumentInstances, 'paths'> | undefined {
    if (def.id.startsWith('battery')) return 'batteries';
    if (def.id.startsWith('prop-')) return 'propulsion';
    if (def.id.startsWith('tank-')) return 'tanks';
    if (def.id.startsWith('solar-')) return 'solar';
    if (def.id.startsWith('inside-')) return 'inside';
    return undefined;
  }

  function discover(refresh = false, includeHistory = true): void {
    if (discoveryDone && !refresh) return;
    discoveryDone = true;
    const token = deps.getToken();
    const liveGeneration = ++liveDiscoveryGeneration;
    liveDiscovering = true;
    void discoverInstrumentInstances(deps.origin, token)
      .then((live) => {
        if (disposed || liveGeneration !== liveDiscoveryGeneration) return;
        const failed = new Set(live.failedFamilies);
        const retained = liveCatalog.filter((def) => {
          const family = familyForDef(def);
          return family !== undefined && failed.has(family);
        });
        liveCatalog = [...retained, ...defsForObservedPaths(live)];
        rebuildDynamicCatalog();
        syncSubscriptions();
        if (deps.openStore.value === true) fetchMetaForSelected();
      })
      .finally(() => {
        if (!disposed && liveGeneration === liveDiscoveryGeneration) liveDiscovering = false;
      });

    if (includeHistory) scanHistory();
  }

  function scanHistory(): void {
    const historyGeneration = ++historyDiscoveryGeneration;
    historyDiscoveryAbort?.abort();
    historyDiscoveryAbort = undefined;
    const providerState = deps.getHistoryProviderState();
    const providers = deps.getHistoryProviders();
    if (providerState === 'checking' || providerState === 'retrying') {
      // The probe is still in flight. Arm it instead of scanning against an unknown provider set,
      // so the settle runs the scan and the panel does not sit on "Checking" until someone
      // happens to press Rescan.
      historyStatus = 'checking';
      historyDiscovering = false;
      historyScanArmed = true;
      return;
    }
    historyScanArmed = false;
    if (providerState !== 'available' || !providers || providers.ids.length === 0) {
      historyStatus = providerState === 'failed' ? 'failed' : 'unavailable';
      historyDiscovering = false;
      if (providerState === 'absent') {
        historicalCatalog = [];
        rebuildDynamicCatalog();
      }
      return;
    }
    const abort = new AbortController();
    historyDiscoveryAbort = abort;
    historyStatus = 'scanning';
    historyDiscovering = true;
    void discoverHistoricalInstrumentInstances(
      deps.origin,
      deps.getToken(),
      providers,
      abort.signal,
    )
      .then(
        (result) => {
          if (disposed || historyGeneration !== historyDiscoveryGeneration) return;
          historyStatus = result.state;
          const next = defsForObservedPaths(result.instances);
          historicalCatalog =
            result.state === 'complete'
              ? next
              : [...new Map([...historicalCatalog, ...next].map((def) => [def.id, def])).values()];
          rebuildDynamicCatalog();
        },
        () => {
          if (!disposed && historyGeneration === historyDiscoveryGeneration) {
            historyStatus = 'failed';
          }
        },
      )
      .finally(() => {
        if (!disposed && historyGeneration === historyDiscoveryGeneration) {
          historyDiscovering = false;
          if (historyDiscoveryAbort === abort) historyDiscoveryAbort = undefined;
        }
      });
  }

  function refreshCatalog(): void {
    discover(true);
  }

  function refreshLiveCatalog(): void {
    // Also drop cached path meta: zones and a declared staleness window are server state an admin
    // can change mid-session, and a cached answer would outlive the change for the whole session.
    metaCache.refresh();
    discover(true, false);
  }

  function setOpen(open: boolean): void {
    deps.openStore.set(open);
    syncSubscriptions();
    if (open) {
      fetchMetaForSelected();
      discover();
    }
  }

  function toggleOpen(): void {
    setOpen(!deps.openStore.value);
  }

  function toggleTile(id: string): void {
    const def = tileById(id);
    if (!def) return;
    // Create the cells here, in event context, before the tile's first template read: a cell
    // whose $state is created during that read is untracked and never re-renders (the dynamic
    // battery defs are not in ALL_CATALOG_PATHS, so nothing else pre-creates theirs).
    deps.store.ensureCells(def.paths);
    deps.store.traceSources(def.paths);
    const current = resolveSelectedIds();
    const idx = current.indexOf(id);
    if (idx < 0 && current.length >= MAX_SELECTED_TILES) return;
    const next = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, id];
    deps.tilesStore.set(next);
    syncSubscriptions();
    if (deps.openStore.value) fetchMetaForSelected();
  }

  function reorderTile(id: string, slot: number): void {
    const current = resolveSelectedIds();
    const idx = current.indexOf(id);
    if (idx < 0) return;
    const next = [...current];
    next.splice(idx, 1);
    const clamped = Math.max(0, Math.min(slot, next.length));
    next.splice(clamped, 0, id);
    deps.tilesStore.set(next);
  }

  // A boat that renamed a path on the server should see that name on the tile. The value is
  // provider-controlled, so it is trimmed, rejected when blank or carrying control characters, and
  // capped: a long name would push the numeric readout out of the tile.
  const MAX_LABEL_LENGTH = 80;

  function resolvedLabel(def: TileDef): string {
    // Read the version counter first so a reactive caller re-evaluates once a fetch resolves; the
    // meta cache itself is a plain Map.
    void metaCache.version;
    const name = metaCache.get(def.zonesPath)?.displayName?.trim();
    if (!name || name.length > MAX_LABEL_LENGTH || hasControlCharacters(name)) return def.label;
    return name;
  }

  function availableTrendDef(id: string): TileDef | undefined {
    return (
      TILE_CATALOG.find((entry) => entry.id === id) ??
      dynamicCatalog.find((entry) => entry.id === id)
    );
  }

  function trendDescriptor(id: string): InstrumentTrendDescriptor | undefined {
    // tileById deliberately reconstructs syntactically valid persisted dynamic tiles before
    // discovery so the Instruments dock can preserve its own selection. Trends has a stricter
    // availability contract: a stored dynamic id stays unavailable until live or historical
    // discovery confirms that instrument on this server.
    const def = availableTrendDef(id);
    return def ? trendDescriptorFor(def, resolvedLabel(def)) : undefined;
  }

  function prepareTrendDescriptors(ids: readonly string[]): void {
    for (const id of ids) {
      const def = availableTrendDef(id);
      if (def?.trend) metaCache.load(def.zonesPath);
    }
  }

  function zoneState(def: TileDef, value: number | undefined): ZoneState {
    // Read reactive version counters so a template $derived re-evaluates after fetches and notifications.
    void metaCache.version;
    void deps.store.notificationsVersion;
    const notification = deps.store.notifications.get(`notifications.${def.zonesPath}`);
    if (notification !== undefined) return 'alarm';
    const cached = metaCache.get(def.zonesPath);
    if (cached?.zones?.length) return zoneStateFor(value, cached.zones);
    // Server zones win whenever they are known. In every other state, never fetched, in flight,
    // awaiting a retry, or given up, the client defaults (shallow-depth safety bands for a stock
    // server with no configured zones) stand in: a transient fetch failure must not strip a depth
    // tile of its safety banding.
    return zoneStateFor(value, CLIENT_DEFAULT_ZONES.get(def.zonesPath));
  }

  // The dock can be opened, or restored open, while the history-provider probe is still running.
  // Watch the probe and run the armed scan the moment it settles. $effect.root, not a bare $effect:
  // the controller is a plain factory, constructed outside a component by its own tests.
  const stopProbeWatch = $effect.root(() => {
    $effect(() => {
      const state = deps.getHistoryProviderState();
      if (state === 'checking' || state === 'retrying') return;
      untrack(() => {
        if (historyScanArmed && !disposed) scanHistory();
      });
    });
  });

  function dispose(): void {
    disposed = true;
    stopProbeWatch();
    liveDiscoveryGeneration += 1;
    historyDiscoveryGeneration += 1;
    historyDiscoveryAbort?.abort();
    historyDiscoveryAbort = undefined;
    if (subscribedPaths.size > 0) {
      deps.unsubscribe([...subscribedPaths]);
      subscribedPaths.clear();
    }
  }

  // A Signal K worker recreated after an initial chunk failure has a fresh subscription registry.
  // Forget the old worker's bookkeeping and replay the current dock demand into the new registry.
  function resubscribe(): void {
    subscribedPaths.clear();
    syncSubscriptions();
  }

  // Pre-create cells for the persisted selection too: it can hold dynamic battery ids that
  // ALL_CATALOG_PATHS does not cover, and their first read must find a tracked cell.
  const selectedPaths = resolveTiles().flatMap((def) => def.paths);
  deps.store.ensureCells(selectedPaths);
  deps.store.traceSources(selectedPaths);

  // Restore subscriptions, meta, and discovery if the dock was persisted open before construction.
  syncSubscriptions();
  if (deps.openStore.value === true) {
    fetchMetaForSelected();
    discover();
  }

  // Memoized rather than rebuilt per read: both are read from templates that re-evaluate on any
  // reactive change, and each read otherwise allocated a fresh array of the whole catalog (and, for
  // the trend list, re-resolved every label). $derived.by recomputes only when dynamicCatalog or a
  // label input actually changes.
  const catalog = $derived.by(() => [...TILE_CATALOG, ...dynamicCatalog]);
  const trendCatalog = $derived.by(() =>
    catalog.flatMap((def) => {
      if (!def.trend) return [];
      const descriptor = trendDescriptorFor(def, resolvedLabel(def));
      return descriptor ? [descriptor] : [];
    }),
  );

  return {
    get open() {
      return deps.openStore.value === true;
    },
    get tiles() {
      return tiles;
    },
    get selectedIds() {
      return selectedIds;
    },
    get catalog(): TileDef[] {
      return catalog;
    },
    get discovering() {
      return liveDiscovering || historyDiscovering;
    },
    get historyStatus() {
      return historyStatus;
    },
    get trendCatalog() {
      return trendCatalog;
    },
    isHistoricalOnly(id: string): boolean {
      return historicalOnlyIds.has(id);
    },
    isLiveDiscovered(id: string): boolean {
      return liveDiscoveredIds.has(id);
    },
    trendDescriptor,
    prepareTrendDescriptors,
    toggleOpen,
    setOpen,
    toggleTile,
    reorderTile,
    refreshCatalog,
    refreshLiveCatalog,
    resolvedLabel,
    zoneState,
    resubscribe,
    dispose,
  };
}
