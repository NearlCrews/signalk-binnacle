import { feetToMeters, METERS_PER_FOOT, type UnitsMode } from '$shared/lib';

export function displayRadarDistance(meters: number, unitsMode: UnitsMode): number {
  return unitsMode === 'imperial' ? meters / METERS_PER_FOOT : meters;
}

export function siRadarDistance(distance: number, unitsMode: UnitsMode): number {
  return unitsMode === 'imperial' ? feetToMeters(distance) : distance;
}
