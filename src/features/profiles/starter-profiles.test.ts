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

  it('gives each starter its presentation half: orientation and raised layers', () => {
    const store = new ProfileStore(adapter);
    seedStarterProfiles(store, {
      ...base,
      layers: { routes: { visible: false, opacity: 0.5 } },
    });
    const [coastal, night, anchor] = store.profiles;

    expect(coastal.settings.chartOrientation).toBe('north');
    expect(night.settings.chartOrientation).toBe('course');
    expect(anchor.settings.chartOrientation).toBe('north');

    // Night passage raises the radar picture; at anchor raises tides. Coastal day keeps defaults.
    expect(night.settings.layers['marine-radar']).toEqual({ visible: true, opacity: 1 });
    expect(anchor.settings.layers.tides).toEqual({ visible: true, opacity: 1 });
    expect(coastal.settings.layers['marine-radar']).toBeUndefined();
    expect(coastal.settings.layers.tides).toBeUndefined();

    // A raise merges over the seeding device's capture rather than replacing it.
    expect(night.settings.layers.routes).toEqual({ visible: false, opacity: 0.5 });
  });
});
