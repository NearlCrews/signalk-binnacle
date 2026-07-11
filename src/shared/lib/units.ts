import { PLACEHOLDER } from './coords';

// Meters in one nautical mile. Exported so the few call sites that need a whole-nautical-mile
// distance (radar ring-label precision, the auto-cache radius defaults) go through this or the
// nauticalMilesToMeters converter rather than re-spelling 1852.
export const METERS_PER_NAUTICAL_MILE = 1852;
// 3600 (seconds per hour) / 1852 (meters per nautical mile): meters per second to knots.
const MS_TO_KNOTS = 3600 / METERS_PER_NAUTICAL_MILE;
const KELVIN_OFFSET = 273.15;
export const PA_PER_HPA = 100;

// Degrees-to-radians as a plain multiplier, for tight numeric loops (haversine, grid sampling)
// that would otherwise each define their own `Math.PI / 180`. The display-edge converter
// degreesToRadians is defined in terms of it.
export const DEG_TO_RAD = Math.PI / 180;

// The inverse, radians-to-degrees, as a plain multiplier. Exported so the bearing and signed-angle
// readouts and the instrument tiles share one factor rather than each re-spelling `180 / Math.PI`.
export const RAD_TO_DEG = 180 / Math.PI;

// Milliseconds in a minute, hour, and day, shared by the time-step and TTL constants so the
// factors are named once rather than re-spelled as 60 * 1000 chains across the loaders.
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// The store-to-display converters accept null and undefined because a Signal K value
// can be absent (the guards use `== null` to catch both). The inverse converters
// (knotsToMetersPerSecond, degreesToRadians) take a definite number on purpose: they
// run at the input edge on values the caller has already resolved.
export function metersPerSecondToKnots(value: number | null | undefined): number | undefined {
  return value == null ? undefined : value * MS_TO_KNOTS;
}

export function knotsToMetersPerSecond(value: number): number {
  return value / MS_TO_KNOTS;
}

// Radians to a 0..360 compass bearing (COG, heading). The 0..360 normalization is the reason
// this is bearing-specific; it must not be reused for an arbitrary signed angle.
export function radiansToBearing(value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  return (value * RAD_TO_DEG + 360) % 360;
}

export function degreesToRadians(value: number): number {
  return value * DEG_TO_RAD;
}

// A 0..360 heading in degrees: the heading if present, otherwise the course over ground, otherwise
// north.
export function headingDegrees(
  headingRad: number | null | undefined,
  cogRad: number | null | undefined,
): number {
  return radiansToBearing(headingRad) ?? radiansToBearing(cogRad) ?? 0;
}

// Signal K temperatures are Kelvin; the display edge shows Celsius.
export function kelvinToCelsius(value: number | null | undefined): number | undefined {
  return value == null ? undefined : value - KELVIN_OFFSET;
}

// A null-safe fixed-digit reading: the placeholder when absent, otherwise the value to `digits`.
// Centralized so the readouts that show "value or --" do not each re-implement it.
export function formatFixed(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? PLACEHOLDER : value.toFixed(digits);
}

// A fraction (0..1) as a whole-number percent string, placeholder-aware: the cloud-cover readout and
// the weather legend share one fraction-to-percent spelling instead of each multiplying by 100 inline.
export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  return formatFixed(fraction == null ? undefined : fraction * 100, digits);
}

// Placeholder-aware speed and bearing readouts. Unlike formatKnots (which shows 0.0 for an absent
// value), these show PLACEHOLDER ("--") so the SOG, COG, BTW, and wind-legend readouts never render
// a misleading zero. The convert-then-formatFixed pattern is written once here, not at each site.
export function formatKnotsOr(metersPerSecond: number | null | undefined, digits = 1): string {
  return formatFixed(metersPerSecondToKnots(metersPerSecond), digits);
}

export function formatBearingOr(radians: number | null | undefined, digits = 0): string {
  const bearing = radiansToBearing(radians);
  if (bearing === undefined) return PLACEHOLDER;
  // Marine convention pads the whole degrees to three digits ("004"); the pad target grows by
  // the decimal point and fraction when digits > 0 so the integer part stays three wide.
  return bearing.toFixed(digits).padStart(digits > 0 ? digits + 4 : 3, '0');
}

export function metersToNauticalMiles(value: number | null | undefined): number | undefined {
  return value == null ? undefined : value / METERS_PER_NAUTICAL_MILE;
}

export function nauticalMilesToMeters(value: number): number {
  return value * METERS_PER_NAUTICAL_MILE;
}

// A meters-to-nautical-miles reading for any distance (track length, range), centralized so
// the conversion and rounding do not drift across the readouts that show it. A null input reads as
// 0.00; callers that must show a blank for an absent value (the NavStrip, TracksPanel) guard with
// PLACEHOLDER before calling, so a null never reaches the `?? 0` path in those readouts.
export function formatNm(meters: number, digits = 2): string {
  return (metersToNauticalMiles(meters) ?? 0).toFixed(digits);
}

