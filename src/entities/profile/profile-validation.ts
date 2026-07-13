import { hasControlCharacters, isFiniteNumber, isRecord } from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import { isThresholds, isTrackSettings } from '$shared/settings';
import { THEMES } from '$shared/ui';
import type { Profile, ProfileSettings } from './profile-types';

export const MAX_PROFILES = 1_000;
export const MAX_PROFILE_NAME_LENGTH = 256;
export const MAX_PROFILE_ID_LENGTH = 512;
const MAX_LAYER_ENTRIES = 1_000;
const MAX_LIST_ENTRIES = 1_000;
const MAX_TILE_ENTRIES = 100;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

export function cleanProfileName(value: unknown): string | undefined {
  return cleanText(value, MAX_PROFILE_NAME_LENGTH);
}

function validStringList(value: unknown, maxEntries: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxEntries &&
    value.every((entry) => cleanText(entry, MAX_PROFILE_ID_LENGTH) !== undefined)
  );
}

function validLayerSettings(value: unknown): value is LayerSettings {
  if (!isRecord(value) || Object.keys(value).length > MAX_LAYER_ENTRIES) return false;
  return Object.entries(value).every(
    ([id, setting]) =>
      cleanText(id, MAX_PROFILE_ID_LENGTH) !== undefined &&
      isRecord(setting) &&
      typeof setting.visible === 'boolean' &&
      isFiniteNumber(setting.opacity) &&
      setting.opacity >= 0 &&
      setting.opacity <= 1,
  );
}

function validCategorySettings(value: unknown): value is Record<string, boolean> {
  if (!isRecord(value) || Object.keys(value).length > MAX_LAYER_ENTRIES) return false;
  return Object.entries(value).every(
    ([id, open]) => cleanText(id, MAX_PROFILE_ID_LENGTH) !== undefined && typeof open === 'boolean',
  );
}

export function isProfileSettings(value: unknown): value is ProfileSettings {
  if (!isRecord(value)) return false;
  if (!(THEMES as readonly unknown[]).includes(value.theme)) return false;
  if (!validLayerSettings(value.layers) || !validLayerSettings(value.weatherLayers)) return false;
  if (!validCategorySettings(value.layerCategories)) return false;
  if (!validStringList(value.layerOrder, MAX_LIST_ENTRIES)) return false;
  if (!isThresholds(value.thresholds) || !isTrackSettings(value.trackSettings)) return false;
  if (
    !isFiniteNumber(value.planningSpeedKn) ||
    value.planningSpeedKn < 0 ||
    value.planningSpeedKn > 100
  ) {
    return false;
  }
  if (typeof value.arrivalMuted !== 'boolean') return false;
  if (value.units !== undefined && value.units !== 'metric' && value.units !== 'imperial')
    return false;
  if (
    value.pinnedActionIds !== undefined &&
    !validStringList(value.pinnedActionIds, MAX_TILE_ENTRIES)
  ) {
    return false;
  }
  if (
    value.instrumentTiles !== undefined &&
    !validStringList(value.instrumentTiles, MAX_TILE_ENTRIES)
  ) {
    return false;
  }
  if (value.mode !== undefined && cleanText(value.mode, 64) === undefined) return false;
  return true;
}

export function isStoredProfile(value: unknown): value is Profile {
  if (!isRecord(value)) return false;
  return (
    cleanText(value.id, MAX_PROFILE_ID_LENGTH) !== undefined &&
    cleanProfileName(value.name) !== undefined &&
    isProfileSettings(value.settings) &&
    isFiniteNumber(value.createdAt) &&
    value.createdAt >= 0 &&
    isFiniteNumber(value.updatedAt) &&
    value.updatedAt >= value.createdAt
  );
}
