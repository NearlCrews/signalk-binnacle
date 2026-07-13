import type { NotePoint } from '$entities/poi';
import { categoryLabel } from '$entities/poi-icons';
import type { LatLon } from '$shared/geo';
import { compareOptionalNumber } from '$shared/lib';
import { rhumbBearingRad, rhumbDistanceMeters } from '$shared/nav';

// A point of interest surfaced by the search panel: the same shape the notes overlay renders, reused
// so the two cannot drift.
export type Poi = NotePoint;

export type PoiSort = 'name' | 'type' | 'distance' | 'bearing';
export type SortDir = 'asc' | 'desc';

export interface PoiRow {
  poi: Poi;
  distanceMeters?: number;
  bearingRad?: number;
}

const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function normalized(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en');
}

function compareIdentity(a: PoiRow, b: PoiRow): number {
  return COLLATOR.compare(a.poi.name, b.poi.name) || COLLATOR.compare(a.poi.id, b.poi.id);
}

export function toRows(pois: readonly Poi[], vessel?: LatLon): PoiRow[] {
  return pois.map((poi) => ({
    poi,
    // Rhumb distance to pair with the rhumb bearing below, so the column and the heading describe
    // the same straight-line-on-a-Mercator-chart leg the navigator would actually steer.
    distanceMeters: vessel ? rhumbDistanceMeters(vessel, poi.position) : undefined,
    bearingRad: vessel ? rhumbBearingRad(vessel, poi.position) : undefined,
  }));
}

export function filterRows(rows: readonly PoiRow[], query: string): readonly PoiRow[] {
  const q = normalized(query.trim());
  // Return the input as-is for an empty query: sortRows owns the copy, so a spread here would be a
  // redundant second allocation of the whole list.
  if (q === '') return rows;
  return rows.filter((row) => {
    const searchable = [
      row.poi.name,
      categoryLabel(row.poi.category),
      row.poi.source,
      row.poi.attribution,
    ];
    return searchable.some((value) => normalized(value).includes(q));
  });
}

export function sortRows(rows: readonly PoiRow[], key: PoiSort, dir: SortDir): PoiRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'type') {
    // Precompute each row's category label once, then sort (decorate, sort, undecorate), so the
    // comparator does not recompute categoryLabel on every comparison.
    return rows
      .map((row) => ({ row, label: categoryLabel(row.poi.category) }))
      .sort((a, b) => sign * (COLLATOR.compare(a.label, b.label) || compareIdentity(a.row, b.row)))
      .map((entry) => entry.row);
  }
  const sorted = [...rows];
  if (key === 'name') {
    sorted.sort((a, b) => sign * compareIdentity(a, b));
  } else if (key === 'distance') {
    sorted.sort(
      (a, b) =>
        compareOptionalNumber(a.distanceMeters, b.distanceMeters, dir) ||
        sign * compareIdentity(a, b),
    );
  } else {
    sorted.sort(
      (a, b) =>
        compareOptionalNumber(a.bearingRad, b.bearingRad, dir) || sign * compareIdentity(a, b),
    );
  }
  return sorted;
}

export function defaultSort(hasFix: boolean): { key: PoiSort; dir: SortDir } {
  return hasFix ? { key: 'distance', dir: 'asc' } : { key: 'name', dir: 'asc' };
}
