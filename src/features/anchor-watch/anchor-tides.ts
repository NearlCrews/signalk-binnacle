import type { TideEvent } from '$entities/tides';

export interface NextTideExtremes {
  high: TideEvent | undefined;
  low: TideEvent | undefined;
}

// The next high and the next low at or after the reference time. Events arrive pre-sorted
// ascending from the tides store (both source parsers sort), so the first match of each kind is
// the soonest.
export function nextTideExtremes(events: TideEvent[], nowMs: number): NextTideExtremes {
  let high: TideEvent | undefined;
  let low: TideEvent | undefined;
  for (const event of events) {
    if (event.timeMs < nowMs) continue;
    if (event.kind === 'high') high ??= event;
    else low ??= event;
    if (high && low) break;
  }
  return { high, low };
}
