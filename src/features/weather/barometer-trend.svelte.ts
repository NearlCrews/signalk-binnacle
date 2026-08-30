import { untrack } from 'svelte';
import { MINUTE_MS, nearestBySorted, type ReactiveClock } from '$shared/lib';
import { PRESSURE_TREND_WINDOW_MS } from './weather-readout';

// The boat's own barometer graded against the standard 3-hour tendency window. 300 Pa (3 hPa) per
// 3 hours falling signals a developing system, and 600 Pa (6 hPa) per 3 hours is the classic
// approaching-gale fall rate; rising mirrors the same bands. The slow band keeps a genuine but
// sub-caution drift from reading as either steady or a caution.
export type BarometerGrade =
  | 'rising-fast'
  | 'rising'
  | 'rising-slowly'
  | 'steady'
  | 'falling-slowly'
  | 'falling'
  | 'falling-fast';

const STEADY_BAND_PA_3H = 100;
const TREND_PA_3H = 300;
const RAPID_PA_3H = 600;

export const BAROMETER_GRADE_WORDS: Record<BarometerGrade, string> = {
  'rising-fast': 'rising fast',
  rising: 'rising',
  'rising-slowly': 'rising slowly',
  steady: 'steady',
  'falling-slowly': 'falling slowly',
  falling: 'falling',
  'falling-fast': 'falling fast',
};

export interface BarometerTendency {
  // The measured change normalized to the 3-hour window (Pa per 3 h, negative falling).
  ratePa3h: number;
  // The raw change over the span actually observed.
  deltaPa: number;
  spanMs: number;
  // True while the history spans at least the provisional hour but less than the full window.
  provisional: boolean;
  grade: BarometerGrade;
}

interface BarometerTrendDeps {
  // The boat's own barometer in Pa (SI), a getter so the value never freezes at construction.
  pressurePa: () => number | undefined;
  // True while the sensor's last value is stale: a held reading must not flatten the tendency.
  stale: () => boolean;
  clock: ReactiveClock;
}

// Sea-level records span about 870 to 1085 hPa; a reading outside a generous band around that is
// unit confusion (hPa published as Pa) and would poison every tendency it enters.
const MIN_PLAUSIBLE_PA = 85_000;
const MAX_PLAUSIBLE_PA = 110_000;

const SAMPLE_INTERVAL_MS = MINUTE_MS;
// A first watch should not be blind for three hours: after this much history the tendency is
// exposed, flagged provisional, at the observed change normalized to the 3-hour pace.
const PROVISIONAL_MIN_MS = 60 * MINUTE_MS;
// Enough slack past the window that the anchor sample near 3 hours back always survives pruning,
// while a sensor blackout longer than the slack restarts the history rather than bridging it.
const RETENTION_MS = PRESSURE_TREND_WINDOW_MS + 10 * MINUTE_MS;
const MAX_SAMPLES = 240;

interface PressureSample {
  timeMs: number;
  pa: number;
}

// Records the boat's own pressure sensor into a bounded session-only ring and grades the trailing
// tendency from it. This describes what the barometer aboard has actually done, so it reads only
// the live sensor and the wall clock: the forecast time slider can never move it.
export function createBarometerTrend(deps: BarometerTrendDeps) {
  const samples = $state<PressureSample[]>([]);

  function record(now: number, pa: number): void {
    const last = samples[samples.length - 1];
    if (last !== undefined) {
      // A clock step past the newest sample corrupts every span, so the history restarts.
      if (now < last.timeMs - SAMPLE_INTERVAL_MS) samples.length = 0;
      else if (now - last.timeMs < SAMPLE_INTERVAL_MS) return;
    }
    samples.push({ timeMs: now, pa });
    const cutoff = now - RETENTION_MS;
    let drop = 0;
    while (drop < samples.length - 1 && samples[drop].timeMs < cutoff) drop += 1;
    if (samples.length > MAX_SAMPLES) drop = Math.max(drop, samples.length - MAX_SAMPLES);
    if (drop > 0) samples.splice(0, drop);
  }

  $effect(() => {
    const now = deps.clock.now;
    const pa = deps.pressurePa();
    if (pa === undefined || pa < MIN_PLAUSIBLE_PA || pa > MAX_PLAUSIBLE_PA) return;
    if (deps.stale()) return;
    // Untracked: the recorder reads and mutates the ring, and tracking it would re-run the effect
    // on its own writes.
    untrack(() => record(now, pa));
  });

  // Derived from the samples alone, never the ticking clock, so it changes when a sample lands
  // rather than every second, and it describes the sensor's history as of its newest reading.
  const tendency = $derived.by((): BarometerTendency | undefined => {
    const latest = samples[samples.length - 1];
    if (latest === undefined) return undefined;
    const anchor = nearestBySorted(
      samples,
      (sample) => sample.timeMs,
      latest.timeMs - PRESSURE_TREND_WINDOW_MS,
    );
    if (anchor === undefined) return undefined;
    const spanMs = latest.timeMs - anchor.timeMs;
    if (spanMs < PROVISIONAL_MIN_MS) return undefined;
    const deltaPa = latest.pa - anchor.pa;
    const ratePa3h = (deltaPa * PRESSURE_TREND_WINDOW_MS) / spanMs;
    return {
      ratePa3h,
      deltaPa,
      spanMs,
      provisional: spanMs < PRESSURE_TREND_WINDOW_MS - SAMPLE_INTERVAL_MS,
      grade: gradeOf(ratePa3h),
    };
  });

  return {
    get tendency(): BarometerTendency | undefined {
      return tendency;
    },
  };
}

function gradeOf(ratePa3h: number): BarometerGrade {
  if (ratePa3h <= -RAPID_PA_3H) return 'falling-fast';
  if (ratePa3h <= -TREND_PA_3H) return 'falling';
  if (ratePa3h < -STEADY_BAND_PA_3H) return 'falling-slowly';
  if (ratePa3h >= RAPID_PA_3H) return 'rising-fast';
  if (ratePa3h >= TREND_PA_3H) return 'rising';
  if (ratePa3h > STEADY_BAND_PA_3H) return 'rising-slowly';
  return 'steady';
}
