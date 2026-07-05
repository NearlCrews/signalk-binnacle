import { describe, expect, it } from 'vitest';
import { PLACEHOLDER } from './coords';
import {
  degreesToRadians,
  feetToMeters,
  formatBearingOr,
  formatClockTime,
  formatDayClock,
  formatDuration,
  formatLengthOr,
  formatMetersOrNm,
  formatNm,
  formatPrecipRateOr,
  formatPressureOr,
  formatSignedAngleOr,
  formatTcpaMin,
  formatTemperatureOr,
  kelvinToCelsius,
  knotsToMetersPerSecond,
  landDistanceUnit,
  lengthUnit,
  metersPerSecondToKnots,
  metersToNauticalMiles,
  nauticalMilesToMeters,
  pressureValue,
  radiansToBearing,
} from './units';

describe('units', () => {
  it('converts meters per second to knots', () => {
    expect(metersPerSecondToKnots(1)).toBeCloseTo(1.943844, 5);
    expect(metersPerSecondToKnots(0)).toBe(0);
  });

  it('returns undefined for undefined input', () => {
    expect(metersPerSecondToKnots(undefined)).toBeUndefined();
    expect(radiansToBearing(undefined)).toBeUndefined();
  });

  it('converts radians to a normalized 0..360 degree bearing', () => {
    expect(radiansToBearing(0)).toBe(0);
    expect(radiansToBearing(Math.PI)).toBeCloseTo(180, 6);
    expect(radiansToBearing(2 * Math.PI)).toBeCloseTo(0, 6);
    expect(radiansToBearing(-Math.PI / 2)).toBeCloseTo(270, 6);
  });

  it('converts meters to nautical miles', () => {
    expect(metersToNauticalMiles(1852)).toBeCloseTo(1, 6);
  });

  it('formats CPA in nautical miles and TCPA in minutes', () => {
    expect(formatNm(926)).toBe('0.50');
    expect(formatTcpaMin(600)).toBe('10');
    expect(formatTcpaMin(90, 1)).toBe('1.5');
  });
});

describe('formatMetersOrNm', () => {
  it('reads whole meters under a nautical mile, nautical miles beyond', () => {
    expect(formatMetersOrNm(93.4)).toBe('93 m');
    expect(formatMetersOrNm(1851)).toBe('1851 m');
    expect(formatMetersOrNm(1852)).toBe('1.00 nm');
    expect(formatMetersOrNm(4260)).toBe('2.30 nm');
  });

  it('reads the placeholder for an absent value', () => {
    expect(formatMetersOrNm(undefined)).toBe('--');
    expect(formatMetersOrNm(null)).toBe('--');
  });
});

describe('formatClockTime', () => {
  it('reads hour and minute by default, and adds seconds on opt-in', () => {
    // Locale-dependent rendering, so assert the field count, not exact text.
    const at = Date.UTC(2026, 5, 11, 14, 32, 5);
    expect(formatClockTime(at).match(/\d+/g)).toHaveLength(2);
    expect(formatClockTime(at, { seconds: true }).match(/\d+/g)).toHaveLength(3);
  });
});

describe('formatDayClock', () => {
  it('reads weekday plus clock, optionally with the zone, and is blank for NaN', () => {
    const at = Date.UTC(2026, 5, 11, 14, 32, 5);
    expect(formatDayClock(at)).toMatch(/[A-Za-z]/);
    expect(formatDayClock(at).match(/\d+/g)).toHaveLength(2);
    // The zone variant appends a non-numeric zone token, so the text grows.
    expect(formatDayClock(at, { zone: true }).length).toBeGreaterThan(formatDayClock(at).length);
    expect(formatDayClock(Number.NaN)).toBe('');
  });

  it('omits the minute field when minute:false, producing a shorter string', () => {
    const at = Date.UTC(2026, 5, 11, 14, 32, 5);
    const withMinute = formatDayClock(at);
    const withoutMinute = formatDayClock(at, { minute: false });
    // Fewer characters when the minute is suppressed.
    expect(withoutMinute.length).toBeLessThan(withMinute.length);
  });

  it('omits the minute field with zone:true, producing a shorter string than the zone+minute form', () => {
    const at = Date.UTC(2026, 5, 11, 14, 32, 5);
    const withMinuteAndZone = formatDayClock(at, { zone: true });
    const withoutMinuteWithZone = formatDayClock(at, { zone: true, minute: false });
    expect(withoutMinuteWithZone.length).toBeLessThan(withMinuteAndZone.length);
  });
});