// A knots reading for a speed in m/s (SI), centralized so the SOG readouts do not drift. As with
// formatNm, a null reads as 0.0; callers that need a blank guard with PLACEHOLDER first.
export function formatKnots(metersPerSecond: number | null | undefined, digits = 1): string {
  return (metersPerSecondToKnots(metersPerSecond) ?? 0).toFixed(digits);
}

// Placeholder-aware nautical-miles reading: PLACEHOLDER when absent, otherwise the value. The
// NavStrip and TracksPanel show a blank rather than a misleading 0.00 for an absent distance, so
// they use this instead of guarding formatNm with `!= null` at each site.
export function formatNmOr(meters: number | null | undefined, digits = 2): string {
  return formatFixed(metersToNauticalMiles(meters), digits);
}

// ----- Unit-preference-aware display -----
// Nautical units (knots, nautical miles, degrees) are unconditional at sea; the imperial-versus-
// metric preference affects only the categories below: short lengths and depths (meters or feet),
// temperature, pressure, precipitation rate, and land-scale distance. The mode comes from the
// server's unit preferences (the entities/units store), and every affected readout takes it as an
// argument so the formatters stay pure.
export type UnitsMode = 'metric' | 'imperial';

const METERS_PER_FOOT = 0.3048;
const MM_PER_INCH = 25.4;
const PA_PER_INHG = 3386.389;
export const METERS_PER_MILE = 1609.344;

export function metersToFeet(value: number | null | undefined): number | undefined {
  return value == null ? undefined : value / METERS_PER_FOOT;
}

export function feetToMeters(value: number): number {
  return value * METERS_PER_FOOT;
}

// Imperial readouts hand a short range to nautical miles at 1000 ft (the conventional plotter
// switch point); metric ones at one nautical mile, where whole meters stop reading well.
const IMPERIAL_NM_FLOOR_METERS = feetToMeters(1000);

// The unit label for a mode-dependent length (depth, wave and tide height, anchor distance).
export function lengthUnit(mode: UnitsMode): 'm' | 'ft' {
  return mode === 'imperial' ? 'ft' : 'm';
}

// A mode-aware length reading (value only; the caller renders lengthUnit beside it).
export function formatLengthOr(
  meters: number | null | undefined,
  mode: UnitsMode,
  digits = 1,
): string {
  const value = mode === 'imperial' ? metersToFeet(meters) : meters;
  return formatFixed(value, digits);
}

export function temperatureUnit(mode: UnitsMode): string {
  return mode === 'imperial' ? '°F' : '°C';
}

// Internal to the temperature formatter below; not part of the lib public surface.
function kelvinToFahrenheit(value: number | null | undefined): number | undefined {
  const celsius = kelvinToCelsius(value);
  return celsius == null ? undefined : celsius * (9 / 5) + 32;
}

export function formatTemperatureOr(
  kelvin: number | null | undefined,
  mode: UnitsMode,
  digits = 0,
): string {
  const value = mode === 'imperial' ? kelvinToFahrenheit(kelvin) : kelvinToCelsius(kelvin);
  return formatFixed(value, digits);
}

export function pressureUnit(mode: UnitsMode): 'hPa' | 'inHg' {
  return mode === 'imperial' ? 'inHg' : 'hPa';
}

// The numeric pressure in the mode's display unit (hPa or inHg), for charts and inputs that
// need the value rather than a formatted string.
export function pressureValue(
  pascals: number | null | undefined,
  mode: UnitsMode,
): number | undefined {
  if (pascals == null) return undefined;
  return mode === 'imperial' ? pascals / PA_PER_INHG : pascals / PA_PER_HPA;
}

// Pressure to the conventional precision per unit: whole hectopascals, hundredths of inHg.
export function formatPressureOr(pascals: number | null | undefined, mode: UnitsMode): string {
  return formatFixed(pressureValue(pascals, mode), mode === 'imperial' ? 2 : 0);
}

export function precipRateUnit(mode: UnitsMode): 'mm/h' | 'in/h' {
  return mode === 'imperial' ? 'in/h' : 'mm/h';
}

// Precipitation rate from the store's mm per hour: tenths of a millimeter, hundredths of an inch.
export function formatPrecipRateOr(mmPerHour: number | null | undefined, mode: UnitsMode): string {
  if (mode === 'imperial') {
    return formatFixed(mmPerHour == null ? undefined : mmPerHour / MM_PER_INCH, 2);
  }
  return formatFixed(mmPerHour, 1);
}

// Land-scale distance (a tide station's range from the boat): kilometers or statute miles.
export function landDistanceUnit(mode: UnitsMode): 'km' | 'mi' {
  return mode === 'imperial' ? 'mi' : 'km';
}

