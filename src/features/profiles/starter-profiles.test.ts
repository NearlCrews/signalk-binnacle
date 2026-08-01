import { describe, expect, it } from 'vitest';
import { type ProfileAdapter, type ProfileSettings, ProfileStore } from '$entities/profile';
import { DEFAULT_THRESHOLDS } from '$shared/settings';
import { seedStarterProfiles } from './starter-profiles';

const adapter: ProfileAdapter = {
  load: () => undefined,
  save: () => {},
};

const base: ProfileSettings = {
  theme: 'day',
  layers: {},
  layerOrder: [],
  layerCategories: {},
  weatherLayers: {},
  thresholds: DEFAULT_THRESHOLDS,
  trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
  planningSpeedMps: 5,
  arrivalMuted: false,
  pinnedActionIds: [],
  instrumentTiles: [],
  trendInstrumentIds: [],
};

describe('seedStarterProfiles', () => {
  it('creates distinct operating setups instead of theme-only copies', () => {
    const store = new ProfileStore(adapter);
    seedStarterProfiles(store, base);

    expect(store.profiles.map((profile) => profile.settings.theme)).toEqual([
      'day',
      'night-red',
      'dusk',
    ]);
    expect(
      new Set(store.profiles.map((profile) => profile.settings.pinnedActionIds?.join(','))).size,
    ).toBe(3);
    expect(
      new Set(store.profiles.map((profile) => profile.settings.instrumentTiles?.join(','))).size,
    ).toBe(3);
    expect(
      store.profiles.every(
        (profile) =>
          profile.settings.trendInstrumentIds?.join(',') === 'depth,wind-apparent,pressure,sog',
      ),
    ).toBe(true);
  });
});
