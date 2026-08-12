import { bboxContainsPoint, type LatLon, splitAtAntimeridian } from '$shared/geo';
import { hasVisibleNavigationChart, requireCatalogSource } from '$shared/map';

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

export interface EncPromptConditions {
  // Dismissed once, never offered again on this device.
  dismissed: boolean;
  // An emergency owns the screen; a chart suggestion does not interrupt it.
  emergencyActive: boolean;
  // A docked panel is already using the space the banner would take.
  panelOpen: boolean;
  // Undefined while the layer list is still resolving, which is not yet a no-chart answer.
  layers: readonly { visible: boolean; chart?: unknown; chartCoverage?: unknown }[] | undefined;
  position: LatLon | undefined;
  positionStale: boolean;
}

// Whether to offer the NOAA ENC chart. Extracted from the composition root so the whole gate is
// testable: it previously compared a `PanelId | null` against `undefined`, which is always true, and
// the offer never rendered once. Only the coverage half had a test.
export function shouldOfferNoaaEnc(conditions: EncPromptConditions): boolean {
  const { dismissed, emergencyActive, panelOpen, layers, position, positionStale } = conditions;
  if (dismissed || emergencyActive || panelOpen) return false;
  if (!layers || hasVisibleNavigationChart(layers)) return false;
  return position !== undefined && !positionStale && noaaEncCoversPosition(position);
}
