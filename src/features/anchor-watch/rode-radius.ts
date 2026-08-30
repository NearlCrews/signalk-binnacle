import { isFiniteNumber } from '$shared/lib';

// The fixed allowance for GPS scatter on top of the geometric swing, so a boat lying at the end
// of its rode is not already on the alarm line.
export const RODE_GPS_MARGIN_M = 10;
// Suggestions round up to this step so the panel offers a clean number, never 53.7 m.
export const RODE_RADIUS_STEP_M = 5;

export interface RodeInputs {
  // Rode paid out from the bow to the anchor, in meters.
  rodeMeters: number | undefined;
  // Water depth at the anchor, in meters.
  depthMeters: number | undefined;
  // Boat length overall, in meters.
  boatLengthMeters: number | undefined;
}

export type RodeSuggestion =
  | { state: 'incomplete' }
  | { state: 'rode-short' }
  | { state: 'ok'; swingMeters: number; radiusMeters: number };

// The watch radius the paid-out rode implies: horizontal swing sqrt(rode^2 - depth^2), plus the
// boat length (the GPS antenna can sit anywhere along the hull), plus the GPS margin, rounded up
// to the step. A rode no longer than the depth means the anchor is hanging, not set on the
// bottom: an error state, never a zero-swing suggestion.
export function suggestWatchRadius({
  rodeMeters,
  depthMeters,
  boatLengthMeters,
}: RodeInputs): RodeSuggestion {
  if (
    !isFiniteNumber(rodeMeters) ||
    rodeMeters <= 0 ||
    !isFiniteNumber(depthMeters) ||
    depthMeters <= 0 ||
    !isFiniteNumber(boatLengthMeters) ||
    boatLengthMeters <= 0
  ) {
    return { state: 'incomplete' };
  }
  if (rodeMeters <= depthMeters) return { state: 'rode-short' };
  const swingMeters = Math.sqrt(rodeMeters * rodeMeters - depthMeters * depthMeters);
  const radiusMeters =
    Math.ceil((swingMeters + boatLengthMeters + RODE_GPS_MARGIN_M) / RODE_RADIUS_STEP_M) *
    RODE_RADIUS_STEP_M;
  return { state: 'ok', swingMeters, radiusMeters };
}
