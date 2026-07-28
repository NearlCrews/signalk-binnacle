import type {
  InstrumentTrendDescriptor,
  InstrumentTrendDisplayKind,
} from '$entities/instrument-trend';
import {
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

export interface TrendDisplay {
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
      return mode === 'imperial' ? (value) => value * 264.172052 : (value) => value * 1000;
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
