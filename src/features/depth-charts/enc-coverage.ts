import { bboxContainsPoint, type LatLon, splitAtAntimeridian } from '$shared/geo';
import { requireCatalogSource } from '$shared/map';

// The one streaming navigation chart, so a boat inside its waters can be offered a real chart
// instead of staring at a reference map with nothing pointing at the fix.
export const NOAA_ENC_SOURCE_ID = 'depth-noaa-enc';

// Whether the fix falls inside NOAA's published ENC coverage. The regional boxes come from the
// catalog, never from the service's near-worldwide envelope bounds: the envelope would claim the
// whole Pacific. An upstream box may cross the antimeridian (the type permits it, and the Aleutians
// are a real candidate), so each is cut at the seam before the containment test, which cannot read
// a box whose west exceeds its east.
export function noaaEncCoversPosition(position: LatLon): boolean {
  const coverage = requireCatalogSource(NOAA_ENC_SOURCE_ID).coverage;
  if (!coverage) return false;
  return coverage.some((box) =>
    splitAtAntimeridian([...box]).some((part) => bboxContainsPoint(part, position)),
  );
}
