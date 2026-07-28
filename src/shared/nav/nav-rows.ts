import type { LatLon } from '$shared/geo';
import { compareOptionalNumber } from '$shared/lib';
import { rhumbBearingRad, rhumbDistanceMeters } from './route-geometry';

// The pure list core behind the searchable, sortable nav panels (Find places, Waypoints): one
// normalization, one collation, one metric pair, and one tie-break, so two panels that show the same
// columns can never order or match them differently.

// Cap the rendered rows: rendering thousands of action-bearing cards costs more than a navigator
// can read, so both nav panels show a first page and say how many matches were left out.
export const MAX_NAV_ROWS = 250;

export type NavSortKey = 'name' | 'distance' | 'bearing';
export type SortDir = 'asc' | 'desc';

export interface NavSortState<K extends string = NavSortKey> {
  key: K;
  dir: SortDir;
}

// One row of a nav list: a stable identity, the displayed name, and the optional metrics that are
// only knowable with a fresh vessel fix. A feature extends this with its own payload.
export interface SortableNavRow {
  id: string;
  name: string;
  distanceMeters?: number;
  bearingRad?: number;
}

// Base sensitivity folds case and accents together, and numeric ordering keeps "Dock 2" before
// "Dock 10". Shared so search matching and sort ordering agree.
export const SEARCH_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

// Rhumb distance paired with rhumb bearing, so the two columns describe the same
// straight-line-on-a-Mercator-chart leg the navigator would actually steer. Both stay undefined
// without a fresh fix rather than reporting a distance from a stale position.
export function navMetrics(
  vessel: LatLon | undefined,
  target: LatLon,
): { distanceMeters?: number; bearingRad?: number } {
  if (!vessel) return {};
  return {
    distanceMeters: rhumbDistanceMeters(vessel, target),
    bearingRad: rhumbBearingRad(vessel, target),
  };
}

function normalized(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en');
}

// The deterministic tie-break every nav sort ends with: collated name, then collated id, so two rows
// with equal metrics never swap places between renders.
export function compareNavIdentity(a: SortableNavRow, b: SortableNavRow): number {
  return SEARCH_COLLATOR.compare(a.name, b.name) || SEARCH_COLLATOR.compare(a.id, b.id);
}

export function filterNavRows<T>(
  rows: readonly T[],
  query: string,
  fields: (row: T) => readonly (string | undefined)[],
): readonly T[] {
  const q = normalized(query.trim());
  // Return the input as-is for an empty query: the sort owns the copy, so a spread here would be a
  // redundant second allocation of the whole list.
  if (q === '') return rows;
  return rows.filter((row) => fields(row).some((value) => normalized(value).includes(q)));
}

export function sortNavRows<T extends SortableNavRow>(
  rows: readonly T[],
  key: NavSortKey,
  dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = [...rows];
  if (key === 'name') {
    sorted.sort((a, b) => sign * compareNavIdentity(a, b));
  } else if (key === 'distance') {
    sorted.sort(
      (a, b) =>
        compareOptionalNumber(a.distanceMeters, b.distanceMeters, dir) ||
        sign * compareNavIdentity(a, b),
    );
  } else {
    sorted.sort(
      (a, b) =>
        compareOptionalNumber(a.bearingRad, b.bearingRad, dir) || sign * compareNavIdentity(a, b),
    );
  }
  return sorted;
}

// Before the navigator chooses a sort, follow GPS availability: nearest first as soon as a fresh fix
// arrives, name first while it is absent or stale.
export function defaultNavSort(hasFix: boolean): NavSortState {
  return hasFix ? { key: 'distance', dir: 'asc' } : { key: 'name', dir: 'asc' };
}

// Same key flips the direction; a new key starts ascending. Generic over the key so a panel with an
// extra sort of its own (Find places sorts by category too) shares the same interaction.
export function toggleSort<K extends string>(current: NavSortState<K>, key: K): NavSortState<K> {
  return current.key === key
    ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' };
}