// A short-range distance with its unit built in: whole meters (or feet) below the hand-off, then
// nautical miles. The MOB and measure readouts deal in recovery and harbor scales where "0.05 nm"
// reads worse than "93 m", and the unit switches so the caller cannot label it statically.
export function formatMetersOrNm(
  meters: number | null | undefined,
  mode: UnitsMode = 'metric',
): string {
  if (meters == null) return PLACEHOLDER;
  if (mode === 'imperial') {
    if (meters < IMPERIAL_NM_FLOOR_METERS) return `${Math.round(meters / METERS_PER_FOOT)} ft`;
    return `${formatNm(meters)} nm`;
  }
  if (meters < METERS_PER_NAUTICAL_MILE) return `${Math.round(meters)} m`;
  return `${formatNm(meters)} nm`;
}

export function formatTcpaMin(seconds: number, digits = 0): string {
  return (seconds / 60).toFixed(digits);
}

const CLOCK_OPTS_HM: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const CLOCK_OPTS_HMS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};
const CLOCK_OPTS_HM_UTC: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
};
const DAY_CLOCK_OPTS_HM: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
};
const DAY_CLOCK_OPTS_H: Intl.DateTimeFormatOptions = { weekday: 'short', hour: '2-digit' };
const DAY_CLOCK_OPTS_HMZ: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
};
const DAY_CLOCK_OPTS_HZ: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  hour: '2-digit',
  timeZoneName: 'short',
};

// A wall-clock time as hour and minute, shared so the nav strip, the tides display, and any other
// readout format an absolute time the same way. The seconds opt-in serves the readouts that get
// written in a log or relayed on the VHF (the MOB mark time), where minute resolution is too coarse.
// The utc opt-in serves consumers that need an absolute schedule label rather than local time.
export function formatClockTime(
  timeMs: number,
  opts?: { seconds?: boolean; utc?: boolean },
): string {
  if (opts?.utc) return new Date(timeMs).toLocaleTimeString([], CLOCK_OPTS_HM_UTC);
  return new Date(timeMs).toLocaleTimeString([], opts?.seconds ? CLOCK_OPTS_HMS : CLOCK_OPTS_HM);
}

// A weekday wall-clock label ("Thu, 12:00 PM"), optionally with the zone, and optionally hour-only
// (minute: false) for the compact forecast step columns. The weather valid-time labels carry the
// zone so a crew keeping ship's time in UTC cannot misread a front by hours; one helper so the
// scrubber label, the forecast steps, and the conditions panel cannot drift apart.
export function formatDayClock(
  timeMs: number,
  opts?: { zone?: boolean; minute?: boolean },
): string {
  if (Number.isNaN(timeMs)) return '';
  const noMinute = opts?.minute === false;
  const zone = opts?.zone;
  let fmt: Intl.DateTimeFormatOptions;
  if (zone) fmt = noMinute ? DAY_CLOCK_OPTS_HZ : DAY_CLOCK_OPTS_HMZ;
  else fmt = noMinute ? DAY_CLOCK_OPTS_H : DAY_CLOCK_OPTS_HM;
  return new Date(timeMs).toLocaleString([], fmt);
}

export interface DurationParts {
  value: string;
  unit: string;
}

// The split form of formatDuration for column layouts like the route plan's stat grid: under an hour
// the value is the bare minute count and the unit is "min", so it lines up in the unit column under a
// distance's "nm"; an hour or more uses the compound "2h 05m", which carries its own units, so the
// unit cell stays empty.
export function formatDurationParts(seconds: number): DurationParts {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return { value: `${totalMinutes}`, unit: 'min' };
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { value: `${hours}h ${minutes.toString().padStart(2, '0')}m`, unit: '' };
}

// A time-to-go readout with its own unit: minutes under an hour ("45 min"), hours and minutes above
// ("2h 05m"). TTG on a passage routinely exceeds an hour, where a bare minute count ("420 min")
// reads as nonsense, so the unit is built in rather than appended by the caller.
export function formatDuration(seconds: number): string {
  const { value, unit } = formatDurationParts(seconds);
  return unit ? `${value} ${unit}` : value;
}

// A signed relative angle (radians, port negative) as "P 45" / "S 120". radiansToBearing normalizes
// to 0..360 and must not be reused for signed angles (its own comment says so); wind angles need the
// port/starboard sense preserved.
export function formatSignedAngleOr(rad: number | undefined): string {
  if (rad === undefined || !Number.isFinite(rad)) return PLACEHOLDER;
  const deg = Math.round(Math.abs(rad) * RAD_TO_DEG);
  if (deg === 0) return '0';
  return `${rad < 0 ? 'P' : 'S'} ${deg}`;
}
