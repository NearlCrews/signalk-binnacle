import type { NotePoint } from '$entities/poi';
import { categoryLabel } from '$entities/poi-icons';
import type { LatLon } from '$shared/geo';
import {
  compareNavIdentity,
  defaultNavSort,
  filterNavRows,
  type NavSortState,
  navMetrics,
  SEARCH_COLLATOR,
  type SortableNavRow,
  type SortDir,
  sortNavRows,
} from '$shared/nav';

// A point of interest surfaced by the search panel: the same shape the notes overlay renders, reused
// so the two cannot drift.
export type Poi = NotePoint;

export type PoiSort = 'name' | 'type' | 'distance' | 'bearing';

export interface PoiRow extends SortableNavRow {
  poi: Poi;
}

export function toRows(pois: readonly Poi[], vessel?: LatLon): PoiRow[] {
  return pois.map((poi) => ({
    poi,
    id: poi.id,
    name: poi.name,
    ...navMetrics(vessel, poi.position),
  }));
}

export function filterRows(rows: readonly PoiRow[], query: string): readonly PoiRow[] {
  return filterNavRows(rows, query, (row) => [
    row.poi.name,
    categoryLabel(row.poi.category),
    row.poi.source,
    row.poi.attribution,
  ]);
}

export function sortRows(rows: readonly PoiRow[], key: PoiSort, dir: SortDir): PoiRow[] {
  if (key !== 'type') return sortNavRows(rows, key, dir);
  const sign = dir === 'asc' ? 1 : -1;
  // Precompute each row's category label once, then sort (decorate, sort, undecorate), so the
  // comparator does not recompute categoryLabel on every comparison.
  return rows
    .map((row) => ({ row, label: categoryLabel(row.poi.category) }))
    .sort(
      (a, b) =>
        sign * (SEARCH_COLLATOR.compare(a.label, b.label) || compareNavIdentity(a.row, b.row)),
    )
    .map((entry) => entry.row);
}

export function defaultSort(hasFix: boolean): NavSortState<PoiSort> {
  return defaultNavSort(hasFix);
}
