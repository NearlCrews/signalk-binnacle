import { type Bbox4, isLonLat, type LonLat, splitAtAntimeridian } from '$shared/geo';
import { asKeyedObject, fetchAuthedJson } from '$shared/signalk';

// One recent-track line for a vessel from the tracks plugin (@signalk/tracks-plugin): the Signal K
// vessel context and a GeoJSON-order [longitude, latitude] line.
export interface AisTrail {
  context: string;
  line: LonLat[];
}

// The track-accumulation API the tracks plugin (plugin id `tracks`) mounts on the v1 REST root.
// The response keys each vessel context to a GeoJSON MultiLineString of its recent track.
const TRACKS_PATH = '/signalk/v1/api/tracks';
const MAX_TRAILS = 2_000;
const MAX_POINTS_PER_TRAIL = 10_000;
const MAX_POINTS_PER_RESPONSE = 100_000;

// The plugin parses its bbox query positionally into lat-first sw/ne tuples (validateParameters in
// @signalk/tracks), so the working order is south,west,north,east even though its README documents
// longitude first. The wrong order matches nothing, or 404s when south lands above north.
function bboxQuery([west, south, east, north]: Bbox4): string {
  return `${south},${west},${north},${east}`;
}

function asLine(value: unknown, remainingPoints: number): LonLat[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_POINTS_PER_TRAIL ||
    value.length > remainingPoints
  ) {
    return undefined;
  }
  const line: LonLat[] = [];
  for (const position of value) {
    if (!isLonLat(position)) return undefined;
    line.push(position);
  }
  return line;
}

// A trail entry is a GeoJSON MultiLineString ({ type, coordinates }); each member line becomes its
// own trail. A malformed line yields nothing rather than a partial wake, and a line needs at least
// two positions to draw.
function linesFromEntry(
  raw: unknown,
  remainingPoints: number,
  remainingTrails: number,
): LonLat[][] {
  if (!raw || typeof raw !== 'object') return [];
  const { coordinates } = raw as { coordinates?: unknown };
  if (!Array.isArray(coordinates)) return [];
  const lines: LonLat[][] = [];
  for (const candidate of coordinates) {
    const line = asLine(candidate, remainingPoints);
    if (line && line.length >= 2) {
      lines.push(line);
      remainingPoints -= line.length;
      remainingTrails -= 1;
      if (remainingPoints === 0 || remainingTrails === 0) break;
    }
  }
  return lines;
}

// Fetch the recent tracks of every vessel within the viewport. A failed or unreachable fetch
// returns undefined so the overlay keeps the wakes already shown; the plugin also answers 404 when
// installed but not running, and the route is absent without it, so undefined doubles as the
// degrade signal on a stock server.
export async function fetchAisTrails(
  base: string,
  token: string | undefined,
  bbox: Bbox4,
): Promise<AisTrail[] | undefined> {
  // A padded viewport at the antimeridian carries unwrapped longitudes, which the plugin cannot
  // match, so ask for each in-range piece. Away from the seam this is one box and one request.
  const boxes = splitAtAntimeridian(bbox);
  if (boxes.length === 0) return undefined;
  const trails: AisTrail[] = [];
  const seenContexts = new Set<string>();
  let acceptedPoints = 0;
  for (const box of boxes) {
    const keyed = asKeyedObject(
      await fetchAuthedJson<unknown>(`${base}${TRACKS_PATH}?bbox=${bboxQuery(box)}`, token),
    );
    // One failed piece leaves the area unanswered: a half-covered result would render as the whole
    // picture and silently drop the wakes on the other side of the seam.
    if (!keyed) return undefined;
    for (const [context, raw] of Object.entries(keyed)) {
      const remainingPoints = MAX_POINTS_PER_RESPONSE - acceptedPoints;
      if (trails.length >= MAX_TRAILS || remainingPoints === 0) break;
      // A vessel straddling the seam is returned by both pieces; keep the first line for it rather
      // than drawing the same wake twice.
      if (seenContexts.has(context)) continue;
      for (const line of linesFromEntry(raw, remainingPoints, MAX_TRAILS - trails.length)) {
        seenContexts.add(context);
        trails.push({ context, line });
        acceptedPoints += line.length;
        if (trails.length >= MAX_TRAILS || acceptedPoints >= MAX_POINTS_PER_RESPONSE) break;
      }
    }
  }
  return trails;
}
