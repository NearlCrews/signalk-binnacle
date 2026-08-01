import { describe, expect, it } from 'vitest';
import type { Profile, ProfileSettings } from '$entities/profile';
import {
  downloadProfileJson,
  type ImportedProfile,
  isProfileSettings,
  parseProfilesJson,
} from './profile-io';

const settings = (overrides: Partial<ProfileSettings> = {}): ProfileSettings => ({
  theme: 'day',
  layers: {},
  layerOrder: [],
  layerCategories: {},
  weatherLayers: {},
  thresholds: {
    dangerCpaMeters: 926,
    dangerTcpaSeconds: 600,
    warningCpaMeters: 1852,
    warningTcpaSeconds: 1200,
  },
  trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
  planningSpeedMps: 6,
  arrivalMuted: false,
  ...overrides,
});

const profile = (name: string, overrides: Partial<ProfileSettings> = {}): Profile => ({
  id: 'p1',
  name,
  settings: settings(overrides),
  createdAt: 1,
  updatedAt: 2,
});

describe('isProfileSettings', () => {
  it('accepts a full valid settings object', () => {
    expect(isProfileSettings(settings())).toBe(true);
  });

  it('accepts every valid theme', () => {
    expect(isProfileSettings(settings({ theme: 'day' }))).toBe(true);
    expect(isProfileSettings(settings({ theme: 'dusk' }))).toBe(true);
    expect(isProfileSettings(settings({ theme: 'night-red' }))).toBe(true);
  });

  it('rejects an unknown theme without defaulting', () => {
    expect(isProfileSettings(settings({ theme: 'midnight' as never }))).toBe(false);
  });

  it('rejects missing layers', () => {
    const bad = settings();
    delete (bad as unknown as Record<string, unknown>).layers;
    expect(isProfileSettings(bad)).toBe(false);
  });

  it('rejects a wrong-typed layers field', () => {
    expect(isProfileSettings(settings({ layers: [] as never }))).toBe(false);
    expect(isProfileSettings(settings({ layers: 'nope' as never }))).toBe(false);
  });

  it('rejects a non-array layerOrder', () => {
    expect(isProfileSettings(settings({ layerOrder: {} as never }))).toBe(false);
  });

  it('rejects a layerOrder holding a non-string', () => {
    expect(isProfileSettings(settings({ layerOrder: ['ok', 3 as never] }))).toBe(false);
  });

  it('rejects a wrong-typed layerCategories or weatherLayers', () => {
    expect(isProfileSettings(settings({ layerCategories: [] as never }))).toBe(false);
    expect(isProfileSettings(settings({ weatherLayers: 1 as never }))).toBe(false);
  });

  it('rejects a bad thresholds object', () => {
    const bad = settings();
    (bad.thresholds as unknown as Record<string, unknown>).dangerCpaMeters = 'near';
    expect(isProfileSettings(bad)).toBe(false);
  });

  it('rejects a bad colorMode', () => {
    expect(
      isProfileSettings(
        settings({
          trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'rainbow' as never },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a non-number planningSpeedMps', () => {
    expect(isProfileSettings(settings({ planningSpeedMps: '6' as never }))).toBe(false);
    expect(isProfileSettings(settings({ planningSpeedMps: Number.NaN }))).toBe(false);
  });

  it('rejects a non-boolean arrivalMuted', () => {
    expect(isProfileSettings(settings({ arrivalMuted: 1 as never }))).toBe(false);
  });

  it('still accepts an older export that carries the dropped alarmMuted field', () => {
    expect(isProfileSettings(settings({ alarmMuted: true } as never))).toBe(true);
  });

  it('accepts settings with no pinnedActionIds', () => {
    expect(isProfileSettings({ ...settings(), pinnedActionIds: undefined })).toBe(true);
  });

  it('accepts a string-array pinnedActionIds', () => {
    expect(isProfileSettings({ ...settings(), pinnedActionIds: ['center', 'follow'] })).toBe(true);
  });

  it('rejects a non-string-array pinnedActionIds', () => {
    expect(isProfileSettings({ ...settings(), pinnedActionIds: [1, 2] as never })).toBe(false);
    expect(isProfileSettings({ ...settings(), pinnedActionIds: 'center' as never })).toBe(false);
  });

  it('accepts an optional string mode and rejects a non-string mode', () => {
    expect(isProfileSettings(settings({ mode: 'anchor' }))).toBe(true);
    expect(isProfileSettings(settings({ mode: 5 as never }))).toBe(false);
  });

  it('rejects a totally wrong shape, null, and a string', () => {
    expect(isProfileSettings({ foo: 'bar' })).toBe(false);
    expect(isProfileSettings(null)).toBe(false);
    expect(isProfileSettings('a profile')).toBe(false);
    expect(isProfileSettings(undefined)).toBe(false);
    expect(isProfileSettings([])).toBe(false);
  });
});

describe('parseProfilesJson', () => {
  it('reads a single exported Profile, keeping its name and settings', () => {
    const out = parseProfilesJson(JSON.stringify(profile('Coastal', { planningSpeedMps: 9 })));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Coastal');
    expect(out[0].settings.planningSpeedMps).toBe(9);
  });

  it('reads an array of two Profiles', () => {
    const out = parseProfilesJson(JSON.stringify([profile('Coastal'), profile('Offshore')]));
    expect(out.map((p) => p.name)).toEqual(['Coastal', 'Offshore']);
  });

  it('reads a { profiles: [...] } envelope', () => {
    const out = parseProfilesJson(JSON.stringify({ profiles: [profile('Coastal')] }));
    expect(out.map((p) => p.name)).toEqual(['Coastal']);
  });

  it('reads a bare ProfileSettings object with a fallback name', () => {
    const out = parseProfilesJson(JSON.stringify(settings({ planningSpeedMps: 7 })));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Imported profile');
    expect(out[0].settings.planningSpeedMps).toBe(7);
  });

  it('reads an array of bare ProfileSettings with fallback names', () => {
    const out = parseProfilesJson(JSON.stringify([settings(), settings({ theme: 'dusk' })]));
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.name === 'Imported profile')).toBe(true);
    expect(out[1].settings.theme).toBe('dusk');
  });

  it('returns an empty array on invalid JSON', () => {
    expect(parseProfilesJson('{ not json')).toEqual([]);
  });

  it('returns only the valid item from a mixed array', () => {
    const out = parseProfilesJson(
      JSON.stringify([profile('Good'), profile('Bad', { theme: 'midnight' as never })]),
    );
    expect(out.map((p) => p.name)).toEqual(['Good']);
  });

  it('drops a Profile whose settings are corrupt', () => {
    const bad = profile('Coastal');
    (bad.settings as unknown as Record<string, unknown>).planningSpeedMps = 'fast';
    expect(parseProfilesJson(JSON.stringify(bad))).toEqual([]);
  });

  it('falls back to the default name when a Profile name is empty', () => {
    const out = parseProfilesJson(JSON.stringify(profile('')));
    expect(out[0].name).toBe('Imported profile');
  });

  it('accepts settings with no instrumentTiles', () => {
    expect(isProfileSettings({ ...settings(), instrumentTiles: undefined })).toBe(true);
  });

  it('accepts a string-array instrumentTiles', () => {
    expect(isProfileSettings({ ...settings(), instrumentTiles: ['depth', 'sog'] })).toBe(true);
  });

  it('rejects a non-array instrumentTiles', () => {
    expect(isProfileSettings({ ...settings(), instrumentTiles: 'depth' as never })).toBe(false);
  });

  it('rejects an instrumentTiles array containing non-string members', () => {
    expect(isProfileSettings({ ...settings(), instrumentTiles: ['depth', 42 as never] })).toBe(
      false,
    );
  });

  it('accepts zero to eight unique trend ids and legacy profiles without the field', () => {
    expect(isProfileSettings({ ...settings(), trendInstrumentIds: undefined })).toBe(true);
    expect(isProfileSettings({ ...settings(), trendInstrumentIds: [] })).toBe(true);
    expect(
      isProfileSettings({
        ...settings(),
        trendInstrumentIds: ['depth', 'wind-apparent', 'future-sensor'],
      }),
    ).toBe(true);
  });

  it('rejects duplicate, malformed, or ninth trend ids', () => {
    expect(isProfileSettings({ ...settings(), trendInstrumentIds: ['depth', 'depth'] })).toBe(
      false,
    );
    expect(isProfileSettings({ ...settings(), trendInstrumentIds: ['depth\nwind'] })).toBe(false);
    expect(
      isProfileSettings({
        ...settings(),
        trendInstrumentIds: Array.from({ length: 9 }, (_, index) => `trend-${index}`),
      }),
    ).toBe(false);
  });

  it('round-trips a valid mode and drops a Profile with a non-string mode', () => {
    const kept = parseProfilesJson(JSON.stringify(profile('Anchor', { mode: 'anchor' })));
    expect(kept[0].settings.mode).toBe('anchor');

    const dropped = parseProfilesJson(JSON.stringify(profile('Bad mode', { mode: 7 as never })));
    expect(dropped).toEqual([]);
  });
});

describe('downloadProfileJson', () => {
  it('is a safe no-op in a non-DOM environment', () => {
    const out: ImportedProfile[] = parseProfilesJson(
      JSON.stringify(profile('Roundtrip', { planningSpeedMps: 8 })),
    );
    expect(out[0].settings.planningSpeedMps).toBe(8);
    expect(() => downloadProfileJson(profile('Coastal'))).not.toThrow();
  });
});
