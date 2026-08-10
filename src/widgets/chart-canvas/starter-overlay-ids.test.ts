import { describe, expect, it } from 'vitest';
import { type ProfileSettings, ProfileStore } from '$entities/profile';
import { MARINE_RADAR_OVERLAY_ID } from '$features/marine-radar';
import { seedStarterProfiles } from '$features/profiles';
import { TIDES_OVERLAY_ID } from '$features/tides';
import { DEFAULT_THRESHOLDS } from '$shared/settings';

// starter-profiles.ts must not import the overlays whose ids it raises (a feature must not import
// a sibling feature), so its literals are pinned here, at an altitude that sees both sides: a
// renamed overlay id fails this test instead of turning a starter's raise into an inert layers key
// no overlay carries.
const base: ProfileSettings = {
  theme: 'day',
  layers: {},
  layerOrder: [],
  weatherLayers: {},
  thresholds: DEFAULT_THRESHOLDS,
  trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
  planningSpeedMps: 5,
};

describe('starter profile raised layers', () => {
  it('raise only keys that a shipped overlay actually owns', () => {
    const store = new ProfileStore({ load: () => undefined, save: () => {} });
    seedStarterProfiles(store, base);

    const raisedKeys = new Set(
      store.profiles.flatMap((profile) => Object.keys(profile.settings.layers)),
    );

    expect(raisedKeys).toEqual(new Set([MARINE_RADAR_OVERLAY_ID, TIDES_OVERLAY_ID]));
  });
});
