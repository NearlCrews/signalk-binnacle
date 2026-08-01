export type PersistenceScope =
  | 'profile'
  | 'device'
  | 'server-resource'
  | 'safety'
  | 'credential'
  | 'cache'
  | 'draft';

interface StorageKeyDefinition {
  key: `binnacle:${string}`;
  scope: PersistenceScope;
}

// The production Binnacle localStorage inventory. Call sites use the typed accessor, privacy erasure
// consumes the classified inventory, and a source-inventory test rejects hardcoded Binnacle keys.
const BINNACLE_STORAGE_KEYS = {
  theme: { key: 'binnacle:theme', scope: 'profile' },
  mapView: { key: 'binnacle:map-view', scope: 'device' },
  trackSettings: { key: 'binnacle:track-settings', scope: 'profile' },
  lookoutThresholds: { key: 'binnacle:lookout-thresholds', scope: 'profile' },
  units: { key: 'binnacle:units', scope: 'profile' },
  arrivalMuted: { key: 'binnacle:arrival-muted', scope: 'safety' },
  planningSpeedMps: { key: 'binnacle:planning-speed-mps', scope: 'profile' },
  // Legacy: the same setting in knots, read once to seed the SI key above and never written again.
  // It stays in the inventory so the privacy erasure still clears it from an upgraded device.
  planningSpeedKn: { key: 'binnacle:planning-speed-kn', scope: 'profile' },
  weatherLayers: { key: 'binnacle:weather-layers', scope: 'profile' },
  layers: { key: 'binnacle:layers', scope: 'profile' },
  layerOrder: { key: 'binnacle:layer-order', scope: 'profile' },
  radarAutoEnabled: { key: 'binnacle:radar-autoenabled', scope: 'device' },
  pinnedActions: { key: 'binnacle:pinned-actions', scope: 'profile' },
  instrumentTiles: { key: 'binnacle:instrument-tiles', scope: 'profile' },
  trendInstruments: { key: 'binnacle:trend-instruments', scope: 'profile' },
  instrumentsOpen: { key: 'binnacle:instruments-open', scope: 'device' },
  layerCategories: { key: 'binnacle:layer-categories', scope: 'device' },
  userCharts: { key: 'binnacle:user-charts', scope: 'server-resource' },
  anchorWatch: { key: 'binnacle:anchor-watch', scope: 'safety' },
  anchorRadius: { key: 'binnacle:anchor-radius', scope: 'profile' },
  mob: { key: 'binnacle:mob', scope: 'safety' },
  profiles: { key: 'binnacle:profiles', scope: 'profile' },
  profileDevice: { key: 'binnacle:profile-device', scope: 'device' },
  signalkAuth: { key: 'binnacle:signalk-auth', scope: 'credential' },
  chartActionsHint: { key: 'binnacle:chart-actions-hint', scope: 'device' },
} as const satisfies Record<string, StorageKeyDefinition>;

type BinnacleStorageKeyId = keyof typeof BINNACLE_STORAGE_KEYS;

export function binnacleStorageKey(id: BinnacleStorageKeyId): `binnacle:${string}` {
  return BINNACLE_STORAGE_KEYS[id].key;
}

export function binnacleStorageKeysForScope(
  ...scopes: readonly PersistenceScope[]
): Array<`binnacle:${string}`> {
  const wanted = new Set(scopes);
  return Object.values(BINNACLE_STORAGE_KEYS)
    .filter((definition) => wanted.has(definition.scope))
    .map((definition) => definition.key);
}
