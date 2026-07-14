import type { PersistedValue } from '$shared/settings/persisted.svelte';
import {
  fetchPathMeta,
  type PathMeta,
  type SignalKStore,
  type SubscribeEntry,
  type ZoneState,
  zoneStateFor,
} from '$shared/signalk';
import {
  discoverInstrumentInstances,
  EMPTY_INSTANCES,
  type InstrumentInstances,
} from './instance-discovery';
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
  toggleOpen(): void;
  setOpen(open: boolean): void;
  toggleTile(id: string): void;
  reorderTile(id: string, slot: number): void;
  refreshCatalog(): void;
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

  // Discovered Signal K instance ids; populated on first open and user-refreshable from Customize.
  // Replace-only (assigned wholesale, never mutated in place), so raw state skips deep proxy wrapping.
  let instances = $state.raw<InstrumentInstances>(EMPTY_INSTANCES);
  let discoveryDone = false;
  let discovering = $state(false);

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

  // Runs once per controller construction when the dock is first opened. Discovery is fire-and-
  // forget; a failure leaves dynamic instances empty, which is a safe degrade.
  function ensureDynamicCells(next: InstrumentInstances): void {
    deps.store.ensureCells([
      ...next.batteries.flatMap((id) => batteryDefsFor(id).flatMap((def) => def.paths)),
      ...next.propulsion.flatMap((id) => propulsionDefsFor(id).flatMap((def) => def.paths)),
      ...next.tanks.flatMap((id) => tankDefsFor(id).flatMap((def) => def.paths)),
      ...next.solar.flatMap((id) => solarDefsFor(id).flatMap((def) => def.paths)),
      ...next.inside.flatMap((id) => insideDefsFor(id).flatMap((def) => def.paths)),
    ]);
  }

  function discover(refresh = false): void {
    if (discoveryDone && !refresh) return;
    discoveryDone = true;
    discovering = true;
    void discoverInstrumentInstances(deps.origin, deps.getToken())
      .then((next) => {
        instances = next;
        ensureDynamicCells(next);
        syncSubscriptions();
        if (deps.openStore.value === true) fetchMetaForSelected();
      })
      .catch(() => {
        instances = EMPTY_INSTANCES;
      })
      .finally(() => {
        discovering = false;
      });
  }

  function refreshCatalog(): void {
    discover(true);
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
      // Static catalog first, then discovered instance defs, memoized per family and id so a reactive
      // read does not allocate fresh defs every pass.
      const cached = (family: string, id: string, create: () => TileDef[]) => {
        const key = `${family}:${id}`;
        let defs = dynamicDefCache.get(key);
        if (!defs) {
          defs = create();
          dynamicDefCache.set(key, defs);
        }
        return defs;
      };
      return [
        ...TILE_CATALOG,
        ...instances.batteries.flatMap((id) => cached('battery', id, () => batteryDefsFor(id))),
        ...instances.propulsion.flatMap((id) =>
          cached('propulsion', id, () => propulsionDefsFor(id)),
        ),
        ...instances.tanks.flatMap((id) => cached('tank', id, () => tankDefsFor(id))),
        ...instances.solar.flatMap((id) => cached('solar', id, () => solarDefsFor(id))),
        ...instances.inside.flatMap((id) => cached('inside', id, () => insideDefsFor(id))),
      ];
    },
    get discovering() {
      return discovering;
    },
    toggleOpen,
    setOpen,
    toggleTile,
    reorderTile,
    refreshCatalog,
    zoneState,
    resubscribe,
    dispose,
  };
}
