import type { Profile, ProfileSettings, ProfileStore } from '$entities/profile';

// Seed three starter profiles on a fresh device, so the feature is not empty and teaches the
// concept. Each changes the theme, quick actions, and instruments for a distinct operating context.
// The ids are stable so the same starters seeded on two devices merge to one on sync, not duplicate.
// Callers gate on "nothing was restored from storage": a store the user deliberately emptied must
// not resurrect them.
export function seedStarterProfiles(store: ProfileStore, base: ProfileSettings): void {
  const now = Date.now();
  const starter = (id: string, name: string, settings: ProfileSettings): Profile => ({
    id,
    name,
    settings,
    createdAt: now,
    updatedAt: now,
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
