import { describe, expect, it } from 'vitest';
import {
  defaultSort,
  filterRows,
  type Poi,
  type PoiRow,
  sortRows,
  toRows,
} from './poi-search-rows';

const boat = { latitude: 0, longitude: 0 };

function poi(
  id: string,
  name: string,
  lat: number,
  lon: number,
  category: Poi['category'] = 'marina',
): Poi {
  return { id, name, position: { latitude: lat, longitude: lon }, category };
}

describe('toRows', () => {
  it('computes distance and bearing from the boat', () => {
    const [row] = toRows([poi('a', 'A', 0, 1)], boat);
    expect(row.distanceMeters).toBeGreaterThan(0);
    expect(typeof row.bearingRad).toBe('number');
  });

  it('leaves distance and bearing undefined with no fix', () => {
    const [row] = toRows([poi('a', 'A', 0, 1)], undefined);
    expect(row.distanceMeters).toBeUndefined();
    expect(row.bearingRad).toBeUndefined();
  });
});

describe('filterRows', () => {
  const rows: PoiRow[] = toRows([poi('a', 'Harbor Marina', 0, 1), poi('b', 'Quiet Cove', 0, 2)]);

  it('matches the name case-insensitively', () => {
    expect(filterRows(rows, 'cove').map((r) => r.poi.id)).toEqual(['b']);
    expect(filterRows(rows, 'HARBOR').map((r) => r.poi.id)).toEqual(['a']);
  });

  it('matches names without accents and searches category, source, and attribution', () => {
    const searchable = toRows([
      {
        ...poi('c', 'Port de Québec', 0, 3, 'fuel'),
        source: "Crow's Nest",
        attribution: 'Community harbor guide',
      },
    ]);
    expect(filterRows(searchable, 'quebec')).toHaveLength(1);
    expect(filterRows(searchable, 'fuel')).toHaveLength(1);
    expect(filterRows(searchable, 'crow')).toHaveLength(1);
    expect(filterRows(searchable, 'harbor guide')).toHaveLength(1);
  });

  it('keeps every row for an empty or whitespace query', () => {
    expect(filterRows(rows, '   ')).toHaveLength(2);
  });
});

describe('sortRows', () => {
  const rows: PoiRow[] = [
    { poi: poi('a', 'Bravo', 0, 0, 'anchorage'), distanceMeters: 200, bearingRad: 1 },
    { poi: poi('b', 'Alpha', 0, 0, 'marina'), distanceMeters: 100, bearingRad: 2 },
    { poi: poi('c', 'Charlie', 0, 0, 'hazard'), distanceMeters: undefined, bearingRad: undefined },
  ];

  it('sorts by name ascending and descending', () => {
    expect(sortRows(rows, 'name', 'asc').map((r) => r.poi.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(sortRows(rows, 'name', 'desc').map((r) => r.poi.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });

  it('sorts by distance with unknowns last in both directions', () => {
    expect(sortRows(rows, 'distance', 'asc').map((r) => r.poi.id)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, 'distance', 'desc').map((r) => r.poi.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by bearing with unknowns last in both directions', () => {
    expect(sortRows(rows, 'bearing', 'asc').map((r) => r.poi.id)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, 'bearing', 'desc').map((r) => r.poi.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by type using the category label', () => {
    expect(sortRows(rows, 'type', 'asc').map((r) => r.poi.category)).toEqual([
      'anchorage',
      'hazard',
      'marina',
    ]);
  });

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.poi.id);
    sortRows(rows, 'name', 'asc');
    expect(rows.map((r) => r.poi.id)).toEqual(before);
  });

  it('breaks equal sort values deterministically by name and id', () => {
    const tied: PoiRow[] = [
      { poi: poi('b', 'Same', 0, 0), distanceMeters: 10 },
      { poi: poi('z', 'Zulu', 0, 0), distanceMeters: 10 },
      { poi: poi('a', 'Same', 0, 0), distanceMeters: 10 },
    ];
    expect(sortRows(tied, 'distance', 'asc').map((r) => r.poi.id)).toEqual(['a', 'b', 'z']);
    expect(sortRows(tied, 'distance', 'desc').map((r) => r.poi.id)).toEqual(['z', 'b', 'a']);
  });
});

describe('defaultSort', () => {
  it('defaults to distance with a fix and name without', () => {
    expect(defaultSort(true)).toEqual({ key: 'distance', dir: 'asc' });
    expect(defaultSort(false)).toEqual({ key: 'name', dir: 'asc' });
  });
});
