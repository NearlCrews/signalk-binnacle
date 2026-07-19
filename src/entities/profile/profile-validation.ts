import {
  hasControlCharacters,
  isFiniteNumber,
  isRecord,
  isSafeNonNegativeInteger,
} from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import {
  isThresholds,
  isTrackSettings,
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
  const { layerCategories: _layerCategories, arrivalMuted: _arrivalMuted, ...portable } = settings;
  return portable;
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
  if (
    !isFiniteNumber(value.planningSpeedKn) ||
    value.planningSpeedKn < 0 ||
    value.planningSpeedKn > 100
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
