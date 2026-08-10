import { etaSeconds } from './route-geometry';

// Planned-arrival arithmetic for the route plan table: the chosen departure plus cumulative
// distance over the explicit planning speed. Deliberately never a live, weather-, current-,
// tack-, or polar-aware estimate; the nav strip's live ETA is a separate, separately labeled
// number.

export function plannedArrivalMs(
  departureMs: number,
  cumulativeMeters: number,
  planSpeedMps: number,
): number | undefined {
  if (!Number.isFinite(departureMs)) return undefined;
  const seconds = etaSeconds(cumulativeMeters, planSpeedMps);
  return seconds === undefined ? undefined : departureMs + seconds * 1000;
}

// Whether two epochs land on different LOCAL calendar days, so an arrival past midnight names its
// date instead of showing a clock time that reads earlier than the departure.
export function crossesLocalMidnight(fromMs: number, toMs: number): boolean {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  return (
    from.getFullYear() !== to.getFullYear() ||
    from.getMonth() !== to.getMonth() ||
    from.getDate() !== to.getDate()
  );
}