describe('conversion primitives', () => {
  it('metersToFeet and feetToMeters are inverse', () => {
    // 1 foot = 0.3048 m exactly
    expect(feetToMeters(1)).toBeCloseTo(0.3048, 6);
    expect(feetToMeters(100)).toBeCloseTo(30.48, 6);
    // Round-trip: 10 m -> feet -> m should return 10.
    expect(feetToMeters(10 / 0.3048)).toBeCloseTo(10, 6);
  });

  it('kelvinToCelsius subtracts 273.15 and returns undefined for null or undefined', () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0, 6);
    expect(kelvinToCelsius(373.15)).toBeCloseTo(100, 6);
    expect(kelvinToCelsius(null)).toBeUndefined();
    expect(kelvinToCelsius(undefined)).toBeUndefined();
  });

  it('knotsToMetersPerSecond inverts metersPerSecondToKnots', () => {
    // 1 knot is exactly 1852 / 3600 m/s.
    expect(knotsToMetersPerSecond(1)).toBeCloseTo(1852 / 3600, 6);
    expect(knotsToMetersPerSecond(metersPerSecondToKnots(5) as number)).toBeCloseTo(5, 6);
  });

  it('nauticalMilesToMeters converts and metersToNauticalMiles round-trips', () => {
    expect(nauticalMilesToMeters(1)).toBe(1852);
    expect(metersToNauticalMiles(nauticalMilesToMeters(3))).toBeCloseTo(3, 6);
  });

  it('pressureValue converts Pascals to hPa or inHg by mode', () => {
    // 1 standard atmosphere = 101325 Pa = 1013.25 hPa
    expect(pressureValue(101325, 'metric')).toBeCloseTo(1013.25, 2);
    // 1 standard atmosphere = 29.921 inHg (approx)
    expect(pressureValue(101325, 'imperial')).toBeCloseTo(29.921, 2);
    expect(pressureValue(null, 'metric')).toBeUndefined();
    expect(pressureValue(undefined, 'imperial')).toBeUndefined();
  });
});

describe('lengthUnit and landDistanceUnit labels', () => {
  it('returns m in metric mode and ft in imperial', () => {
    expect(lengthUnit('metric')).toBe('m');
    expect(lengthUnit('imperial')).toBe('ft');
  });

  it('returns km in metric mode and mi in imperial', () => {
    expect(landDistanceUnit('metric')).toBe('km');
    expect(landDistanceUnit('imperial')).toBe('mi');
  });
});

describe('formatLengthOr', () => {
  it('formats meters as-is in metric mode with default one decimal place', () => {
    expect(formatLengthOr(10, 'metric')).toBe('10.0');
    expect(formatLengthOr(3.567, 'metric', 2)).toBe('3.57');
  });

  it('converts to feet in imperial mode', () => {
    // 1 m = 3.2808... ft; to 1 decimal: "3.3"
    expect(formatLengthOr(1, 'imperial')).toBe((1 / 0.3048).toFixed(1));
  });

  it('returns the placeholder for null or undefined', () => {
    expect(formatLengthOr(null, 'metric')).toBe('--');
    expect(formatLengthOr(undefined, 'imperial')).toBe('--');
  });
});

describe('formatTemperatureOr', () => {
  it('formats Celsius in metric mode', () => {
    // 300 K = 26.85 C; default 0 digits rounds to 27
    expect(formatTemperatureOr(300, 'metric')).toBe('27');
  });

  it('formats Fahrenheit in imperial mode', () => {
    // 273.15 K = 32 F
    expect(formatTemperatureOr(273.15, 'imperial')).toBe('32');
  });

  it('returns the placeholder for null or undefined', () => {
    expect(formatTemperatureOr(null, 'metric')).toBe('--');
    expect(formatTemperatureOr(undefined, 'imperial')).toBe('--');
  });
});

