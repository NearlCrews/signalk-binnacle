import { describe, expect, it } from 'vitest';
import type { Route } from './route-types';
import { RouteStore } from './routes-store.svelte';

const route = (id: string): Route => ({
  id,
  name: id,
  waypoints: [
    { position: { latitude: 0, longitude: 0 } },
    { position: { latitude: 0, longitude: 1 } },
  ],
});

describe('RouteStore', () => {
  it('sets the loaded routes and bumps the version', () => {
    const s = new RouteStore();
    const v0 = s.version;
    s.setRoutes([route('a'), route('b')]);
    expect(s.routes.map((r) => r.id)).toEqual(['a', 'b']);
    expect(s.version).toBeGreaterThan(v0);
  });

  it('sorts routes by name and does not bump for an identical refresh', () => {
    const s = new RouteStore();
    const alpha = { ...route('z'), name: 'Alpha' };
    const bravo = { ...route('a'), name: 'bravo' };
    s.setRoutes([bravo, alpha]);
    expect(s.routes.map((item) => item.name)).toEqual(['Alpha', 'bravo']);
    const version = s.version;
    s.setRoutes([bravo, alpha]);
    expect(s.version).toBe(version);
  });

  it('upserts and removes routes while pruning display and active state', () => {
    const s = new RouteStore();
    s.setRoutes([route('a')]);
    s.setActive('a');
    s.upsertRoute({ ...route('a'), name: 'Updated' });
    expect(s.routeById('a')?.name).toBe('Updated');
    s.removeRoute('a');
    expect(s.routes).toEqual([]);
    expect(s.shownIds.has('a')).toBe(false);
    expect(s.activeId).toBeUndefined();
  });

  it('prunes shown route ids that are no longer returned by the server', () => {
    const s = new RouteStore();
    s.setRoutes([route('a'), route('b')]);
    s.toggleShown('b', true);
    s.setRoutes([route('a')]);
    expect(s.shownIds.has('b')).toBe(false);
  });

  it('toggles a route shown and reports it', () => {
    const s = new RouteStore();
    s.setRoutes([route('a')]);
    expect(s.isShown('a')).toBe(false);
    s.toggleShown('a', true);
    expect(s.isShown('a')).toBe(true);
    expect(s.shownIds.has('a')).toBe(true);
  });

  it('tracks the active route id', () => {
    const s = new RouteStore();
    expect(s.activeId).toBeUndefined();
    s.setActive('a');
    expect(s.activeId).toBe('a');
    s.setActive(undefined);
    expect(s.activeId).toBeUndefined();
  });

  it('holds and clears a working route under edit', () => {
    const s = new RouteStore();
    s.setWorking(route('draft'));
    expect(s.working?.id).toBe('draft');
    s.setWorking(undefined);
    expect(s.working).toBeUndefined();
  });

  it('bumps editVersion on a working-route change without touching version', () => {
    const s = new RouteStore();
    const ver0 = s.version;
    const edit0 = s.editVersion;
    s.setWorking(route('draft'));
    expect(s.editVersion).toBeGreaterThan(edit0);
    expect(s.version).toBe(ver0);
  });

  it('keeps the highlight on a same-count edit and clears it on a count change', () => {
    const s = new RouteStore();
    s.setWorking(route('draft'));
    s.setHighlight({ kind: 'leg', index: 0 });
    // A drag moves a waypoint but keeps the count, so the highlight survives.
    const dragged = route('draft');
    dragged.waypoints[0].position.longitude += 0.001;
    s.setWorking(dragged);
    expect(s.highlight).toEqual({ kind: 'leg', index: 0 });
    // Inserting a waypoint shifts indices, so the highlight clears.
    s.setWorking({
      id: 'draft',
      name: 'draft',
      waypoints: [
        { position: { latitude: 0, longitude: 0 } },
        { position: { latitude: 0, longitude: 1 } },
        { position: { latitude: 0, longitude: 2 } },
      ],
    });
    expect(s.highlight).toBeUndefined();
  });

  it('sets and clears the cross-highlight, and redundant set or clear does not bump', () => {
    const s = new RouteStore();
    const v0 = s.editVersion;
    s.setHighlight({ kind: 'waypoint', index: 2 });
    expect(s.highlight).toEqual({ kind: 'waypoint', index: 2 });
    expect(s.editVersion).toBeGreaterThan(v0);
    // Re-setting the same highlight must not bump the version.
    const v1 = s.editVersion;
    s.setHighlight({ kind: 'waypoint', index: 2 });
    expect(s.editVersion).toBe(v1);
    // A different highlight must bump the version.
    s.setHighlight({ kind: 'waypoint', index: 3 });
    expect(s.editVersion).toBeGreaterThan(v1);
    s.clearHighlight();
    expect(s.highlight).toBeUndefined();
    const v2 = s.editVersion;
    s.clearHighlight();
    expect(s.editVersion).toBe(v2);
  });

  it('clears the highlight when the working route is cleared', () => {
    const s = new RouteStore();
    s.setWorking(route('draft'));
    s.setHighlight({ kind: 'waypoint', index: 1 });
    s.setWorking(undefined);
    expect(s.highlight).toBeUndefined();
  });
});
