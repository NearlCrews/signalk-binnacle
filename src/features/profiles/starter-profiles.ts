import { DEFAULT_TREND_INSTRUMENT_IDS } from '$entities/instrument-trend';
import type { Profile, ProfileSettings, ProfileStore } from '$entities/profile';
import { DEFAULT_OVERLAY_STATE } from '$shared/map';

// Seed three starter profiles on a fresh device, so the feature is not empty and teaches the
// concept. Each changes the theme, quick actions, instruments, chart orientation, and raised
// layers for a distinct operating context. The ids are stable so the same starters seeded on two
// devices merge to one on sync, not duplicate. The startup controller calls this only after local
// and server hydration both resolve empty.
export function seedStarterProfiles(store: ProfileStore, base: ProfileSettings): void {
  // Deterministic old timestamps ensure a stock starter created on a new browser can never outrank a
  // starter the navigator already customized on another station.
  const seedTimestamp = 1;
  const starter = (id: string, name: string, settings: ProfileSettings): Profile => ({
    id,
    name,
    settings: structuredClone(settings),
    createdAt: seedTimestamp,
    updatedAt: seedTimestamp,
  });
  // Overlay ids by their persisted LayerSettings keys: a feature must not import a sibling
  // feature's slice, and these are the same strings every saved profile document carries. The
  // starter-overlay-ids seam test in widgets/chart-canvas pins each key to the owning overlay's
  // exported id, so a renamed overlay fails there instead of leaving the raise an inert no-op.
  store.seed([
    starter('binnacle-seed-coastal-day', 'Coastal day', {
      ...base,
      theme: 'day',
      chartOrientation: 'north',
      pinnedActionIds: ['center', 'follow', 'layers', 'poi-search'],
      instrumentTiles: ['sog', 'heading', 'depth', 'wind-apparent'],
      trendInstrumentIds: [...DEFAULT_TREND_INSTRUMENT_IDS],
    }),
    starter('binnacle-seed-night-passage', 'Night passage', {
      ...base,
      theme: 'night-red',
      chartOrientation: 'course',
      layers: { ...base.layers, 'marine-radar': DEFAULT_OVERLAY_STATE },
      pinnedActionIds: ['center', 'follow', 'radar', 'instruments'],
      instrumentTiles: ['heading', 'depth', 'course', 'course-xte'],
      trendInstrumentIds: [...DEFAULT_TREND_INSTRUMENT_IDS],
    }),
    starter('binnacle-seed-at-anchor', 'At anchor', {
      ...base,
      theme: 'dusk',
      chartOrientation: 'north',
      layers: { ...base.layers, tides: DEFAULT_OVERLAY_STATE },
      pinnedActionIds: ['anchor', 'layers', 'tides', 'instruments'],
      instrumentTiles: ['depth', 'wind-apparent', 'pressure', 'position'],
      trendInstrumentIds: [...DEFAULT_TREND_INSTRUMENT_IDS],
    }),
  ]);
}
