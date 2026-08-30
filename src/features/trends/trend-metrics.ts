import type {
  InstrumentTrendDescriptor,
  InstrumentTrendDisplayKind,
} from '$entities/instrument-trend';
import {
  CUBIC_METERS_TO_US_GALLONS,
  DEG_TO_RAD,
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

export type TrendVerdict = 'steady' | 'rising' | 'falling';
export type TrendDangerSide = 'min' | 'max' | 'both';

// Which end of a charted series carries the risk, so the annotation line calls out the extreme a
// watchkeeper actually cares about: shoaling depth, a falling barometer, a draining battery, and
// sagging voltage on the low side; building speed, engine revolutions, current draw, and load on
// the high side. Kinds where neither end dominates (a cabin can be too hot or too cold, a tank
// matters both full and empty) report both.
export function trendDangerSide(kind: InstrumentTrendDisplayKind): TrendDangerSide {
  switch (kind) {
    case 'depth':
    case 'pressure':
    case 'ratio':
    case 'voltage':
      return 'min';
    case 'speed':
    case 'rpm':
    case 'current':
    case 'power':
      return 'max';
    case 'temperature':
    case 'volume':
    case 'duration':
    case 'rate-of-turn':
    case 'count':
      return 'both';
  }
}

// The per-kind noise floor in SI units: a first-to-last change at or under it reads as steady
// rather than a trend. Sized to ordinary sensor jitter over a chart window (a quarter meter per
// second is about half a knot, 100 Pa is one hectopascal, 0.02 is two percentage points).
export function trendNoiseFloor(kind: InstrumentTrendDisplayKind): number {
  switch (kind) {
    case 'speed':
      return 0.25;
    case 'depth':
      return 0.5;
    case 'pressure':
      return 100;
    case 'temperature':
      return 0.5;
    case 'ratio':
      return 0.02;
    case 'rpm':
      // 50 rpm, in the store's hertz.
      return 50 / 60;
    case 'duration':
      // 0.1 hours, in seconds.
      return 360;
    case 'rate-of-turn':
      // One degree per minute, in radians per second.
      return DEG_TO_RAD / 60;
    case 'voltage':
      return 0.2;
    case 'current':
      return 1;
    case 'volume':
      // 10 liters, in cubic meters.
      return 0.01;
    case 'power':
      return 25;
    case 'count':
      return 1;
  }
}

// The deterministic annotation under one chart, computed over the SI series. Indices point back
// into the series so the caller can read the matching converted display values.
export interface TrendAnnotation {
  firstIndex: number;
  lastIndex: number;
  minIndex: number;
  maxIndex: number;
  // Last sample minus first, SI. A display-edge delta must subtract two converted values instead
  // of converting this one: an offset conversion (Kelvin to Fahrenheit) would distort it.
  netChange: number;
  verdict: TrendVerdict;
}

export function trendAnnotation(
  series: TrendSeries,
  noiseFloor: number,
): TrendAnnotation | undefined {
  let firstIndex = -1;
  let lastIndex = -1;
  let minIndex = -1;
  let maxIndex = -1;
  let firstValue = 0;
  let lastValue = 0;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < series.values.length; index += 1) {
    const value = series.values[index];
    if (value == null || !Number.isFinite(value)) continue;
    if (firstIndex < 0) {
      firstIndex = index;
      firstValue = value;
    }
    lastIndex = index;
    lastValue = value;
    if (value < minValue) {
      minValue = value;
      minIndex = index;
    }
    if (value > maxValue) {
      maxValue = value;
      maxIndex = index;
    }
  }
  // A single sample has no direction; the latest-value readout already covers it.
  if (firstIndex < 0 || lastIndex === firstIndex) return undefined;
  const netChange = lastValue - firstValue;
  let verdict: TrendVerdict = 'steady';
  if (Math.abs(netChange) > noiseFloor) verdict = netChange > 0 ? 'rising' : 'falling';
  return { firstIndex, lastIndex, minIndex, maxIndex, netChange, verdict };
}

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