describe('formatPressureOr', () => {
  it('formats whole hectopascals in metric mode', () => {
    expect(formatPressureOr(101325, 'metric')).toBe('1013');
  });

  it('formats inHg to two decimal places in imperial mode', () => {
    // 101325 / 3386.389 = ~29.92 inHg
    expect(formatPressureOr(101325, 'imperial')).toBe((101325 / 3386.389).toFixed(2));
  });

  it('returns the placeholder for null or undefined', () => {
    expect(formatPressureOr(null, 'metric')).toBe('--');
    expect(formatPressureOr(undefined, 'imperial')).toBe('--');
  });
});

describe('formatPrecipRateOr', () => {
  it('formats mm/h to one decimal in metric mode', () => {
    expect(formatPrecipRateOr(5, 'metric')).toBe('5.0');
    expect(formatPrecipRateOr(0.25, 'metric')).toBe('0.3');
  });

  it('converts to in/h and formats to two decimal places in imperial mode', () => {
    // 25.4 mm = 1 inch, so 25.4 mm/h = 1.00 in/h
    expect(formatPrecipRateOr(25.4, 'imperial')).toBe('1.00');
  });

  it('returns the placeholder for null or undefined', () => {
    expect(formatPrecipRateOr(null, 'metric')).toBe('--');
    expect(formatPrecipRateOr(undefined, 'imperial')).toBe('--');
  });
});

describe('formatDuration', () => {
  it('formats sub-hour durations as whole minutes', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(3540)).toBe('59 min');
  });

  it('formats durations of an hour or more as Xh YYm', () => {
    expect(formatDuration(3600)).toBe('1h 00m');
    expect(formatDuration(3660)).toBe('1h 01m');
    expect(formatDuration(7500)).toBe('2h 05m');
  });

  it('rounds to the nearest minute', () => {
    // 89 seconds rounds to 1 minute, not 2
    expect(formatDuration(89)).toBe('1 min');
    // 91 seconds rounds to 2 minutes
    expect(formatDuration(91)).toBe('2 min');
  });
});

describe('formatNm and formatTcpaMin boundary values', () => {
  it('formatNm(0) returns a sane string and does not throw', () => {
    const result = formatNm(0);
    expect(typeof result).toBe('string');
    expect(result).toBe('0.00');
  });

  it('formatTcpaMin(0) returns a sane string and does not throw', () => {
    const result = formatTcpaMin(0);
    expect(typeof result).toBe('string');
    expect(result).toBe('0');
  });
});

describe('formatSignedAngleOr', () => {
  it('formats starboard angles with an S prefix', () => {
    expect(formatSignedAngleOr(Math.PI / 4)).toBe('S 45');
  });
  it('formats port angles with a P prefix', () => {
    expect(formatSignedAngleOr(-Math.PI / 2)).toBe('P 90');
  });
  it('formats dead ahead as 0 with no prefix', () => {
    expect(formatSignedAngleOr(0)).toBe('0');
  });
  it('renders the placeholder when undefined', () => {
    expect(formatSignedAngleOr(undefined)).toBe(PLACEHOLDER);
  });
});

describe('formatBearingOr', () => {
  it('zero-pads bearing to three digits', () => {
    expect(formatBearingOr(0)).toBe('000');
    expect(formatBearingOr(Math.PI / 2)).toBe('090');
    expect(formatBearingOr(Math.PI)).toBe('180');
    expect(formatBearingOr(-Math.PI / 2)).toBe('270');
  });
  it('keeps the whole degrees three wide when digits > 0', () => {
    expect(formatBearingOr(degreesToRadians(4), 1)).toBe('004.0');
  });
  it('returns PLACEHOLDER for null, undefined', () => {
    expect(formatBearingOr(null)).toBe(PLACEHOLDER);
    expect(formatBearingOr(undefined)).toBe(PLACEHOLDER);
  });
});
