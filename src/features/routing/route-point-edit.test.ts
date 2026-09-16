import { describe, expect, it } from 'vitest';
import { MAX_ROUTE_WAYPOINTS, type RouteWaypoint } from '$entities/route';
import { editRoutePoints, sameRoutePointPositions } from './route-point-edit';

const a = { latitude: 42, longitude: -83 };
const b = { latitude: 43, longitude: -82 };
const c = { latitude: 44, longitude: -81 };

function accepted(points: RouteWaypoint[] | undefined): RouteWaypoint[] {
  if (!points) throw new Error('Expected route coordinate edit to be accepted');
  return points;
}

describe('coordinate route edits', () => {
  it('adds the first point, appends, inserts, moves, and deletes without mutating the input', () => {
    const first = accepted(editRoutePoints([], { kind: 'add', position: a }));
    const second = accepted(editRoutePoints(first, { kind: 'add', position: c }));
    const inserted = accepted(editRoutePoints(second, { kind: 'insert', index: 0, position: b }));
    expect(inserted.map((point) => point.position)).toEqual([a, b, c]);
    expect(second.map((point) => point.position)).toEqual([a, c]);
    const moved = accepted(editRoutePoints(inserted, { kind: 'move', index: 1, position: c }));
    expect(moved[1].position).toEqual(c);
    expect(inserted[1].position).toEqual(b);
    expect(editRoutePoints(moved, { kind: 'delete', index: 1 })).toEqual(second);
    expect(editRoutePoints(first, { kind: 'delete', index: 0 })).toEqual([]);
  });

  it('preserves unmoved waypoint identity metadata but drops it from a moved mark', () => {
    const points: RouteWaypoint[] = [
      { position: a, name: 'Harbor', metadata: { href: '/resources/waypoints/harbor' } },
      { position: b, name: 'Entrance' },
    ];
    const moved = accepted(editRoutePoints(points, { kind: 'move', index: 0, position: c }));
    expect(moved[0]).toEqual({ position: c });
    expect(moved[1]).toEqual(points[1]);
    expect(moved[1]).not.toBe(points[1]);
    expect(points[0].name).toBe('Harbor');
  });

  it('reorders complete waypoint records without changing coordinates, metadata, or the original array', () => {
    const points: RouteWaypoint[] = [
      { position: a, name: 'Harbor', metadata: { href: '/resources/waypoints/harbor' } },
      { position: b, name: 'Entrance', metadata: { href: '/resources/waypoints/entrance' } },
      { position: c, name: 'Approach' },
    ];
    const earlier = accepted(editRoutePoints(points, { kind: 'reorder', index: 1, direction: -1 }));
    expect(earlier).toEqual([points[1], points[0], points[2]]);
    expect(points.map((point) => point.name)).toEqual(['Harbor', 'Entrance', 'Approach']);
    const later = accepted(editRoutePoints(earlier, { kind: 'reorder', index: 0, direction: 1 }));
    expect(later).toEqual(points);
  });

  it('rejects reordering outside route boundaries, including an empty or single-point route', () => {
    expect(editRoutePoints([], { kind: 'reorder', index: 0, direction: 1 })).toBeUndefined();
    const points = [{ position: a }, { position: b }];
    expect(editRoutePoints(points, { kind: 'reorder', index: 0, direction: -1 })).toBeUndefined();
    expect(editRoutePoints(points, { kind: 'reorder', index: 1, direction: 1 })).toBeUndefined();
    expect(editRoutePoints(points, { kind: 'reorder', index: 0.5, direction: 1 })).toBeUndefined();
    expect(
      editRoutePoints(points.slice(0, 1), { kind: 'reorder', index: 0, direction: 1 }),
    ).toBeUndefined();
  });

  it('rejects invalid coordinates, selection indices, and point counts', () => {
    expect(
      editRoutePoints([], { kind: 'add', position: { latitude: 91, longitude: 0 } }),
    ).toBeUndefined();
    expect(
      editRoutePoints([], { kind: 'add', position: { latitude: 0, longitude: Number.NaN } }),
    ).toBeUndefined();
    for (const index of [-1, 1, 0.5])
      expect(editRoutePoints([{ position: a }], { kind: 'delete', index })).toBeUndefined();
    const full = Array.from({ length: MAX_ROUTE_WAYPOINTS }, () => ({ position: a }));
    expect(editRoutePoints(full, { kind: 'add', position: b })).toBeUndefined();
    expect(editRoutePoints(full, { kind: 'insert', index: 0, position: b })).toBeUndefined();
    expect(editRoutePoints(full, { kind: 'delete', index: 0 })).toHaveLength(
      MAX_ROUTE_WAYPOINTS - 1,
    );
  });

  it('accepts the draw adapter precision but recognizes external geometry changes', () => {
    expect(
      sameRoutePointPositions([{ position: a }], [{ position: { ...a, latitude: 42 + 1e-10 } }]),
    ).toBe(true);
    expect(sameRoutePointPositions([{ position: a }], [{ position: b }])).toBe(false);
    expect(sameRoutePointPositions([], [{ position: a }])).toBe(false);
  });
});
