import { type LonLat, wrapLongitude } from '$shared/geo';
import { clamp } from '$shared/lib';
import { COG_MIN_SOG_MPS } from './course-vector';
import { geodesicDestination, haversineMeters, normalizeLonDeltaDeg } from './distance';

// How far past a fix the drawn own-ship position may be extrapolated, roughly two missed fixes at
// the ~1 Hz position cadence. Beyond it the ship holds at the last reckoned point: extending a
// guess further would draw motion no receiver has confirmed.
export const DEAD_RECKONING_HORIZON_MS = 3_000;

// How long a fresh fix takes to pull the drawn position onto the new reckoning. Short enough to
// stay honest about where the fix says the boat is, long enough that the 1 Hz correction reads as
// a glide rather than a snap.
export const DEAD_RECKONING_CONVERGE_MS = 300;

// The plausibility bound for smoothing camera and icon motion: a jump past this applies
// immediately, because teleporting is honest when the fix says the boat moved that far.
export const MOTION_SNAP_METERS = 50;

// Advance a fix along course over ground at speed over ground for the elapsed time, capped at the
// reckoning horizon. Returns [longitude, latitude] (GeoJSON order); an elapsed time that moves the
// boat nowhere returns the fix itself exactly, so a resting reckoning cannot drift by formula
// round-off.
export function deadReckonedPosition(
  latitude: number,
  longitude: number,
  cogRad: number,
  sogMps: number,
  elapsedMs: number,
): LonLat {
  const meters = sogMps * (clamp(elapsedMs, 0, DEAD_RECKONING_HORIZON_MS) / 1000);
  if (meters <= 0) return [longitude, latitude];
  return geodesicDestination(latitude, longitude, cogRad, meters);
}

// Linear blend between two [longitude, latitude] points, taking the short way across the
// antimeridian and wrapping the result back into range. The fraction is clamped, so an overrun
// frame lands exactly on the target.
export function blendLonLat(from: LonLat, to: LonLat, fraction: number): LonLat {
  const k = clamp(fraction, 0, 1);
  return [
    wrapLongitude(from[0] + normalizeLonDeltaDeg(to[0] - from[0]) * k),
    from[1] + (to[1] - from[1]) * k,
  ];
}

// A fix as the reckoner consumes it. An undefined course or speed disables advancing (the caller
// maps a stale input to undefined), and a speed under the shared COG-meaningful floor disables it
// too: GPS scatter owns the reported course down there.
export interface ReckonedFix {
  latitude: number;
  longitude: number;
  cogRad: number | undefined;
  sogMps: number | undefined;
}

export interface OwnShipReckoner {
  // Take a fix as the new reckoning anchor. When the currently drawn position is within the
  // plausibility bound of the new fix, the drawn position converges onto the new reckoning over
  // the convergence window; past the bound it snaps.
  accept(fix: ReckonedFix, nowMs: number): void;
  // The position to draw at this instant, [longitude, latitude], or undefined before any fix.
  position(nowMs: number): LonLat | undefined;
  // Whether the drawn position can still move without a new fix: a convergence is in progress, or
  // reckoning is enabled and the horizon has not run out. The caller's frame loop runs only while
  // this holds.
  active(nowMs: number): boolean;
  reset(): void;
}

function reckoningEnabled(fix: ReckonedFix): boolean {
  return fix.cogRad !== undefined && fix.sogMps !== undefined && fix.sogMps >= COG_MIN_SOG_MPS;
}

function reckonedTarget(fix: ReckonedFix, elapsedMs: number): LonLat {
  if (!reckoningEnabled(fix) || fix.cogRad === undefined || fix.sogMps === undefined) {
    return [fix.longitude, fix.latitude];
  }
  return deadReckonedPosition(fix.latitude, fix.longitude, fix.cogRad, fix.sogMps, elapsedMs);
}

export function createOwnShipReckoner(): OwnShipReckoner {
  let fix: ReckonedFix | undefined;
  let receiptMs = 0;
  let convergeFrom: LonLat | undefined;
  let convergeStartMs = 0;

  function position(nowMs: number): LonLat | undefined {
    if (!fix) return undefined;
    const target = reckonedTarget(fix, nowMs - receiptMs);
    if (convergeFrom !== undefined) {
      const fraction = (nowMs - convergeStartMs) / DEAD_RECKONING_CONVERGE_MS;
      if (fraction < 1) return blendLonLat(convergeFrom, target, fraction);
      convergeFrom = undefined;
    }
    return target;
  }

  return {
    accept(next, nowMs) {
      const drawn = position(nowMs);
      fix = next;
      receiptMs = nowMs;
      convergeFrom = undefined;
      if (drawn === undefined) return;
      const jumpMeters = haversineMeters(drawn[1], drawn[0], next.latitude, next.longitude);
      if (jumpMeters === 0 || jumpMeters > MOTION_SNAP_METERS) return;
      convergeFrom = drawn;
      convergeStartMs = nowMs;
    },
    position,
    active(nowMs) {
      if (!fix) return false;
      if (convergeFrom !== undefined && nowMs - convergeStartMs < DEAD_RECKONING_CONVERGE_MS) {
        return true;
      }
      return reckoningEnabled(fix) && nowMs - receiptMs < DEAD_RECKONING_HORIZON_MS;
    },
    reset() {
      fix = undefined;
      receiptMs = 0;
      convergeFrom = undefined;
      convergeStartMs = 0;
    },
  };
}
