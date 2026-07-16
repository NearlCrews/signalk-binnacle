import { fetchJsonOrUndefined, type UnitsMode } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import { enumPersistedCodec, PersistedValue } from '$shared/settings';

// The server's unit preferences API (signalk-server 2.28 and later). The active preset is global;
// the per-user override the admin UI honors lives in applicationData and is resolved through the
// presets endpoint. Older servers 404 on all three, which is the local-fallback path.
const ACTIVE_PATH = '/signalk/v1/unitpreferences/active';
const USER_PREF_PATH = '/signalk/v1/applicationData/user/unitpreferences/1.0.0';
const PRESETS_PATH = '/signalk/v1/unitpreferences/presets';

interface PresetCategories {
  categories?: Record<string, { targetUnit?: string } | undefined>;
}

// The imperial signal: every shipped preset keys length on foot or m; depth and temperature back
// it up so a partial or custom preset still resolves.
export function modeFromPreset(preset: PresetCategories | undefined): UnitsMode | undefined {
  const categories = preset?.categories;
  if (!categories) return undefined;
  const length = categories.length?.targetUnit ?? categories.depth?.targetUnit;
  if (length === 'foot') return 'imperial';
  if (length === 'm') return 'metric';
  const temperature = categories.temperature?.targetUnit;
  if (temperature === 'F') return 'imperial';
  if (temperature === 'C' || temperature === 'K') return 'metric';
  return undefined;
}

// The display-unit preference: the server's unit preferences when the server has them, otherwise
// a locally persisted choice (older servers, offline). The store is SI either way; this only
// drives the display edge. Cross-feature state, so it lives in entities and flows down as a prop.
export class UnitsStore {
  #local: PersistedValue<UnitsMode>;
  #server = $state<UnitsMode | undefined>(undefined);
  // The origin the resolved preset belongs to, so a switch to a different server clears it.
  #syncedOrigin: string | undefined;

  constructor(
    local = new PersistedValue<UnitsMode>(
      binnacleStorageKey('units'),
      'metric',
      undefined,
      enumPersistedCodec(['metric', 'imperial']),
    ),
  ) {
    this.#local = local;
  }

  get mode(): UnitsMode {
    return this.#server ?? this.#local.value;
  }

  // Where the active mode came from, so settings UI can say "following the server preference".
  get source(): 'server' | 'local' {
    return this.#server !== undefined ? 'server' : 'local';
  }

  // The local fallback as a persisted setting, so profiles can carry it; it only takes effect
  // when no server preference resolves.
  get localSetting(): PersistedValue<UnitsMode> {
    return this.#local;
  }

  // Resolve the server preference: the user's own preset first (same-origin credentials, the
  // admin UI's resolution), then the global active preset. A transport failure or 404 leaves the
  // current value, so a flaky link cannot flip units mid-passage.
  async syncFromServer(base: string, fetchFn?: typeof fetch): Promise<void> {
    // Clear a resolved preset only when the origin actually changed, so a server switch falls back
    // to local rather than carrying the prior server's preset, while a same-server flaky re-sync
    // keeps the value (stability over churn: a transient failure must not flip units mid-passage).
    if (base !== this.#syncedOrigin) {
      this.#server = undefined;
      this.#syncedOrigin = base;
    }
    const userPref = await fetchJsonOrUndefined<{ activePreset?: string }>(
      `${base}${USER_PREF_PATH}`,
      { credentials: 'include' },
      fetchFn,
    );
    if (typeof userPref?.activePreset === 'string' && userPref.activePreset) {
      const preset = await fetchJsonOrUndefined<PresetCategories>(
        `${base}${PRESETS_PATH}/${encodeURIComponent(userPref.activePreset)}`,
        undefined,
        fetchFn,
      );
      const mode = modeFromPreset(preset);
      if (mode) {
        this.#server = mode;
        return;
      }
    }
    const active = await fetchJsonOrUndefined<PresetCategories>(
      `${base}${ACTIVE_PATH}`,
      undefined,
      fetchFn,
    );
    const mode = modeFromPreset(active);
    if (mode) {
      this.#server = mode;
    } else if (active) {
      // A preset the server returned but this heuristic cannot classify reads exactly like "no
      // server preference"; one line makes "why is my boat metric" debuggable.
      console.info(
        '[units] the server unit preset was fetched but not recognized; using the local setting',
      );
    }
  }
}
