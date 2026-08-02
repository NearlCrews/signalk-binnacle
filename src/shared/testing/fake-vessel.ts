import { type LatLon, parseLatLonKey, quantizeLatLonKey } from '$shared/geo';

// The read-only slice of OwnVessel that a panel showing distance and bearing actually consumes.
// Panels take the whole entity, but constructing one needs a store and a frame, so their component
// tests pass a structural stub instead.
export interface FakeVesselFix {
  position: LatLon | undefined;
  positionStale: boolean;
  coarsePosition: LatLon | undefined;
}

// Build that stub with a coarse fix derived the way the entity derives it, rather than by writing a
// pre-rounded literal into each test. A stub that sets `position` but forgets `coarsePosition`
// silently renders as "no fix", which is a confusing way for an unrelated test to fail.
// Imported by *.test.ts files only.
export function fakeVesselFix(position: LatLon | undefined, positionStale = false): FakeVesselFix {
  const key = position && !positionStale ? quantizeLatLonKey(position) : '';
  return {
    position,
    positionStale,
    coarsePosition: key ? parseLatLonKey(key) : undefined,
  };
}
