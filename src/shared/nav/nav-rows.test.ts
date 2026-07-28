import { describe, expect, it } from 'vitest';
import {
  compareNavIdentity,
  defaultNavSort,
  filterNavRows,
  navMetrics,
  type SortableNavRow,
  sortNavRows,
  toggleSort,
} from './nav-rows';

interface Row extends SortableNavRow {
  note?: string;
}

function row(
  id: string,
  name: string,
  distanceMeters?: number,
  bearingRad?: number,
  note?: string,
): Row {
  return { id, name, distanceMeters, bearingRad, note };
}

const fields = (r: Row): (string | undefined)[] => [r.name, r.note];

describe('navMetrics', () => {
  it('measures rhumb distance and bearing from the vessel', () => {
    const metrics = navMetrics({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(metrics.distanceMeters).toBeGreaterThan(0);
    expect(metrics.bearingRad).toBeCloseTo(Math.PI / 2, 6);
  });

  it('leaves both metrics undefined without a vessel fix', () => {
    const metrics = navMetrics(undefined, { latitude: 0, longitude: 1 });
    expect(metrics.distanceMeters).toBeUndefined();
    expect(metrics.bearingRad).toBeUndefined();
  });
});

describe('filterNavRows', () => {
  const rows: Row[] = [
    row('a', 'Harbor Marina', undefined, undefined, 'Fuel dock on the north wall'),
    row('b', 'Port de Québec'),
  ];

  it('matches case-insensitively and ignores accents', () => {
    expect(filterNavRows(rows, 'HARBOR', fields).map((r) => r.id)).toEqual(['a']);
    expect(filterNavRows(rows, 'quebec', fields).map((r) => r.id)).toEqual(['b']);
  });

  it('searches every supplied field', () => {
    expect(filterNavRows(rows, 'fuel dock', fields).map((r) => r.id)).toEqual(['a']);
  });

  it('returns the input uncopied for an empty or whitespace query', () => {
    expect(filterNavRows(rows, '   ', fields)).toBe(rows);
  });
});

describe('compareNavIdentity', () => {
  it('orders by collated name, then by collated id', () => {
    expect(compareNavIdentity(row('b', 'Alpha'), row('a', 'Bravo'))).toBeLessThan(0);
    expect(compareNavIdentity(row('b', 'Same'), row('a', 'Same'))).toBeGreaterThan(0);
    expect(compareNavIdentity(row('a', 'same'), row('a', 'SAME'))).toBe(0);
  });
});

describe('sortNavRows', () => {
  const rows: Row[] = [
    row('a', 'Bravo', 200, 1),
    row('b', 'Alpha', 100, 2),
    row('c', 'Charlie', undefined, undefined),
  ];

  it('sorts by name in both directions', () => {
    expect(sortNavRows(rows, 'name', 'asc').map((r) => r.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(sortNavRows(rows, 'name', 'desc').map((r) => r.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });

  it('keeps rows with no metric last in both directions', () => {
    expect(sortNavRows(rows, 'distance', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortNavRows(rows, 'distance', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortNavRows(rows, 'bearing', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortNavRows(rows, 'bearing', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('breaks equal metrics by name and then id', () => {
    const tied: Row[] = [row('b', 'Same', 10), row('z', 'Zulu', 10), row('a', 'Same', 10)];
    expect(sortNavRows(tied, 'distance', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'z']);
    expect(sortNavRows(tied, 'distance', 'desc').map((r) => r.id)).toEqual(['z', 'b', 'a']);
  });

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.id);
    sortNavRows(rows, 'name', 'desc');
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('defaultNavSort', () => {
  it('follows the fix: nearest first with one, name first without', () => {
    expect(defaultNavSort(true)).toEqual({ key: 'distance', dir: 'asc' });
    expect(defaultNavSort(false)).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('toggleSort', () => {
  it('flips the direction on the same key and starts a new key ascending', () => {
    expect(toggleSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(toggleSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(toggleSort({ key: 'name', dir: 'desc' }, 'distance')).toEqual({
      key: 'distance',
      dir: 'asc',
    });
  });
});
