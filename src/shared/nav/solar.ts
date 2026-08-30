// Local sunrise and sunset from the NOAA solar-position workbook equations: pure arithmetic on
// the epoch, latitude, and longitude, so a daylight flag works offline and needs no provider.
// Accuracy is within a couple of minutes of the almanac, which is plenty for planning cues; it is
// not an almanac replacement.

const MS_PER_DAY = 86_400_000;
const MS_PER_MIN = 60_000;
// The sun's zenith angle at rise and set: 90 degrees plus standard refraction and the solar
// disc's semi-diameter, per the NOAA workbook.
const RISE_SET_ZENITH_DEG = 90.833;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

// The rise and set epochs for the local solar day containing the queried time, or a polar marker
// when the sun never crosses the horizon that day.
export type SunTimes = { sunriseMs: number; sunsetMs: number } | 'always-up' | 'always-down';

export function sunTimes(
  dateMs: number,
  latitude: number,
  longitude: number,
): SunTimes | undefined {
  if (!Number.isFinite(dateMs) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }
  if (latitude < -90 || latitude > 90) return undefined;
  // The solar day containing dateMs: the epoch-day index shifted by the longitude so day
  // boundaries fall at local solar midnight, not UTC midnight. Without the shift, an evening
  // query east of Greenwich would read the previous day's sunset.
  const solarDay = Math.floor(dateMs / MS_PER_DAY + longitude / 360);
  const dayStartMs = solarDay * MS_PER_DAY;
  // Julian centuries since J2000, evaluated once at the approximate local solar noon; the
  // ephemeris drifts far too slowly for the hours of error here to matter.
  const noonEstimateMs = dayStartMs + (0.5 - longitude / 360) * MS_PER_DAY;
  const T = (noonEstimateMs / MS_PER_DAY + 2440587.5 - 2451545) / 36525;
  const meanLongDeg = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const meanAnomalyRad = rad(357.52911 + T * (35999.05029 - 0.0001537 * T));
  const eccentricity = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const centerDeg =
    Math.sin(meanAnomalyRad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * meanAnomalyRad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * meanAnomalyRad) * 0.000289;
  const ascendingNodeRad = rad(125.04 - 1934.136 * T);
  const apparentLongRad = rad(
    meanLongDeg + centerDeg - 0.00569 - 0.00478 * Math.sin(ascendingNodeRad),
  );
  const obliquityArcsec = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const obliquityRad = rad(
    23 + (26 + obliquityArcsec / 60) / 60 + 0.00256 * Math.cos(ascendingNodeRad),
  );
  const declinationRad = Math.asin(Math.sin(obliquityRad) * Math.sin(apparentLongRad));
  const y = Math.tan(obliquityRad / 2) ** 2;
  const meanLongRad = rad(meanLongDeg);
  const equationOfTimeMin =
    4 *
    deg(
      y * Math.sin(2 * meanLongRad) -
        2 * eccentricity * Math.sin(meanAnomalyRad) +
        4 * eccentricity * y * Math.sin(meanAnomalyRad) * Math.cos(2 * meanLongRad) -
        0.5 * y * y * Math.sin(4 * meanLongRad) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomalyRad),
    );
  const latitudeRad = rad(latitude);
  const cosHourAngle =
    (Math.cos(rad(RISE_SET_ZENITH_DEG)) - Math.sin(latitudeRad) * Math.sin(declinationRad)) /
    (Math.cos(latitudeRad) * Math.cos(declinationRad));
  if (cosHourAngle < -1) return 'always-up';
  if (cosHourAngle > 1) return 'always-down';
  const halfDayMin = 4 * deg(Math.acos(cosHourAngle));
  const solarNoonMs = dayStartMs + (720 - 4 * longitude - equationOfTimeMin) * MS_PER_MIN;
  return {
    sunriseMs: solarNoonMs - halfDayMin * MS_PER_MIN,
    sunsetMs: solarNoonMs + halfDayMin * MS_PER_MIN,
  };
}

// Whether a time is after dark at a position. The fixed margin stands in for civil twilight (sun
// six degrees below the horizon, about half an hour at mid-latitudes) without solar-depression
// math: twilight runs longer near the poles and shorter at the equator, but a few minutes either
// way does not change an arrival-planning cue. An unresolvable input reads as not dark, so bad
// data never raises a flag.
export function isAfterDark(
  timeMs: number,
  latitude: number,
  longitude: number,
  twilightMarginMin = 30,
): boolean {
  const times = sunTimes(timeMs, latitude, longitude);
  if (times === undefined) return false;
  if (times === 'always-up') return false;
  if (times === 'always-down') return true;
  const marginMs = twilightMarginMin * MS_PER_MIN;
  return timeMs > times.sunsetMs + marginMs || timeMs < times.sunriseMs - marginMs;
}
