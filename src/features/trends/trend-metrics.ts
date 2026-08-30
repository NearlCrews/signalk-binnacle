import type {
  InstrumentTrendDescriptor,
  InstrumentTrendDisplayKind,
} from '$entities/instrument-trend';
import {
  CUBIC_METERS_TO_US_GALLONS,
  lengthUnit,
  metersToFeet,
  pressureUnit,
  pressureValue,
  RAD_TO_DEG,
  resolveUnits,
  speedUnit,
  speedValue,
  temperatureUnit,
  type UnitsProfile,
  type UnitsSelection,
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

function displayUnit(kind: InstrumentTrendDisplayKind, units: UnitsProfile): string {
  switch (kind) {
    case 'speed':
      return speedUnit(units);
    case 'depth':
      return lengthUnit(units);
    case 'pressure':
      return pressureUnit(units);
    case 'temperature':
      return temperatureUnit(units);
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
      // The profile carries no volume category; the length family is the coarse imperial signal,
      // the same read UnitsStore derives its mode from.
      return units.length === 'ft' ? 'gal' : 'L';
    case 'power':
      return 'W';
    case 'count':
      return '';
  }
}

function converter(
  kind: InstrumentTrendDisplayKind,
  units: UnitsProfile,
): (si: number) => number | undefined {
  switch (kind) {
    case 'speed':
      return (value) => speedValue(value, units);
    case 'depth':
      return units.length === 'ft' ? metersToFeet : identity;
    case 'pressure':
      return (value) => pressureValue(value, units);
    case 'temperature':
      return (value) => {
        const celsius = value - 273.15;
        return units.temperature === 'F' ? celsius * (9 / 5) + 32 : celsius;
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
      // Length family as the coarse imperial signal; see displayUnit's volume case.
      return units.length === 'ft'
        ? (value) => value * CUBIC_METERS_TO_US_GALLONS
        : (value) => value * 1000;
    case 'voltage':
    case 'current':
    case 'power':
    case 'count':
      return identity;
  }
}

// Whether a kind's imperial precision applies: decided by that kind's own resolved category unit,
// so a mixed preset (feet with millibars) gets whole millibars, not inHg hundredths. Volume has no
// category and follows the length family.
function usesImperialPrecision(kind: InstrumentTrendDisplayKind, units: UnitsProfile): boolean {
  switch (kind) {
    case 'depth':
      return units.length === 'ft';
    case 'pressure':
      return units.pressure === 'inHg' || units.pressure === 'psi';
    case 'temperature':
      return units.temperature === 'F';
    case 'volume':
      return units.length === 'ft';
    default:
      return false;
  }
}

export function trendDisplayFor(
  descriptor: InstrumentTrendDescriptor,
  units: UnitsSelection,
): TrendDisplay {
  const profile = resolveUnits(units);
  return {
    convert: converter(descriptor.display, profile),
    unit: displayUnit(descriptor.display, profile),
    digits: usesImperialPrecision(descriptor.display, profile)
      ? descriptor.imperialPrecision
      : descriptor.metricPrecision,
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
