import {
  fetchJsonOrUndefined,
  IMPERIAL_UNITS,
  METRIC_UNITS,
  type UnitsMode,
  type UnitsProfile,
} from '$shared/lib';
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
// it up so a partial or custom preset still resolves. This coarse read serves length-domain
// callers and the per-category fallback family below; display formatting honors each category.
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

// One category's targetUnit into the profile's vocabulary; undefined leaves the family default.
const LENGTH_UNITS: Record<string, UnitsProfile['length']> = { m: 'm', foot: 'ft', ft: 'ft' };
const SPEED_UNITS: Record<string, UnitsProfile['speed']> = {
  knot: 'kn',
  knots: 'kn',
  kn: 'kn',
  'km/h': 'km/h',
  kmh: 'km/h',
  mph: 'mph',
  'm/s': 'm/s',
};
const TEMPERATURE_UNITS: Record<string, UnitsProfile['temperature']> = {
  C: 'C',
  K: 'C',
  F: 'F',
};
const PRESSURE_UNITS: Record<string, UnitsProfile['pressure']> = {
  hPa: 'hPa',
  hpa: 'hPa',
  mbar: 'mbar',
  millibar: 'mbar',
  inHg: 'inHg',
  psi: 'psi',
};
const PRECIP_UNITS: Record<string, UnitsProfile['precip']> = {
  mm: 'mm/h',
  'mm/h': 'mm/h',
  in: 'in/h',
  'in/h': 'in/h',
  inch: 'in/h',
};
const LAND_DISTANCE_UNITS: Record<string, UnitsProfile['landDistance']> = {
  km: 'km',
  mi: 'mi',
  mile: 'mi',
  miles: 'mi',
};

function categoryUnit<T>(
  categories: NonNullable<PresetCategories['categories']>,
  names: readonly string[],
  vocabulary: Record<string, T>,
): T | undefined {
  for (const name of names) {
    const target = categories[name]?.targetUnit;
    if (target && target in vocabulary) return vocabulary[target];
  }
  return undefined;
}

// The full per-category resolution: each declared targetUnit is honored individually, and a
// missing or unrecognized category falls back to the preset's coarse family. This is what keeps
// the shipped nautical-imperial-uk preset (feet, but explicitly Celsius and millibars) from
// collapsing to Fahrenheit and inHg.
export function profileFromPreset(preset: PresetCategories | undefined): UnitsProfile | undefined {
  const categories = preset?.categories;
  const family = modeFromPreset(preset);
  if (!categories || !family) return undefined;
  const base = family === 'imperial' ? IMPERIAL_UNITS : METRIC_UNITS;
  return {
    length: categoryUnit(categories, ['length', 'depth'], LENGTH_UNITS) ?? base.length,
    speed: categoryUnit(categories, ['speed'], SPEED_UNITS) ?? base.speed,
    temperature: categoryUnit(categories, ['temperature'], TEMPERATURE_UNITS) ?? base.temperature,
    pressure: categoryUnit(categories, ['pressure'], PRESSURE_UNITS) ?? base.pressure,
    precip: categoryUnit(categories, ['precipitation'], PRECIP_UNITS) ?? base.precip,
    landDistance: categoryUnit(categories, ['distance'], LAND_DISTANCE_UNITS) ?? base.landDistance,
  };
}

// The display-unit preference: the server's unit preferences when the server has them, otherwise
// a locally persisted choice (older servers, offline). The store is SI either way; this only
// drives the display edge. Cross-feature state, so it lives in entities and flows down as a prop.
export class UnitsStore {
  #local: PersistedValue<UnitsMode>;
  #server = $state<UnitsMode | undefined>(undefined);
  #serverProfile = $state<UnitsProfile | undefined>(undefined);
  // The origin the resolved preset belongs to, so a switch to a different server clears it.
  #syncedOrigin: string | undefined;
  // Supersedes older in-flight resolutions, including a retry against the same origin. Without this
  // guard, a slower response can overwrite the preference resolved by a newer request.
  #syncGeneration = 0;

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

  // The coarse length-family mode. Length-domain callers (depth entry steps, radar range
  // conversion) branch on this; display formatting goes through `profile` so every category is
  // honored individually.
  get mode(): UnitsMode {
    return this.#server ?? this.#local.value;
  }

  // The per-category display profile: the server preset's own categories when resolved, else the
  // canonical profile of the coarse mode.
  get profile(): UnitsProfile {
    return this.#serverProfile ?? (this.mode === 'imperial' ? IMPERIAL_UNITS : METRIC_UNITS);
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

  #isCurrentSync(generation: number, base: string): boolean {
    return generation === this.#syncGeneration && base === this.#syncedOrigin;
  }

  // Resolve the server preference: the user's own preset first (same-origin credentials, the
  // admin UI's resolution), then the global active preset. A transport failure or 404 leaves the
  // current value, so a flaky link cannot flip units mid-passage.
  async syncFromServer(base: string, fetchFn?: typeof fetch): Promise<void> {
    const generation = ++this.#syncGeneration;
    // Clear a resolved preset only when the origin actually changed, so a server switch falls back
    // to local rather than carrying the prior server's preset, while a same-server flaky re-sync
    // keeps the value (stability over churn: a transient failure must not flip units mid-passage).
    if (base !== this.#syncedOrigin) {
      this.#server = undefined;
      this.#serverProfile = undefined;
      this.#syncedOrigin = base;
    }
    const userPref = await fetchJsonOrUndefined<{ activePreset?: string }>(
      `${base}${USER_PREF_PATH}`,
      { credentials: 'include' },
      fetchFn,
    );
    if (!this.#isCurrentSync(generation, base)) return;
    if (typeof userPref?.activePreset === 'string' && userPref.activePreset) {
      const preset = await fetchJsonOrUndefined<PresetCategories>(
        `${base}${PRESETS_PATH}/${encodeURIComponent(userPref.activePreset)}`,
        undefined,
        fetchFn,
      );
      if (!this.#isCurrentSync(generation, base)) return;
      const profile = profileFromPreset(preset);
      if (profile) {
        this.#server = profile.length === 'ft' ? 'imperial' : 'metric';
        this.#serverProfile = profile;
        return;
      }
    }
    const active = await fetchJsonOrUndefined<PresetCategories>(
      `${base}${ACTIVE_PATH}`,
      undefined,
      fetchFn,
    );
    if (!this.#isCurrentSync(generation, base)) return;
    const profile = profileFromPreset(active);
    if (profile) {
      this.#server = profile.length === 'ft' ? 'imperial' : 'metric';
      this.#serverProfile = profile;
    } else if (active) {
      // A preset the server returned but this heuristic cannot classify reads exactly like "no
      // server preference"; one line makes "why is my boat metric" debuggable.
      console.info(
        '[units] the server unit preset was fetched but not recognized; using the local setting',
      );
    }
  }
}
