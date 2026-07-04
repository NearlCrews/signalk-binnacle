import type { PersistedValue } from '$shared/settings/persisted.svelte';
import {
  fetchPathMeta,
  type PathMeta,
  type SignalKStore,
  type SubscribeEntry,
  type ZoneState,
  zoneStateFor,
} from '$shared/signalk';
import { discoverBatteries } from './battery-discovery';
import {
  ALL_CATALOG_PATHS,
  batteryTileDef,
  CLIENT_DEFAULT_ZONES,
  DEFAULT_TILES,
  minPeriodFor,
  TILE_CATALOG,
  type TileDef,
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
  // The full catalog available in Customize mode: static tiles plus discovered battery instances.
  readonly catalog: TileDef[];
  toggleOpen(): void;
  setOpen(open: boolean): void;
  toggleTile(id: string): void;
  reorderTile(id: string, slot: number): void;
  zoneState(def: TileDef, value: number | undefined): ZoneState;
  dispose(): void;
}

export function createInstrumentsController(deps: InstrumentsDeps): InstrumentsController {
  deps.store.ensureCells(ALL_CATALOG_PATHS);

  // Per-zonesPath meta cache: null means "fetch attempted, no zones found"; absent means "not yet fetched".
  const metaCache = new Map<string, PathMeta | null>();
  // Bumped after each fetch resolves so a reactive caller of zoneState re-evaluates.
  let metaVersion = $state(0);

  // Discovered battery instance ids; populated on first open and never re-fetched.
  let batteryInstances = $state<string[]>([]);
  let discoveryDone = false;

  // Tracks which paths are currently subscribed via deps.subscribe, so syncSubscriptions can
  // diff desired against live and issue only the delta.
  const subscribedPaths = new Set<string>();

  function resolveSelectedIds(): string[] {
    const raw = deps.tilesStore.value;
    // Runtime guard: PersistedValue without a validator can hold any JSON shape if storage drifted.
    if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_TILES];
    const valid = raw.filter((id) => typeof id === 'string' && tileById(id) !== undefined);
    return valid.length > 0 ? valid : [...DEFAULT_TILES];
  }

  function resolveTiles(): TileDef[] {
    return resolveSelectedIds().flatMap((id) => {
      const def = tileById(id);
      return def ? [def] : [];
    });
  }

  // Shared paths (two tiles using the same path) are deduplicated naturally: the desired set is a
  // union, and removal only drops paths absent from the new union.
  function syncSubscriptions(): void {
    const desired = deps.openStore.value
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
  // forget; a failure leaves batteryInstances empty, which is a safe degrade.
  function discoverOnce(): void {
    if (discoveryDone) return;
    discoveryDone = true;
    void discoverBatteries(deps.origin, deps.getToken()).then((instances) => {
      batteryInstances = instances;
      if (instances.length > 0) {
        deps.store.ensureCells(instances.map((id) => `electrical.batteries.${id}.voltage`));
      }
    });
  }

  function setOpen(open: boolean): void {
    deps.openStore.set(open);
    syncSubscriptions();
    if (open) {
      fetchMetaForSelected();
      discoverOnce();
    }
  }

  function toggleOpen(): void {
    setOpen(!deps.openStore.value);
  }

  function toggleTile(id: string): void {
    if (!tileById(id)) return;
    const current = resolveSelectedIds();
    const idx = current.indexOf(id);
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

  // Restore subscriptions, meta, and discovery if the dock was persisted open before construction.
  syncSubscriptions();
  if (deps.openStore.value) {
    fetchMetaForSelected();
    discoverOnce();
  }

  return {
    get open() {
      return deps.openStore.value;
    },
    get tiles() {
      return resolveTiles();
    },
    get selectedIds() {
      return resolveSelectedIds();
    },
    get catalog(): TileDef[] {
      // Static catalog first, then one def per discovered battery instance.
      return [...TILE_CATALOG, ...batteryInstances.map(batteryTileDef)];
    },
    toggleOpen,
    setOpen,
    toggleTile,
    reorderTile,
    zoneState,
    dispose,
  };
}
