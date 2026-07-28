import { describe, expect, it } from 'vitest';
import type { Waypoint } from '$entities/waypoint';
import {
  filterWaypointRows,
  sortWaypointRows,
  toWaypointRows,
  type WaypointRow,
} from './waypoint-rows';

const boat = { latitude: 0, longitude: 0 };

function waypoint(id: string, name: string, lon: number, description?: string): Waypoint {
  return { id, name, position: { latitude: 0, longitude: lon }, description };
}

describe('toWaypointRows', () => {
  it('measures distance and bearing from a fresh fix', () => {
    const [row] = toWaypointRows([waypoint('a', 'Harbor', 1)], boat);
    expect(row.distanceMeters).toBeGreaterThan(0);
    expect(typeof row.bearingRad).toBe('number');
    expect(row.waypoint.id).toBe('a');
  });

  it('leaves both metrics undefined without a fix', () => {
    const [row] = toWaypointRows([waypoint('a', 'Harbor', 1)]);
    expect(row.distanceMeters).toBeUndefined();
    expect(row.bearingRad).toBeUndefined();
  });

  it('carries the identity the shared sort needs', () => {
    const [row] = toWaypointRows([waypoint('a', 'Harbor', 1)]);
    expect(row.id).toBe('a');
    expect(row.name).toBe('Harbor');
  });
});

describe('filterWaypointRows', () => {
  const rows = toWaypointRows([
    waypoint('a', 'Harbor Marina', 1),
    waypoint('b', 'Quiet Cove', 2, 'Good holding in Québec mud'),
  ]);

  it('matches the name ignoring case', () => {
    expect(filterWaypointRows(rows, 'HARBOR').map((r) => r.id)).toEqual(['a']);
  });

  it('matches the description ignoring accents', () => {
    expect(filterWaypointRows(rows, 'quebec mud').map((r) => r.id)).toEqual(['b']);
  });

  it('keeps every row for an empty or whitespace query', () => {
    expect(filterWaypointRows(rows, '  ')).toHaveLength(2);
  });
});

describe('sortWaypointRows', () => {
  const rows: WaypointRow[] = [
    ...toWaypointRows([waypoint('a', 'Bravo', 2), waypoint('b', 'Alpha', 1)], boat),
    ...toWaypointRows([waypoint('c', 'Charlie', 3)]),
  ];

  it('sorts by name in both directions', () => {
    expect(sortWaypointRows(rows, 'name', 'asc').map((r) => r.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(sortWaypointRows(rows, 'name', 'desc').map((r) => r.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });

  it('sorts by distance with unmeasured waypoints last', () => {
    expect(sortWaypointRows(rows, 'distance', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortWaypointRows(rows, 'distance', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
