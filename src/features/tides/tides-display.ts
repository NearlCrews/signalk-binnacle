import type { CurrentEvent, TideEvent, TideStationSelection, TidesSource } from '$entities/tides';
import {
  formatFixed,
  formatKnots,
  landDistanceUnit,
  METERS_PER_MILE,
  metersToFeet,
  type UnitsMode,
} from '$shared/lib';

// The display edge: SI in, formatted strings out. Tide heights are shown in both meters and feet,
// with the preferred unit first, current rates in knots, the conventional units a mariner reads.

function heightMeters(meters: number): string {
  return `${formatFixed(meters, 2)} m`;
}

function heightFeet(meters: number): string {
  return `${formatFixed(metersToFeet(meters) ?? 0, 1)} ft`;
}

export function formatTideHeight(meters: number, mode: UnitsMode): string {
  return mode === 'imperial' ? heightFeet(meters) : heightMeters(meters);
}

// The other unit, shown in parentheses beside the primary height.
export function formatTideHeightSecondary(meters: number, mode: UnitsMode): string {
  return mode === 'imperial' ? heightMeters(meters) : heightFeet(meters);
}

export function formatCurrentRate(mps: number): string {
  return `${formatKnots(mps)} kn`;
}

// The distance to the nearest station for the proximity readout: whole kilometers or statute
// miles, with a "<1" floor.
export function formatStationDistance(meters: number, mode: UnitsMode): string {
  const value = mode === 'imperial' ? meters / METERS_PER_MILE : meters / 1000;
  const unit = landDistanceUnit(mode);
  return value < 1 ? `<1 ${unit}` : `${Math.round(value)} ${unit}`;
}

// The quiet provenance line under the readings: which source served the tide prediction and which
// part of the result always comes from NOAA CO-OPS.
export function tideSourceNote(
  source: TidesSource | undefined,
  selection: TideStationSelection = { mode: 'automatic' },
): string {
  if (selection.mode === 'manual') {
    return 'The manually selected tide station and all tidal-current predictions use NOAA CO-OPS.';
  }
  if (source === 'signalk-tides') {
    return 'Automatic tide predictions use the signalk-tides plugin. Tidal-current predictions use NOAA CO-OPS.';
  }
  if (source === 'noaa-coops') {
    return 'Automatic tide and tidal-current predictions use NOAA CO-OPS.';
  }
  return '';
}

// The high and low events at or after a reference time, soonest first, for the next-tide readout.
// Events arrive already sorted ascending by time (both the CO-OPS and signalk-tides parsers sort),
// and filter preserves order, so no re-sort is needed on this per-tick path.
export function upcomingEvents(events: TideEvent[], nowMs: number): TideEvent[] {
  return events.filter((event) => event.timeMs >= nowMs);
}

// The next flood or ebb at or after a reference time (slack is skipped), for the current readout.
// Events are pre-sorted ascending (see upcomingEvents), so the first match is the soonest.
export function nextCurrentEvent(events: CurrentEvent[], nowMs: number): CurrentEvent | undefined {
  return events.find((event) => event.timeMs >= nowMs && event.kind !== 'slack');
}

// The next high or low at or after a reference time, for the station marker label. Events are
// pre-sorted ascending (see upcomingEvents), so the first match is the soonest.
export function nextTideEvent(events: TideEvent[], nowMs: number): TideEvent | undefined {
  return events.find((event) => event.timeMs >= nowMs);
}

// Normalize the day's high and low turning points to a 0..1 box for an SVG tide curve: x over the
// span of events, y from the lowest tide (0) to the highest (1).
export function tideCurvePoints(events: TideEvent[]): Array<{ x: number; y: number }> {
  if (events.length === 0) return [];
  // Events are pre-sorted ascending by time, so the span ends are the first and last, no spread.
  const t0 = events[0].timeMs;
  const tSpan = events[events.length - 1].timeMs - t0 || 1;
  // One pass for the height extent, no spread into Math.min/max (which is unbounded in arg count).
  let h0 = events[0].heightMeters;
  let hMax = h0;
  for (const e of events) {
    if (e.heightMeters < h0) h0 = e.heightMeters;
    else if (e.heightMeters > hMax) hMax = e.heightMeters;
  }
  const hSpan = hMax - h0 || 1;
  return events.map((e) => ({ x: (e.timeMs - t0) / tSpan, y: (e.heightMeters - h0) / hSpan }));
}

// Where "now" falls along the tide curve's x axis, or undefined when it is outside the event span.
export function nowFraction(events: TideEvent[], nowMs: number): number | undefined {
  if (events.length === 0) return undefined;
  // Pre-sorted ascending by time, so the span ends are the first and last entries.
  const t0 = events[0].timeMs;
  const t1 = events[events.length - 1].timeMs;
  if (nowMs < t0 || nowMs > t1) return undefined;
  return (nowMs - t0) / (t1 - t0 || 1);
}
