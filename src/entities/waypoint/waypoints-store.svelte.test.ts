import { describe, expect, it } from 'vitest';
import type { Waypoint } from './waypoint-types';
import { WaypointsStore } from './waypoints-store.svelte';

const waypoint = (id: string): Waypoint => ({
  id,
  name: id,
  position: { latitude: 0, longitude: 0 },
});

describe('WaypointsStore', () => {
  it('sets the loaded waypoints and bumps the version', () => {
    const s = new WaypointsStore();
    const v0 = s.version;
    s.setWaypoints([waypoint('a'), waypoint('b')]);
    expect(s.waypoints.map((w) => w.id)).toEqual(['a', 'b']);
    expect(s.version).toBeGreaterThan(v0);
  });

  it('upserts and removes waypoints while bumping the version', () => {
    const s = new WaypointsStore();
    s.setWaypoints([waypoint('a'), waypoint('b')]);
    const beforeUpsert = s.version;
    s.upsertWaypoint({ ...waypoint('b'), name: 'Updated' });
    expect(s.waypoints.map((item) => item.id)).toEqual(['b', 'a']);
    expect(s.waypoints[0].name).toBe('Updated');
    expect(s.version).toBeGreaterThan(beforeUpsert);

    const beforeRemove = s.version;
    s.removeWaypoint('b');
    expect(s.waypoints.map((item) => item.id)).toEqual(['a']);
    expect(s.version).toBeGreaterThan(beforeRemove);
  });
});
