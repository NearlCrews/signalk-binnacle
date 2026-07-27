// The default layer selection for a new offline area: the chart that actually covers the box plus the
// essentials, with specialist and facet layers left off so a novice gets a usable area without
// touching the source list. The caller supplies only sources whose catalog coverage intersects the
// area, so this selection does not maintain a second source-coverage policy.

import type { ChartSource } from 'signalk-chart-sources';
import { isFacet, isSpecialist } from './source-summary.js';

/** The minimal sensible default for a new area: every covering source that is neither a facet nor a
 * specialist, which leaves the covering primary chart (NOAA ENC or EMODnet), the seamarks, and the
 * base map. Returns ids in covering order. */
export function defaultSelection(covering: ChartSource[]): string[] {
  return covering
    .filter((source) => !isFacet(source) && !isSpecialist(source.id))
    .map((source) => source.id);
}
