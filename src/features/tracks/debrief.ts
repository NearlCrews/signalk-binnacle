import type { TrackPoint } from '$entities/track';
import { METERS_PER_NAUTICAL_MILE } from '$shared/lib';
import { haversineMeters } from '$shared/nav';

// Below this made-good speed (about half a knot) a leg counts as holding station: anchored,
// docked, or drifting, not making way. Legs are classified by distance over time rather than the
// endpoints' SOG because the recorder's min-move veto turns a whole stop into one long leg whose
// endpoints were both moving.
export const UNDERWAY_FLOOR_MPS = 0.26;

// The debrief card renders only once the recording is a passage rather than a maneuver: at least
// ten minutes and a quarter of a nautical mile.
export const DEBRIEF_MIN_DURATION_SECONDS = 600;
export const DEBRIEF_MIN_DISTANCE_METERS = METERS_PER_NAUTICAL_MILE / 4;

export interface DebriefLeg {
  startMs: number;
  endMs: number;
  distanceMeters: number;
  durationSeconds: number;
}

export interface PassageDebrief {
  startMs: number;
  endMs: number;
  // Wall-clock span of the recording, including stops and recording gaps.
  totalSeconds: number;
  underwaySeconds: number;
  stoppedSeconds: number;
  distanceMeters: number;
  // Made-good distance over time while underway, not a mean of SOG samples: the recorder keeps
  // points only on movement, so sample-weighted SOG would overweight the fastest stretches.
  avgUnderwaySog: number;
  maxUnderwaySog: number;
  // The continuous underway run (no stop, no recording gap) covering the most distance.
  longestLeg: DebriefLeg | undefined;
}

export function computePassageDebrief(points: readonly TrackPoint[]): PassageDebrief | undefined {
  if (points.length < 2) return undefined;
  let distanceMeters = 0;
  let underwaySeconds = 0;
  let stoppedSeconds = 0;
  let underwayMeters = 0;
  let maxUnderwaySog = 0;
  let longestLeg: DebriefLeg | undefined;
  let runStartMs: number | undefined;
  let runEndMs = 0;
  let runMeters = 0;

  function closeRun(): void {
    if (runStartMs === undefined) return;
    if (!longestLeg || runMeters > longestLeg.distanceMeters) {
      longestLeg = {
        startMs: runStartMs,
        endMs: runEndMs,
        distanceMeters: runMeters,
        durationSeconds: (runEndMs - runStartMs) / 1000,
      };
    }
    runStartMs = undefined;
    runMeters = 0;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    // A gap leg is a dropout: no distance was observed across it, and its time belongs to
    // neither the underway nor the stopped bucket.
    if (point.gap) {
      closeRun();
      continue;
    }
    const dtSeconds = (point.t - previous.t) / 1000;
    if (dtSeconds <= 0) continue;
    const legMeters = haversineMeters(previous.lat, previous.lon, point.lat, point.lon);
    distanceMeters += legMeters;
    if (legMeters / dtSeconds >= UNDERWAY_FLOOR_MPS) {
      underwaySeconds += dtSeconds;
      underwayMeters += legMeters;
      if (previous.sog > maxUnderwaySog) maxUnderwaySog = previous.sog;
      if (point.sog > maxUnderwaySog) maxUnderwaySog = point.sog;
      if (runStartMs === undefined) runStartMs = previous.t;
      runEndMs = point.t;
      runMeters += legMeters;
    } else {
      stoppedSeconds += dtSeconds;
      closeRun();
    }
  }
  closeRun();

  const startMs = points[0].t;
  const endMs = points[points.length - 1].t;
  return {
    startMs,
    endMs,
    totalSeconds: (endMs - startMs) / 1000,
    underwaySeconds,
    stoppedSeconds,
    distanceMeters,
    avgUnderwaySog: underwaySeconds > 0 ? underwayMeters / underwaySeconds : 0,
    maxUnderwaySog,
    longestLeg,
  };
}

export function debriefReady(debrief: PassageDebrief): boolean {
  return (
    debrief.totalSeconds >= DEBRIEF_MIN_DURATION_SECONDS &&
    debrief.distanceMeters >= DEBRIEF_MIN_DISTANCE_METERS
  );
}
