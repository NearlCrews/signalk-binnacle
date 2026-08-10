import { radiansToBearing } from '$shared/lib';
import type { ChartOrientationMode } from '$shared/settings';

// Resolves the chart's programmatic bearing from the chosen orientation mode and the live
// references. North-up is the default; course-up and heading-up rotate only while their reference
// is fresh (and, for course-up, the boat is actually making way, since COG below steerage is
// noise), and fall back to north immediately otherwise. User rotation gestures stay disabled:
// this resolver is the only author of map bearing.

// Below this speed over ground the COG is not a steady reference to rotate a chart by. The same
// idea as the AIS stationary treatment: a boat at rest has no course.
export const ORIENTATION_MIN_SOG_MPS = 0.5;

export type OrientationFallback =
  | 'no-heading'
  | 'stale-heading'
  | 'no-cog'
  | 'stale-cog'
  | 'low-speed';

export interface OrientationInputs {
  mode: ChartOrientationMode;
  headingRad: number | undefined;
  headingStale: boolean;
  cogRad: number | undefined;
  cogStale: boolean;
  sogMps: number | undefined;
  sogStale: boolean;
}

export interface OrientationResult {
  // The map bearing to command, degrees clockwise from north.
  bearingDeg: number;
  // True while the chosen mode's reference is fresh and driving the rotation. North-up is always
  // active: it needs no reference.
  active: boolean;
  // Why a rotating mode fell back to north, when it did.
  fallback?: OrientationFallback;
  // The helm label: the mode, or the mode plus its fallback, always naming the reference.
  label: string;
}

export function resolveOrientation(inputs: OrientationInputs): OrientationResult {
  if (inputs.mode === 'north') {
    return { bearingDeg: 0, active: true, label: 'North up' };
  }
  if (inputs.mode === 'heading') {
    if (inputs.headingRad === undefined) {
      return {
        bearingDeg: 0,
        active: false,
        fallback: 'no-heading',
        label: 'North up (no true heading)',
      };
    }
    if (inputs.headingStale) {
      return {
        bearingDeg: 0,
        active: false,
        fallback: 'stale-heading',
        label: 'North up (true heading stale)',
      };
    }
    return {
      bearingDeg: radiansToBearing(inputs.headingRad) ?? 0,
      active: true,
      label: 'Heading up (true)',
    };
  }
  if (inputs.cogRad === undefined) {
    return { bearingDeg: 0, active: false, fallback: 'no-cog', label: 'North up (no COG)' };
  }
  if (inputs.cogStale) {
    return { bearingDeg: 0, active: false, fallback: 'stale-cog', label: 'North up (COG stale)' };
  }
  if (inputs.sogMps === undefined || inputs.sogStale || inputs.sogMps < ORIENTATION_MIN_SOG_MPS) {
    return {
      bearingDeg: 0,
      active: false,
      fallback: 'low-speed',
      label: 'North up (too slow for course up)',
    };
  }
  return {
    bearingDeg: radiansToBearing(inputs.cogRad) ?? 0,
    active: true,
    label: 'Course up (COG)',
  };
}
