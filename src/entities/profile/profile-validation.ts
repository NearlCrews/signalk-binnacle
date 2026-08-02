import { isTrendInstrumentId, MAX_TREND_INSTRUMENTS } from '$entities/instrument-trend';
import {
  hasControlCharacters,
  isFiniteNumber,
  isRecord,
  isSafeNonNegativeInteger,
  knotsToMetersPerSecond,
} from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import {
  isThresholds,
  isTrackSettings,
  MAX_PLANNING_SPEED_KN,
  MAX_PLANNING_SPEED_MPS,
  type Thresholds,
  type TrackSettings,
} from '$shared/settings';
import { THEMES } from '$shared/ui';
import {
  PORTABLE_PROFILE_SETTING_KEYS,
  type Profile,
  type ProfileSettings,
  type ProfileTombstone,
} from './profile-types';

export const MAX_PROFILES = 1_000;
const MAX_PROFILE_NAME_LENGTH = 256;
const MAX_PROFILE_ID_LENGTH = 512;
const MAX_LAYER_ENTRIES = 1_000;
const MAX_LIST_ENTRIES = 1_000;
const MAX_PINNED_ACTIONS = 64;
const MAX_INSTRUMENT_TILES = 100;
const MAX_PROFILE_SETTING_KEYS = 64;
const MAX_EXTENSION_DEPTH = 8;
const MAX_EXTENSION_NODES = 10_000;
const MAX_EXTENSION_STRING_LENGTH = 4_096;
const MIN_ANCHOR_RADIUS_METERS = 10;
const MAX_ANCHOR_RADIUS_METERS = 1_000_000;
const KNOWN_SETTING_KEYS = new Set<string>([
  ...PORTABLE_PROFILE_SETTING_KEYS,
  'layerCategories',
  'arrivalMuted',
  'mode',
  // Retired in favor of planningSpeedMps, but still a known field rather than a user extension:
  // a profile written before the SI migration carries it, and sanitizeProfileSettings drops it.
  'planningSpeedKn',
]);
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

export function cleanProfileName(value: unknown): string | undefined {
  return cleanText(value, MAX_PROFILE_NAME_LENGTH);
}

export function cleanProfileId(value: unknown): string | undefined {
  const id = cleanText(value, MAX_PROFILE_ID_LENGTH);
  return id &&
    id === value &&
    !id.split(/[./]/).some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment))
    ? id
    : undefined;
}

function validRecordKey(value: string, maxLength = MAX_PROFILE_ID_LENGTH): boolean {
  return cleanText(value, maxLength) === value && !DANGEROUS_PATH_SEGMENTS.has(value);
}

function validStringList(value: unknown, maxEntries: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxEntries &&
    new Set(value).size === value.length &&
    value.every((entry) => cleanText(entry, MAX_PROFILE_ID_LENGTH) === entry)
  );
}

function validLayerSettings(value: unknown): value is LayerSettings {
  if (!isRecord(value) || Object.keys(value).length > MAX_LAYER_ENTRIES) return false;
  return Object.entries(value).every(([id, setting]) => {
    const cleanedId = cleanText(id, MAX_PROFILE_ID_LENGTH);
    return (
      cleanedId === id &&
      validRecordKey(id) &&
      isRecord(setting) &&
      Object.keys(setting).length === 2 &&
      typeof setting.visible === 'boolean' &&
      isFiniteNumber(setting.opacity) &&
      setting.opacity >= 0 &&
      setting.opacity <= 1
    );
  });
}

function validCategorySettings(value: unknown): value is Record<string, boolean> {
  if (!isRecord(value) || Object.keys(value).length > MAX_LAYER_ENTRIES) return false;
  return Object.entries(value).every(
    ([id, open]) => validRecordKey(id) && typeof open === 'boolean',
  );
}

function validThresholdSettings(value: unknown): value is Thresholds {
  if (!isThresholds(value) || !isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length >= 4 &&
    keys.length <= 5 &&
    keys.every((key) =>
      [
        'dangerCpaMeters',
        'dangerTcpaSeconds',
        'warningCpaMeters',
        'warningTcpaSeconds',
        'shallowDepthMeters',
      ].includes(key),
    )
  );
}

function validTrackProfileSettings(value: unknown): value is TrackSettings {
  return (
    isTrackSettings(value) &&
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    ['intervalSeconds', 'minMeters', 'colorMode'].every((key) => Object.hasOwn(value, key))
  );
}

function validExtensionValue(
  value: unknown,
  depth: number,
  budget: { remaining: number },
  ancestors: Set<object>,
): boolean {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > MAX_EXTENSION_DEPTH) return false;
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value === 'string') return value.length <= MAX_EXTENSION_STRING_LENGTH;
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    return false;
  }
  ancestors.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  let valid = true;
  for (const [key, entry] of entries) {
    if (
      (!Array.isArray(value) && !validRecordKey(String(key))) ||
      !validExtensionValue(entry, depth + 1, budget, ancestors)
    ) {
      valid = false;
      break;
    }
  }
  ancestors.delete(value);
  return valid;
}

export function sanitizeProfileSettings(settings: ProfileSettings): ProfileSettings {
  const {
    layerCategories: _layerCategories,
    arrivalMuted: _arrivalMuted,
    planningSpeedKn,
    ...portable
  } = settings;
  // Convert a pre-SI profile's knots once, on the way in, so nothing downstream has to know the
  // stored unit. An explicit SI value always wins: a document carrying both was written by a newer
  // build, and its knots field is the stale one.
  return portable.planningSpeedMps === undefined && planningSpeedKn !== undefined
    ? { ...portable, planningSpeedMps: knotsToMetersPerSecond(planningSpeedKn) }
    : portable;
}

