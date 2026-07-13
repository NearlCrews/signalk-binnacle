// The default layer selection for a new offline area: the chart that actually covers the box plus the
// essentials, with specialist and facet layers left off so a novice gets a usable area without
// touching the source list. NOAA ENC reports a nearly global service envelope with sparse actual
// coverage, so its automatic selection uses conservative US coverage areas below.

import type { Bbox, ChartSource } from 'signalk-chart-sources';
import { bboxIntersects } from '$shared/geo';
import { isFacet, isSpecialist } from './source-summary.js';

const NOAA_ENC_ID = 'depth-noaa-enc';

// Broad coastal boxes for the United States and its island territories. These control only the
// initial checkbox state. The package service envelope remains authoritative for rendering and
// downloads, and navigators can select NOAA ENC manually anywhere it is offered.
const NOAA_ENC_DEFAULT_COVERAGE: readonly Bbox[] = [
  [-130, 18, -60, 55], // Contiguous US, Great Lakes, Puerto Rico, and US Virgin Islands
  [170, 45, -130, 75], // Alaska and the Aleutian Islands, crossing the antimeridian
  [-161, 18, -154, 23], // Hawaii
  [139, 9, 151, 24], // Guam and the Northern Mariana Islands
  [-172, -16, -168, -10], // American Samoa
];

/** The minimal sensible default for a new area: every covering source that is neither a facet nor a
 * specialist, which leaves the covering primary chart (NOAA ENC or EMODnet), the seamarks, and the
 * base map. Returns ids in covering order. */
export function defaultSelection(covering: ChartSource[], bbox: Bbox): string[] {
  return covering
    .filter(
      (source) =>
        !isFacet(source) &&
        !isSpecialist(source.id) &&
        (source.id !== NOAA_ENC_ID ||
          NOAA_ENC_DEFAULT_COVERAGE.some((coverage) => bboxIntersects(bbox, coverage))),
    )
    .map((source) => source.id);
}
