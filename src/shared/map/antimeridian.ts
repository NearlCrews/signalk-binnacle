import type { LonLat } from '$shared/geo';
import { normalizeLonDeltaDeg } from '$shared/nav';

function canonicalLongitude(longitude: number): number {
  const wrapped = longitude - 360 * Math.floor((longitude + 180) / 360);
  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}

// Build display geometry whose segments take the short path across the antimeridian while keeping
// every coordinate inside GeoJSON's canonical longitude range. Persistence stays untouched.
export function antimeridianLineGeometry(
  coordinates: readonly LonLat[],
): GeoJSON.LineString | GeoJSON.MultiLineString {
  const canonical = coordinates.map(
    ([longitude, latitude]) => [canonicalLongitude(longitude), latitude] as LonLat,
  );
  if (coordinates.length < 2) {
    return { type: 'LineString', coordinates: canonical };
  }

  const lines: LonLat[][] = [[[canonical[0][0], canonical[0][1]]]];
  for (let index = 1; index < canonical.length; index += 1) {
    const previous = canonical[index - 1];
    const current = canonical[index];
    const rawDelta = current[0] - previous[0];
    const line = lines[lines.length - 1];
    if (Math.abs(rawDelta) <= 180) {
      line.push([current[0], current[1]]);
      continue;
    }

    const shortDelta = normalizeLonDeltaDeg(rawDelta);
    if (shortDelta === 0) {
      line.push([current[0], current[1]]);
      continue;
    }
    const crossingLongitude = shortDelta > 0 ? 180 : -180;
    const unwrappedLongitude = previous[0] + shortDelta;
    const fraction = (crossingLongitude - previous[0]) / (unwrappedLongitude - previous[0]);
    const crossingLatitude = previous[1] + (current[1] - previous[1]) * fraction;
    line.push([crossingLongitude, crossingLatitude]);
    lines.push([
      [crossingLongitude === 180 ? -180 : 180, crossingLatitude],
      [current[0], current[1]],
    ]);
  }

  return lines.length === 1
    ? { type: 'LineString', coordinates: lines[0] }
    : { type: 'MultiLineString', coordinates: lines };
}