// Adopt a stored or remote profile: convert its settings and carry the planning-speed merge clock
// across the rename, so two devices that migrate the same legacy profile still resolve newest-wins
// instead of tying at zero.
export function adoptStoredProfile(profile: Profile): Profile {
  const settings = sanitizeProfileSettings(profile.settings);
  const clocks = profile.settingUpdatedAt;
  if (clocks?.planningSpeedKn === undefined) return { ...profile, settings };
  // Drop the retired clock as well as carrying it forward: left in place it would be an extension
  // key with no value on either side, and the merge would copy it forward on every sync forever.
  const { planningSpeedKn, ...rest } = clocks;
  return {
    ...profile,
    settings,
    settingUpdatedAt:
      rest.planningSpeedMps === undefined ? { ...rest, planningSpeedMps: planningSpeedKn } : rest,
  };
}

// A planning speed is valid when it is a finite number inside its unit's range.
function inPlanningSpeedRange(value: unknown, max: number): boolean {
  return isFiniteNumber(value) && value >= 0 && value <= max;
}

export function isProfileSettings(value: unknown): value is ProfileSettings {
  if (!isRecord(value)) return false;
  if (Object.keys(value).length > MAX_PROFILE_SETTING_KEYS) return false;
  if (!(THEMES as readonly unknown[]).includes(value.theme)) return false;
  if (!validLayerSettings(value.layers) || !validLayerSettings(value.weatherLayers)) return false;
  if (value.layerCategories !== undefined && !validCategorySettings(value.layerCategories))
    return false;
  if (!validStringList(value.layerOrder, MAX_LIST_ENTRIES)) return false;
  if (
    !validThresholdSettings(value.thresholds) ||
    !validTrackProfileSettings(value.trackSettings)
  ) {
    return false;
  }
  // Either unit is accepted on read: profiles saved before the SI migration carry knots, and
  // rejecting those would silently drop the whole profile rather than one stale field.
  // sanitizeProfileSettings converts and drops the legacy field on the way in.
  const hasLegacySpeed = value.planningSpeedKn !== undefined;
  if (hasLegacySpeed && !inPlanningSpeedRange(value.planningSpeedKn, MAX_PLANNING_SPEED_KN)) {
    return false;
  }
  // The SI field may be absent only while the legacy one carries the value.
  if (
    !(value.planningSpeedMps === undefined && hasLegacySpeed) &&
    !inPlanningSpeedRange(value.planningSpeedMps, MAX_PLANNING_SPEED_MPS)
  ) {
    return false;
  }
  if (value.arrivalMuted !== undefined && typeof value.arrivalMuted !== 'boolean') return false;
  if (value.units !== undefined && value.units !== 'metric' && value.units !== 'imperial')
    return false;
  if (
    value.pinnedActionIds !== undefined &&
    !validStringList(value.pinnedActionIds, MAX_PINNED_ACTIONS)
  ) {
    return false;
  }
  if (
    value.instrumentTiles !== undefined &&
    !validStringList(value.instrumentTiles, MAX_INSTRUMENT_TILES)
  ) {
    return false;
  }
  if (
    value.trendInstrumentIds !== undefined &&
    (!validStringList(value.trendInstrumentIds, MAX_TREND_INSTRUMENTS) ||
      !value.trendInstrumentIds.every(isTrendInstrumentId))
  ) {
    return false;
  }
  if (
    value.anchorRadiusMeters !== undefined &&
    (!isFiniteNumber(value.anchorRadiusMeters) ||
      value.anchorRadiusMeters < MIN_ANCHOR_RADIUS_METERS ||
      value.anchorRadiusMeters > MAX_ANCHOR_RADIUS_METERS)
  ) {
    return false;
  }
  if (value.mode !== undefined && cleanText(value.mode, 64) !== value.mode) return false;
  const extensionBudget = { remaining: MAX_EXTENSION_NODES };
  for (const [key, extension] of Object.entries(value)) {
    if (!validRecordKey(key)) return false;
    if (KNOWN_SETTING_KEYS.has(key)) continue;
    if (!validExtensionValue(extension, 0, extensionBudget, new Set())) {
      return false;
    }
  }
  return true;
}

function validFieldTimestamps(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length > MAX_PROFILE_SETTING_KEYS) return false;
  return Object.entries(value).every(
    ([key, timestamp]) => validRecordKey(key) && isSafeNonNegativeInteger(timestamp),
  );
}

export function isStoredProfile(value: unknown): value is Profile {
  if (!isRecord(value)) return false;
  const id = cleanProfileId(value.id);
  const name = cleanProfileName(value.name);
  return (
    id !== undefined &&
    id === value.id &&
    name !== undefined &&
    name === value.name &&
    isProfileSettings(value.settings) &&
    isSafeNonNegativeInteger(value.createdAt) &&
    isSafeNonNegativeInteger(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    validFieldTimestamps(value.settingUpdatedAt) &&
    (value.nameUpdatedAt === undefined || isSafeNonNegativeInteger(value.nameUpdatedAt))
  );
}

export function isProfileTombstone(value: unknown): value is ProfileTombstone {
  return (
    isRecord(value) &&
    cleanProfileId(value.id) !== undefined &&
    isSafeNonNegativeInteger(value.deletedAt)
  );
}
