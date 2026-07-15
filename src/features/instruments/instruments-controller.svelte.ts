import type { PersistedValue } from '$shared/settings';
import {
  fetchPathMeta,
  type HistoryProviders,
  type PathMeta,
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
  isHistoricalOnly(id: string): boolean;
  isLiveDiscovered(id: string): boolean;
  toggleOpen(): void;
  setOpen(open: boolean): void;
  toggleTile(id: string): void;
  reorderTile(id: string, slot: number): void;
  refreshCatalog(): void;
  refreshLiveCatalog(): void;
  zoneState(def: TileDef, value: number | undefined): ZoneState;
  resubscribe(): void;
  dispose(): void;
}

export function createInstrumentsController(deps: InstrumentsDeps): InstrumentsController {
  const MAX_SELECTED_TILES = 100;
  deps.store.ensureCells(ALL_CATALOG_PATHS);

  // Per-zonesPath meta cache: null means "fetch attempted, no zones found"; absent means "not yet fetched".
  const metaCache = new Map<string, PathMeta | null>();
  const dynamicDefCache = new Map<string, TileDef[]>();
  // Bumped after each fetch resolves so a reactive caller of zoneState re-evaluates.
  let metaVersion = $state(0);

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
  const tiles = $derived.by<TileDef[]>(() => resolveTiles());

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

  // Token is read at call time so a rotating token is always current.
  function fetchMetaForSelected(): void {
    for (const def of resolveTiles()) {
      const { zonesPath } = def;
      if (metaCache.has(zonesPath)) continue;
      const token = deps.getToken();
      // Sentinel before the async call: prevents a second fetch while the first is in flight.
      metaCache.set(zonesPath, null);
      void fetchPathMeta(deps.origin, token, zonesPath).then((result) => {
        if (result !== undefined) {
          metaCache.set(zonesPath, result);
        } else if (token !== undefined) {
          // Fetched with a token and still got nothing: permanently cache the null sentinel.
          metaCache.set(zonesPath, null);
        } else {
          // Fetched without a token (likely a 401 before auth). Remove the sentinel so a later
          // open after the user grants access can retry.
          metaCache.delete(zonesPath);
        }
        metaVersion += 1;
      });
    }
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
    deps.store.ensureCells(dynamicCatalog.flatMap((def) => def.paths));
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

    if (includeHistory) {
      const historyGeneration = ++historyDiscoveryGeneration;
      historyDiscoveryAbort?.abort();
      historyDiscoveryAbort = undefined;
      const providerState = deps.getHistoryProviderState();
      const providers = deps.getHistoryProviders();
      if (providerState === 'checking' || providerState === 'retrying') {
        historyStatus = 'checking';
        historyDiscovering = false;
      } else if (providerState !== 'available' || !providers || providers.ids.length === 0) {
        historyStatus = providerState === 'failed' ? 'failed' : 'unavailable';
        historyDiscovering = false;
        if (providerState === 'absent') {
          historicalCatalog = [];
          rebuildDynamicCatalog();
        }
      } else {
        const abort = new AbortController();
        historyDiscoveryAbort = abort;
        historyStatus = 'scanning';
        historyDiscovering = true;
        void discoverHistoricalInstrumentInstances(deps.origin, token, providers, abort.signal)
          .then(
            (result) => {
              if (disposed || historyGeneration !== historyDiscoveryGeneration) return;
              historyStatus = result.state;
              const next = defsForObservedPaths(result.instances);
              historicalCatalog =
                result.state === 'complete'
                  ? next
                  : [
                      ...new Map(
                        [...historicalCatalog, ...next].map((def) => [def.id, def]),
                      ).values(),
                    ];
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
    }
  }

  function refreshCatalog(): void {
    discover(true);
  }

  function refreshLiveCatalog(): void {
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

  function zoneState(def: TileDef, value: number | undefined): ZoneState {
    // Read reactive version counters so a template $derived re-evaluates after fetches and notifications.
    void metaVersion;
    void deps.store.notificationsVersion;
    const notification = deps.store.notifications.get(`notifications.${def.zonesPath}`);
    if (notification !== undefined) return 'alarm';
    const cached = metaCache.get(def.zonesPath);
    if (cached?.zones?.length) return zoneStateFor(value, cached.zones);
    // Server zones always win. The client defaults (shallow-depth safety bands for a stock server
    // with no configured zones) apply only while the path has a meta-cache entry: resolved with no
    // zones, or in flight. A path awaiting an authorized retry (the token-less failure path, where
    // the entry is removed) stays neutral until the retry lands.
    if (metaCache.has(def.zonesPath)) {
      return zoneStateFor(value, CLIENT_DEFAULT_ZONES.get(def.zonesPath));
    }
    return 'normal';
  }

  function dispose(): void {
    disposed = true;
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
  deps.store.ensureCells(resolveTiles().flatMap((def) => def.paths));

  // Restore subscriptions, meta, and discovery if the dock was persisted open before construction.
  syncSubscriptions();
  if (deps.openStore.value === true) {
    fetchMetaForSelected();
    discover();
  }

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
      return [...TILE_CATALOG, ...dynamicCatalog];
    },
    get discovering() {
      return liveDiscovering || historyDiscovering;
    },
    get historyStatus() {
      return historyStatus;
    },
    isHistoricalOnly(id: string): boolean {
      return historicalOnlyIds.has(id);
    },
    isLiveDiscovered(id: string): boolean {
      return liveDiscoveredIds.has(id);
    },
    toggleOpen,
    setOpen,
    toggleTile,
    reorderTile,
    refreshCatalog,
    refreshLiveCatalog,
    zoneState,
    resubscribe,
    dispose,
  };
}
