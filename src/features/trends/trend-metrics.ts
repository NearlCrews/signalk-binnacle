import type {
  InstrumentTrendDescriptor,
  InstrumentTrendDisplayKind,
} from '$entities/instrument-trend';
import {
  CUBIC_METERS_TO_US_GALLONS,
  lengthUnit,
  metersPerSecondToKnots,
  metersToFeet,
  pressureUnit,
  pressureValue,
  RAD_TO_DEG,
  temperatureUnit,
  type UnitsMode,
} from '$shared/lib';

// One series in epoch seconds and Signal K SI values. Null marks a gap.
export interface TrendSeries {
  times: readonly number[];
  values: ReadonlyArray<number | null>;
}

export interface AttributedTrendSeries extends TrendSeries {
  path?: string;
  referenceLabel?: string;
  provider?: string;
}

interface TrendDisplay {
  convert: (si: number) => number | undefined;
  unit: string;
  digits: number;
}

const identity = (value: number): number => value;

function displayUnit(kind: InstrumentTrendDisplayKind, mode: UnitsMode): string {
  switch (kind) {
    case 'speed':
      return 'kn';
    case 'depth':
      return lengthUnit(mode);
    case 'pressure':
      return pressureUnit(mode);
    case 'temperature':
      return temperatureUnit(mode);
    case 'ratio':
      return '%';
    case 'rpm':
      return 'rpm';
    case 'duration':
      return 'h';
    case 'rate-of-turn':
      return '°/min';
    case 'voltage':
      return 'V';
    case 'current':
      return 'A';
    case 'volume':
      return mode === 'imperial' ? 'gal' : 'L';
    case 'power':
      return 'W';
    case 'count':
      return '';
  }
}

function converter(
  kind: InstrumentTrendDisplayKind,
  mode: UnitsMode,
): (si: number) => number | undefined {
  switch (kind) {
    case 'speed':
      return metersPerSecondToKnots;
    case 'depth':
      return mode === 'imperial' ? metersToFeet : identity;
    case 'pressure':
      return (value) => pressureValue(value, mode);
    case 'temperature':
      return (value) => {
        const celsius = value - 273.15;
        return mode === 'imperial' ? celsius * (9 / 5) + 32 : celsius;
      };
    case 'ratio':
      return (value) => value * 100;
    case 'rpm':
      return (value) => value * 60;
    case 'duration':
      return (value) => value / 3600;
    case 'rate-of-turn':
      return (value) => value * RAD_TO_DEG * 60;
    case 'volume':
      return mode === 'imperial'
        ? (value) => value * CUBIC_METERS_TO_US_GALLONS
        : (value) => value * 1000;
    case 'voltage':
    case 'current':
    case 'power':
    case 'count':
      return identity;
  }
}

export function trendDisplayFor(
  descriptor: InstrumentTrendDescriptor,
  mode: UnitsMode,
): TrendDisplay {
  return {
    convert: converter(descriptor.display, mode),
    unit: displayUnit(descriptor.display, mode),
    digits: mode === 'imperial' ? descriptor.imperialPrecision : descriptor.metricPrecision,
  };
}

export function hasTrendSamples(series: TrendSeries | undefined): boolean {
  return series?.values.some((value) => value != null) ?? false;
}

// The honesty summary for one series: how much of it actually holds samples, where its longest
// hole is, and how old the newest sample is. Undefined means no samples at all, which the caller
// must present as no data, never as an empty-but-healthy series. Explicit nulls stay in the series
// itself; this only measures them.
export interface TrendCoverage {
  lastSampleAgeSec: number;
  // Non-null samples over total slots, 0 to 1.
  coverageFraction: number;
  // The widest time span between consecutive non-null samples; 0 with fewer than two samples.
  longestGapSec: number;
  partial: boolean;
  stale: boolean;
}

// A series missing more than a tenth of its slots is marked partial.
const TREND_PARTIAL_BELOW = 0.9;
// A newest sample older than this, or than three median sample intervals when that is longer, is
// marked stale: the chart still shows history, but its right edge is not the present.
export const TREND_STALE_AFTER_SEC = 600;

export function trendCoverage(series: TrendSeries, nowSec: number): TrendCoverage | undefined {
  const sampleTimes: number[] = [];
  for (let index = 0; index < series.values.length; index += 1) {
    if (series.values[index] != null && Number.isFinite(series.times[index])) {
      sampleTimes.push(series.times[index]);
    }
  }
  if (sampleTimes.length === 0) return undefined;
  const lastSampleAgeSec = Math.max(0, nowSec - (sampleTimes.at(-1) ?? nowSec));
  const coverageFraction = sampleTimes.length / series.values.length;
  let longestGapSec = 0;
  const intervals: number[] = [];
  for (let index = 1; index < sampleTimes.length; index += 1) {
    const gap = sampleTimes[index] - sampleTimes[index - 1];
    intervals.push(gap);
    longestGapSec = Math.max(longestGapSec, gap);
  }
  const medianInterval =
    intervals.length > 0
      ? intervals.toSorted((a, b) => a - b)[Math.floor(intervals.length / 2)]
      : 0;
  return {
    lastSampleAgeSec,
    coverageFraction,
    longestGapSec,
    partial: coverageFraction < TREND_PARTIAL_BELOW,
    stale: lastSampleAgeSec > Math.max(TREND_STALE_AFTER_SEC, 3 * medianInterval),
  };
}
