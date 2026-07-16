import type { Profile, ProfileSettings, ProfileStore } from '$entities/profile';

// Seed three starter profiles on a fresh device, so the feature is not empty and teaches the
// concept. Each changes the theme, quick actions, and instruments for a distinct operating context.
// The ids are stable so the same starters seeded on two devices merge to one on sync, not duplicate.
// The startup controller calls this only after local and server hydration both resolve empty.
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
  store.seed([
    starter('binnacle-seed-coastal-day', 'Coastal day', {
      ...base,
      theme: 'day',
      pinnedActionIds: ['center', 'follow', 'layers', 'poi-search'],
      instrumentTiles: ['sog', 'heading', 'depth', 'wind-apparent'],
    }),
    starter('binnacle-seed-night-passage', 'Night passage', {
      ...base,
      theme: 'night-red',
      pinnedActionIds: ['center', 'follow', 'radar', 'instruments'],
      instrumentTiles: ['heading', 'depth', 'course', 'course-xte'],
    }),
    starter('binnacle-seed-at-anchor', 'At anchor', {
      ...base,
      theme: 'dusk',
      pinnedActionIds: ['anchor', 'layers', 'tides', 'instruments'],
      instrumentTiles: ['depth', 'wind-apparent', 'pressure', 'position'],
    }),
  ]);
}
