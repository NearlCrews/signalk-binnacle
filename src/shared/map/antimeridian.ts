import type { LonLat } from '$shared/geo';
import { normalizeLonDeltaDeg } from '$shared/nav';

function canonicalLongitude(longitude: number): number {
  const wrapped = longitude - 360 * Math.floor((longitude + 180) / 360);
  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}

// Build display geometry whose segments take the short path across the antimeridian while keeping
// every coordinate inside GeoJSON's canonical longitude range. Persistence stays untouched.
// Canonicalizes each vertex inline in one pass, reusing the same tuple for both the previous-point
// tracker and the output line, so a run of N vertices allocates N tuples rather than 2N.
export function antimeridianLineGeometry(
  coordinates: readonly LonLat[],
): GeoJSON.LineString | GeoJSON.MultiLineString {
  if (coordinates.length < 2) {
    return {
      type: 'LineString',
      coordinates: coordinates.map(
        ([longitude, latitude]) => [canonicalLongitude(longitude), latitude] as LonLat,
      ),
    };
  }

  let previous: LonLat = [canonicalLongitude(coordinates[0][0]), coordinates[0][1]];
  const lines: LonLat[][] = [[previous]];
  for (let index = 1; index < coordinates.length; index += 1) {
    const current: LonLat = [canonicalLongitude(coordinates[index][0]), coordinates[index][1]];
    const line = lines[lines.length - 1];
    const rawDelta = current[0] - previous[0];
    if (Math.abs(rawDelta) <= 180) {
      line.push(current);
      previous = current;
      continue;
    }

    const shortDelta = normalizeLonDeltaDeg(rawDelta);
    if (shortDelta === 0) {
      line.push(current);
      previous = current;
      continue;
    }
    const crossingLongitude = shortDelta > 0 ? 180 : -180;
    const unwrappedLongitude = previous[0] + shortDelta;
    const fraction = (crossingLongitude - previous[0]) / (unwrappedLongitude - previous[0]);
    const crossingLatitude = previous[1] + (current[1] - previous[1]) * fraction;
    // A vertex sitting exactly on the antimeridian gives fraction 0: the crossing point coincides
    // with the previous vertex, so pushing it would add a zero-length segment. Skip it and let the
    // new line pick up from the opposite world edge.
    if (fraction !== 0) {
      line.push([crossingLongitude, crossingLatitude]);
    }
    lines.push([[crossingLongitude === 180 ? -180 : 180, crossingLatitude], current]);
    previous = current;
  }

  // Only the seed line can end up with a single point (the first segment crossed at fraction 0);
  // drop it so no degenerate one-point line reaches the renderer.
  const drawable = lines[0].length < 2 ? lines.slice(1) : lines;
  return drawable.length === 1
    ? { type: 'LineString', coordinates: drawable[0] }
    : { type: 'MultiLineString', coordinates: drawable };
}
