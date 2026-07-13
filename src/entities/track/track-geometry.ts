import type { TrackPoint } from './track-types';

// A track point as a GeoJSON [lon, lat] coordinate pair (longitude first, per GeoJSON), shared by
// the live, saved, and export coordinate builders so the lon-then-lat order is written once.
export function toLonLat(point: TrackPoint): [number, number] {
  return [point.lon, point.lat];
}

// Split a flat point list into runs at every gap point, so a recording dropout becomes a real
// break instead of a line drawn across it. The gap point that starts a run is preserved as that
// run's first point, and the leading point never starts a new run.
export function splitAtGaps(points: readonly TrackPoint[]): TrackPoint[][] {
  const runs: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  for (const point of points) {
    if (point.gap && current.length > 0) {
      runs.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

// Route conversion and action availability use only the newest uninterrupted run. Crossing a GPS
// dropout with a straight route leg would invent navigation guidance that the recorder never saw.
export function latestTrackSegment(points: readonly TrackPoint[]): TrackPoint[] {
  return splitAtGaps(points).at(-1) ?? [];
}

export function hasDrawableTrack(points: readonly TrackPoint[]): boolean {
  return splitAtGaps(points).some((segment) => segment.length >= 2);
}

export function hasTrackGaps(points: readonly TrackPoint[]): boolean {
  return points.slice(1).some((point) => point.gap === true);
}
