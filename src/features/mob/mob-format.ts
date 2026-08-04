import { formatBearingOr, formatMetersOrNm, type UnitsMode } from '$shared/lib';

// Elapsed time as m:ss (or h:mm:ss past an hour): a recovery is timed in seconds and minutes,
// where the shared formatDuration's whole-minute readout is too coarse.
export function formatElapsed(seconds: number): string {
  const whole = Math.floor(seconds);
  const s = (whole % 60).toString().padStart(2, '0');
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s}`;
  return `${m}:${s}`;
}

// The strip's unit abbreviations as spoken words, so the assertive announcement does not read "nm"
// letter by letter.
const SPOKEN_RANGE_UNITS: Record<string, string> = {
  m: 'meters',
  ft: 'feet',
  nm: 'nautical miles',
};

function spokenRange(meters: number, mode: UnitsMode): string {
  // Built from the strip's own Range readout so the announced number and the visible one can never
  // disagree about the meters-to-nautical-miles hand-off.
  const reading = formatMetersOrNm(meters, mode);
  const split = reading.lastIndexOf(' ');
  const spoken = SPOKEN_RANGE_UNITS[reading.slice(split + 1)];
  return spoken ? `${reading.slice(0, split)} ${spoken}` : reading;
}

// The man-overboard live-region text: the app's most urgent announcement, carrying the same bearing
// and range the strip shows so a screen-reader user gets the direction to steer, not only the alarm.
// Without a fix on both ends there is no guidance to give, and the bare call stands alone.
export function mobAlertText(
  bearingRad: number | undefined,
  distanceMeters: number | undefined,
  mode: UnitsMode,
): string {
  if (bearingRad === undefined || distanceMeters === undefined) {
    return 'Man overboard. Steer back to the mark.';
  }
  const bearing = formatBearingOr(bearingRad);
  return `Man overboard. Mark is ${bearing} degrees, ${spokenRange(distanceMeters, mode)}. Steer back to the mark.`;
}
