import type { CourseGuidance } from '$entities/course';
import type {
  InstrumentTrendAggregate,
  InstrumentTrendCandidate,
  InstrumentTrendDescriptor,
  InstrumentTrendDisplayKind,
} from '$entities/instrument-trend';
import type { UnitsStore } from '$entities/units';
import { DEPTH_SOURCE_LABELS, type OwnVessel } from '$entities/vessel';
import { asNumber } from '$shared/geo';
import type { ReactiveClock } from '$shared/lib';
import {
  formatBearingOr,
  formatDuration,
  formatFixed,
  formatKnotsOr,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  formatMetersOrNm,
  formatNmOr,
  formatPercent,
  formatPressureOr,
  formatTemperatureOr,
  lengthUnit,
  PLACEHOLDER,
  pressureUnit,
  RAD_TO_DEG,
  temperatureUnit,
} from '$shared/lib';
import type { MetaZone, SignalKStore } from '$shared/signalk';
import { SK_PATHS } from '$shared/signalk';

export interface TileDeps {
  vessel: OwnVessel;
  store: SignalKStore;
  units: UnitsStore;
  clock: ReactiveClock;
  course: CourseGuidance;
}

export type TileValueState = 'never' | 'placeholder' | 'stale' | 'live';

export interface TileReading {
  state: TileValueState;
  value: string;
  unit: string;
  siValue?: number;
  secondary?: string;
  referenceLabel?: string;
  angleRad?: number;
  // Why a wind tile carries no angle even though its speed is live: the angle expired after
  // arriving ('stale'), or it cannot be produced honestly right now ('unavailable', a missing
  // value or an incompatible reference). Absent when the angle is present or was never reported.
  angleState?: 'stale' | 'unavailable';
}

export type TileCategory =
  | 'navigation'
  | 'wind'
  | 'depth'
  | 'weather'
  | 'electrical'
  | 'propulsion'
  | 'tanks'
  | 'cabin';

export interface TileDef {
  id: string;
  label: string;
  abbr?: string;
  description: string;
  sensorGloss: string;
  paths: string[];
  zonesPath: string;
  category: TileCategory;
  kind: 'numeric' | 'wind' | 'position';
  // Rendered mark type beside the numeric readout; the mark components live beside NumericTile.
  viz?: 'spark' | 'battery' | 'rot';
  trend?: {
    candidates: readonly InstrumentTrendCandidate[];
    aggregate: InstrumentTrendAggregate;
    display: InstrumentTrendDisplayKind;
    metricPrecision: number;
    imperialPrecision: number;
    description?: string;
  };
  read(deps: TileDeps): TileReading;
}

function normalizedOptionLabel(value: string): string {
  return value.trim().toLowerCase();
}

function withoutTerminalPeriod(value: string): string {
  return value.trim().replace(/\.$/u, '');
}

// Catalog labels should already identify the reading and its source. This resolver is the final
// presentation boundary: a future repeated label gains its abbreviation, then its description, and
// finally its stable id rather than rendering indistinguishable controls.
export function instrumentOptionLabels(defs: readonly TileDef[]): ReadonlyMap<string, string> {
  const baseCounts = new Map<string, number>();
  for (const def of defs) {
    const key = normalizedOptionLabel(def.label);
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
  }

  const candidates = defs.map((def) => {
    const repeated = (baseCounts.get(normalizedOptionLabel(def.label)) ?? 0) > 1;
    const abbreviationAlreadyLeads = def.abbr
      ? normalizedOptionLabel(def.label).startsWith(`${normalizedOptionLabel(def.abbr)} ·`)
      : false;
    return repeated && def.abbr && !abbreviationAlreadyLeads
      ? `${def.abbr} · ${def.label}`
      : def.label;
  });
  const candidateCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = normalizedOptionLabel(candidate);
    candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  const used = new Set<string>();
  defs.forEach((def, index) => {
    let label = candidates[index];
    if ((candidateCounts.get(normalizedOptionLabel(label)) ?? 0) > 1) {
      label = `${label} · ${withoutTerminalPeriod(def.description)}`;
    }
    if (used.has(normalizedOptionLabel(label))) label = `${label} · ${def.id}`;
    used.add(normalizedOptionLabel(label));
    labels.set(def.id, label);
  });
  return labels;
}

export const TILE_STALE_MS = 10_000;

const MIN_PERIOD_BY_PATH: ReadonlyMap<string, number> = new Map([
  [SK_PATHS.headingTrue, 200],
  [SK_PATHS.outsidePressure, 5000],
]);

export function minPeriodFor(path: string): number {
  return MIN_PERIOD_BY_PATH.get(path) ?? 1000;
}

function trendCandidate(path: string, referenceLabel?: string): InstrumentTrendCandidate {
  return {
    path,
    referenceLabel,
    minPeriodMs: minPeriodFor(path),
    staleAfterMs: TILE_STALE_MS,
  };
}

function trendMetadata(
  display: InstrumentTrendDisplayKind,
  candidates: readonly InstrumentTrendCandidate[],
  metricPrecision: number,
  imperialPrecision = metricPrecision,
  aggregate: InstrumentTrendAggregate = 'average',
): NonNullable<TileDef['trend']> {
  return { candidates, aggregate, display, metricPrecision, imperialPrecision };
}

export function trendDescriptorFor(
  def: TileDef,
  label: string = def.label,
): InstrumentTrendDescriptor | undefined {
  if (!def.trend) return undefined;
  return {
    id: def.id,
    label,
    category: def.category,
    ...def.trend,
    description: def.trend.description ?? def.description,
  };
}

// Structural alias avoids importing PathCell from the shared/signalk internal file.
type PathCell = ReturnType<SignalKStore['cell']>;

function grade(cell: PathCell, clock: ReactiveClock): TileValueState {
  if (cell.epoch === 0) return 'never';
  if (clock.now - cell.epoch > TILE_STALE_MS) return 'stale';
  return cell.value === undefined ? 'placeholder' : 'live';
}

// Wraps a radian angle to -π..π so a relative bearing stays in the port-starboard range.
function normalizeAngle(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// A wind angle cell's honest freshness beside an independently graded speed. Only a cell that has
// reported at least once makes a claim: a speed-only sensor is not "angle stale" forever.
function angleFreshness(
  cell: PathCell,
  clock: ReactiveClock,
  resolved: number | undefined,
): 'stale' | 'unavailable' | undefined {
  if (resolved !== undefined) return undefined;
  if (cell.epoch === 0) return undefined;
  return grade(cell, clock) === 'stale' ? 'stale' : 'unavailable';
}

const SOG_DEF: TileDef = {
  id: 'sog',
  label: 'Speed',
  abbr: 'SOG',
  description: 'Speed over ground (SOG): how fast you cross the seabed, from GPS.',
  sensorGloss: 'No speed data',
  paths: [SK_PATHS.speedOverGround],
  zonesPath: SK_PATHS.speedOverGround,
  category: 'navigation',
  kind: 'numeric',
  viz: 'spark',
  trend: trendMetadata('speed', [trendCandidate(SK_PATHS.speedOverGround)], 1),
  read({ vessel, store, clock }) {
    const cell = store.cell(SK_PATHS.speedOverGround);
    const state = grade(cell, clock);
    const mps = vessel.sogMps;
    return { state, value: formatKnotsOr(mps), unit: 'kn', siValue: mps };
  },
};

const HDG_DEF: TileDef = {
  id: 'heading',
  label: 'Heading',
  abbr: 'HDG',
  description: 'Heading (HDG): the direction the bow points.',
  sensorGloss: 'No heading data',
  // COG is a last-resort fallback; subscribing it here keeps the cell warm.
  paths: [SK_PATHS.headingTrue, SK_PATHS.headingMagnetic, SK_PATHS.courseOverGroundTrue],
  zonesPath: SK_PATHS.headingTrue,
  category: 'navigation',
  kind: 'numeric',
  read({ vessel, store, clock }) {
    const trueCell = store.cell(SK_PATHS.headingTrue);
    const magCell = store.cell(SK_PATHS.headingMagnetic);
    const cogCell = store.cell(SK_PATHS.courseOverGroundTrue);

    // Grade on the first cell in the fallback chain that has ever reported, so the tile
    // is not stuck at 'never' while a fallback source is live.
    let gradingCell: PathCell;
    let value: number | undefined;
    let referenceLabel: string | undefined;

    if (trueCell.epoch > 0) {
      gradingCell = trueCell;
      value = vessel.headingRad;
    } else if (magCell.epoch > 0) {
      gradingCell = magCell;
      value = asNumber(magCell.value);
      referenceLabel = 'M';
    } else if (cogCell.epoch > 0) {
      gradingCell = cogCell;
      value = vessel.cogRad;
      referenceLabel = 'COG';
    } else {
      // Nothing has ever reported: grade on the primary, which returns 'never'.
      gradingCell = trueCell;
    }

    const state = grade(gradingCell, clock);
    return {
      state,
      value: value !== undefined ? `${formatBearingOr(value)}°` : PLACEHOLDER,
      unit: '',
      siValue: value,
      referenceLabel,
    };
  },
};

const DEPTH_DEF: TileDef = {
  id: 'depth',
  label: 'Depth',
  description: 'Depth of water under the boat, preferring below-keel when the server provides it.',
  sensorGloss: 'No depth sensor',
  paths: [SK_PATHS.depthBelowKeel, SK_PATHS.depthBelowSurface, SK_PATHS.depthBelowTransducer],
  zonesPath: SK_PATHS.depthBelowKeel,
  category: 'depth',
  kind: 'numeric',
  viz: 'spark',
  trend: {
    ...trendMetadata(
      'depth',
      [
        trendCandidate(SK_PATHS.depthBelowTransducer, 'Transducer'),
        trendCandidate(SK_PATHS.depthBelowSurface, 'Surface'),
        trendCandidate(SK_PATHS.depthBelowKeel, 'Keel'),
      ],
      1,
    ),
    description:
      'Depth history, preferring below-transducer, then below-surface, then below-keel data.',
  },
  // The entity owns the resolution so this tile and the status chip can never disagree about
  // which reference the boat's Depth number is measured from.
  read({ vessel, store, clock, units }) {
    const reading = vessel.safetyDepth;
    const state = grade(store.cell(reading.path), clock);
    const mode = units.mode;
    return {
      state,
      value: formatLengthOr(reading.meters, mode),
      unit: lengthUnit(mode),
      siValue: reading.meters,
      referenceLabel: reading.source ? DEPTH_SOURCE_LABELS[reading.source] : undefined,
    };
  },
};

const WIND_APPARENT_DEF: TileDef = {
  id: 'wind-apparent',
  label: 'Wind',
  abbr: 'AWS',
  description: 'Apparent wind (AWS): the wind you feel with the boat moving.',
  sensorGloss: 'No wind sensor',
  // headingMagnetic is deliberately NOT listed: it would defeat the never-reported check on a
  // compass-only boat, and the heading cells are warmed by the heading tile and the master list.
  // magneticVariation IS listed: the ground-wind branch needs it to bring a magnetic heading into
  // the true reference frame, and nothing else warms it.
  paths: [
    SK_PATHS.windSpeedApparent,
    SK_PATHS.windAngleApparent,
    SK_PATHS.windSpeedOverGround,
    SK_PATHS.windDirectionTrue,
    SK_PATHS.magneticVariation,
  ],
  zonesPath: SK_PATHS.windSpeedApparent,
  category: 'wind',
  kind: 'wind',
  trend: {
    ...trendMetadata(
      'speed',
      [
        trendCandidate(SK_PATHS.windSpeedApparent, 'Apparent'),
        trendCandidate(SK_PATHS.windSpeedOverGround, 'Ground'),
      ],
      1,
      1,
      'max',
    ),
    description: 'Wind speed history, preferring apparent wind and falling back to ground wind.',
  },
  read({ vessel, store, clock }) {
    const apparentSpeedCell = store.cell(SK_PATHS.windSpeedApparent);
    const groundSpeedCell = store.cell(SK_PATHS.windSpeedOverGround);

    let gradingCell: PathCell;
    let mps: number | undefined;
    let angleRad: number | undefined;
    let angleState: 'stale' | 'unavailable' | undefined;
    let referenceLabel: string | undefined;

    if (apparentSpeedCell.epoch > 0) {
      gradingCell = apparentSpeedCell;
      mps = vessel.windSpeedApparentMps;
      // The angle grades on its own epoch: a wind vane can go quiet while the anemometer keeps
      // reporting, and a retained angle must not steer anyone.
      const angleCell = store.cell(SK_PATHS.windAngleApparent);
      angleRad = grade(angleCell, clock) === 'live' ? asNumber(angleCell.value) : undefined;
      angleState = angleFreshness(angleCell, clock, angleRad);
    } else if (groundSpeedCell.epoch > 0) {
      gradingCell = groundSpeedCell;
      mps = asNumber(groundSpeedCell.value);
      referenceLabel = 'GND';
      const directionCell = store.cell(SK_PATHS.windDirectionTrue);
      const dirTrue =
        grade(directionCell, clock) === 'live' ? asNumber(directionCell.value) : undefined;
      if (dirTrue !== undefined) {
        // A bow-relative ground angle needs a fresh TRUE reference. A magnetic heading joins only
        // through fresh navigation.magneticVariation: subtracting it raw is wrong by the local
        // variation (past twenty degrees in places), a wrong number rather than a stale one.
        // Fresh COG is the last resort, and no angle beats a wrong angle.
        let reference = vessel.headingStale ? undefined : vessel.headingRad;
        if (reference === undefined) {
          const magneticCell = store.cell(SK_PATHS.headingMagnetic);
          const variationCell = store.cell(SK_PATHS.magneticVariation);
          const magnetic =
            grade(magneticCell, clock) === 'live' ? asNumber(magneticCell.value) : undefined;
          const variation =
            grade(variationCell, clock) === 'live' ? asNumber(variationCell.value) : undefined;
          if (magnetic !== undefined && variation !== undefined) reference = magnetic + variation;
        }
        if (reference === undefined) reference = vessel.cogStale ? undefined : vessel.cogRad;
        angleRad = reference !== undefined ? normalizeAngle(dirTrue - reference) : undefined;
      }
      angleState = angleFreshness(directionCell, clock, angleRad);
    } else {
      gradingCell = apparentSpeedCell;
    }

    const state = grade(gradingCell, clock);
    return {
      state,
      value: formatKnotsOr(mps),
      unit: 'kn',
      siValue: mps,
      angleRad,
      angleState,
      referenceLabel,
    };
  },
};

const STW_DEF: TileDef = {
  id: 'stw',
  label: 'Water speed',
  abbr: 'STW',
  description:
    'Speed through the water (STW) from a paddlewheel log. Differs from GPS speed when there is current.',
  sensorGloss: 'No water-speed sensor',
  paths: [SK_PATHS.speedThroughWater],
  zonesPath: SK_PATHS.speedThroughWater,
  category: 'navigation',
  kind: 'numeric',
  viz: 'spark',
  trend: trendMetadata('speed', [trendCandidate(SK_PATHS.speedThroughWater)], 1),
  read({ store, clock }) {
    const cell = store.cell(SK_PATHS.speedThroughWater);
    const state = grade(cell, clock);
    // Reads the cell at call time: "stale retains the last value" holds because the store never
    // clears cell.value on staleness. If that store contract ever changes, cache here like the
    // OwnVessel getters do.
    const mps = asNumber(cell.value);
    return { state, value: formatKnotsOr(mps), unit: 'kn', siValue: mps };
  },
};

const WIND_TRUE_DEF: TileDef = {
  id: 'wind-true',
  label: 'True wind',
  abbr: 'TWS',
  description: "True wind (TWS): the real wind, with the boat's own motion removed.",
  sensorGloss: 'No true wind data',
  paths: [SK_PATHS.windSpeedTrue, SK_PATHS.windAngleTrueWater],
  zonesPath: SK_PATHS.windSpeedTrue,
  category: 'wind',
  kind: 'wind',
  trend: trendMetadata('speed', [trendCandidate(SK_PATHS.windSpeedTrue, 'True')], 1, 1, 'max'),
  read({ store, clock }) {
    const cell = store.cell(SK_PATHS.windSpeedTrue);
    const state = grade(cell, clock);
    const mps = asNumber(cell.value);
    const angleCell = store.cell(SK_PATHS.windAngleTrueWater);
    const angleRad = grade(angleCell, clock) === 'live' ? asNumber(angleCell.value) : undefined;
    const angleState = angleFreshness(angleCell, clock, angleRad);
    return { state, value: formatKnotsOr(mps), unit: 'kn', siValue: mps, angleRad, angleState };
  },
};

const PRESSURE_DEF: TileDef = {
  id: 'pressure',
  label: 'Barometer',
  abbr: 'BARO',
  description: 'Barometric pressure (BARO): a falling reading warns of worsening weather.',
  sensorGloss: 'No barometer',
  paths: [SK_PATHS.outsidePressure],
  zonesPath: SK_PATHS.outsidePressure,
  category: 'weather',
  kind: 'numeric',
  viz: 'spark',
  trend: trendMetadata('pressure', [trendCandidate(SK_PATHS.outsidePressure)], 0, 2),
  read({ vessel, store, clock, units }) {
    const cell = store.cell(SK_PATHS.outsidePressure);
    const state = grade(cell, clock);
    const pa = vessel.outsidePressurePa;
    const mode = units.mode;
    return {
      state,
      value: formatPressureOr(pa, mode),
      unit: pressureUnit(mode),
      siValue: pa,
    };
  },
};

const POSITION_DEF: TileDef = {
  id: 'position',
  label: 'Position',
  description: 'Your position, latitude and longitude.',
  sensorGloss: 'No GPS position',
  paths: [SK_PATHS.position],
  zonesPath: SK_PATHS.position,
  category: 'navigation',
  kind: 'position',
  read({ vessel, store, clock }) {
    const cell = store.cell(SK_PATHS.position);
    const state = grade(cell, clock);
    const pos = vessel.position;
    if (!pos) return { state, value: PLACEHOLDER, unit: '' };
    // Two-line lat/lon; white-space: pre-line on .tile .num renders the embedded line break.
    return {
      state,
      value: `${formatLatitude(pos.latitude)}\n${formatLongitude(pos.longitude)}`,
      unit: '',
    };
  },
};

// The course tile's data is already subscribed by the App master list; no demand paths needed.
// zonesPath is the calcValues distance leaf for shape consistency but zones are not expected here.
const COURSE_ZONES_PATH = `${SK_PATHS.courseCalcValues}.distance`;

const WAYPOINT_DEF: TileDef = {
  id: 'course',
  label: 'Waypoint range',
  abbr: 'WPT',
  description: 'Distance and bearing to the next waypoint while navigating a course.',
  sensorGloss: 'No active course',
  paths: [],
  zonesPath: COURSE_ZONES_PATH,
  category: 'navigation',
  kind: 'numeric',
  read({ course }) {
    if (!course.active) {
      return { state: 'never', value: PLACEHOLDER, unit: '' };
    }
    // Two-line: distance in nm on the first line, bearing in degrees on the second. No siValue:
    // the distance path carries no zones, so banding does not apply.
    const value = `${formatNmOr(course.distanceToNextMeters)} nm\n${formatBearingOr(course.bearingToNextRad)}°`;
    return { state: 'live', value, unit: '' };
  },
};

const COURSE_VMG_DEF: TileDef = {
  id: 'course-vmg',
  label: 'Waypoint VMG',
  abbr: 'VMG',
  description: 'Velocity made good (VMG): speed directly toward the active waypoint.',
  sensorGloss: 'No active course',
  paths: [],
  zonesPath: COURSE_ZONES_PATH,
  category: 'navigation',
  kind: 'numeric',
  viz: 'spark',
  read({ course }) {
    if (!course.active) return { state: 'never', value: PLACEHOLDER, unit: '' };
    return {
      state: 'live',
      value: formatKnotsOr(course.velocityMadeGoodMps),
      unit: 'kn',
      siValue: course.velocityMadeGoodMps,
      referenceLabel: course.source === 'server' ? undefined : 'Calc',
    };
  },
};

const COURSE_XTE_DEF: TileDef = {
  id: 'course-xte',
  label: 'Cross-track',
  abbr: 'XTE',
  description: 'Cross-track error (XTE): how far you are left or right of the active leg.',
  sensorGloss: 'No active course',
  paths: [],
  zonesPath: COURSE_ZONES_PATH,
  category: 'navigation',
  kind: 'numeric',
  read({ course, units }) {
    if (!course.active) return { state: 'never', value: PLACEHOLDER, unit: '' };
    return {
      state: 'live',
      value: formatMetersOrNm(
        course.crossTrackErrorMeters === undefined
          ? undefined
          : Math.abs(course.crossTrackErrorMeters),
        units.mode,
      ),
      unit: '',
      siValue: course.crossTrackErrorMeters,
      secondary:
        course.crossTrackErrorMeters === undefined
          ? undefined
          : course.crossTrackErrorMeters < 0
            ? 'Port of leg'
            : 'Starboard of leg',
      referenceLabel: course.source === 'server' ? undefined : 'Calc',
    };
  },
};

const COURSE_TTG_DEF: TileDef = {
  id: 'course-ttg',
  label: 'Time to waypoint',
  abbr: 'TTG',
  description: 'Time to go (TTG) to the active waypoint at the present speed.',
  sensorGloss: 'No active course',
  paths: [],
  zonesPath: COURSE_ZONES_PATH,
  category: 'navigation',
  kind: 'numeric',
  read({ course }) {
    if (!course.active) return { state: 'never', value: PLACEHOLDER, unit: '' };
    const seconds = course.timeToGoSeconds;
    return {
      state: 'live',
      value: seconds === undefined ? PLACEHOLDER : formatDuration(seconds),
      unit: '',
      siValue: seconds,
      referenceLabel: course.source === 'server' ? undefined : 'Calc',
    };
  },
};

// Shared by the water and air tiles: identical anatomy, different path.
function temperatureRead(path: string): TileDef['read'] {
  return ({ store, clock, units }) => {
    const cell = store.cell(path);
    const state = grade(cell, clock);
    const kelvin = asNumber(cell.value);
    const mode = units.mode;
    return {
      state,
      value: formatTemperatureOr(kelvin, mode),
      unit: temperatureUnit(mode),
      siValue: kelvin,
    };
  };
}

const WATER_TEMP_DEF: TileDef = {
  id: 'water-temp',
  label: 'Water temp',
  abbr: 'SEA',
  description: 'Sea water temperature at the transducer.',
  sensorGloss: 'No water temperature',
  paths: [SK_PATHS.waterTemperature],
  zonesPath: SK_PATHS.waterTemperature,
  category: 'weather',
  kind: 'numeric',
  viz: 'spark',
  trend: trendMetadata('temperature', [trendCandidate(SK_PATHS.waterTemperature)], 1),
  read: temperatureRead(SK_PATHS.waterTemperature),
};

const AIR_TEMP_DEF: TileDef = {
  id: 'air-temp',
  label: 'Air temp',
  abbr: 'AIR',
  description: 'Outside air temperature.',
  sensorGloss: 'No air temperature',
  paths: [SK_PATHS.outsideTemperature],
  zonesPath: SK_PATHS.outsideTemperature,
  category: 'weather',
  kind: 'numeric',
  viz: 'spark',
  trend: trendMetadata('temperature', [trendCandidate(SK_PATHS.outsideTemperature)], 1),
  read: temperatureRead(SK_PATHS.outsideTemperature),
};

const GNSS_DEF: TileDef = {
  id: 'gnss-satellites',
  label: 'Satellites',
  abbr: 'GPS',
  description: 'Number of GNSS satellites in the position fix.',
  sensorGloss: 'No GNSS receiver',
  paths: [SK_PATHS.gnssSatellites],
  zonesPath: SK_PATHS.gnssSatellites,
  category: 'navigation',
  kind: 'numeric',
  trend: trendMetadata('count', [trendCandidate(SK_PATHS.gnssSatellites)], 0, 0, 'last'),
  read({ store, clock }) {
    const cell = store.cell(SK_PATHS.gnssSatellites);
    const state = grade(cell, clock);
    const count = asNumber(cell.value);
    return { state, value: formatFixed(count, 0), unit: '', siValue: count };
  },
};

// Rate-of-turn arrives in rad/s (SI); the readout is signed degrees per minute, the convention on
// a chartplotter turn indicator. Exported so the RotNeedle dial scales with the same conversion.
export const RAD_PER_SEC_TO_DEG_PER_MIN = RAD_TO_DEG * 60;

const ROT_DEF: TileDef = {
  id: 'rate-of-turn',
  label: 'Turn rate',
  abbr: 'ROT',
  description: 'Rate of turn: how fast the bow is swinging, in degrees per minute.',
  sensorGloss: 'No turn sensor',
  paths: [SK_PATHS.rateOfTurn],
  zonesPath: SK_PATHS.rateOfTurn,
  category: 'navigation',
  kind: 'numeric',
  viz: 'rot',
  trend: trendMetadata('rate-of-turn', [trendCandidate(SK_PATHS.rateOfTurn)], 1),
  read({ store, clock }) {
    const cell = store.cell(SK_PATHS.rateOfTurn);
    const state = grade(cell, clock);
    const radPerSec = asNumber(cell.value);
    const degPerMin = radPerSec === undefined ? undefined : radPerSec * RAD_PER_SEC_TO_DEG_PER_MIN;
    return { state, value: formatFixed(degPerMin, 1), unit: '°/min', siValue: radPerSec };
  },
};

export const TILE_CATALOG: readonly TileDef[] = [
  SOG_DEF,
  HDG_DEF,
  DEPTH_DEF,
  WIND_APPARENT_DEF,
  STW_DEF,
  WIND_TRUE_DEF,
  PRESSURE_DEF,
  POSITION_DEF,
  WAYPOINT_DEF,
  COURSE_VMG_DEF,
  COURSE_XTE_DEF,
  COURSE_TTG_DEF,
  WATER_TEMP_DEF,
  AIR_TEMP_DEF,
  GNSS_DEF,
  ROT_DEF,
];

export const DEFAULT_TILES: readonly string[] = ['sog', 'heading', 'depth', 'wind-apparent'];

// Build a tile def for a single battery instance on demand. The def is created at lookup time,
// so discovery (which runs asynchronously) does not need to be complete for a stored selection
// containing a battery tile to resolve correctly.
export function batteryTileDef(instanceId: string): TileDef {
  const path = `electrical.batteries.${instanceId}.voltage`;
  const name = titledSource(instanceId, 'battery');
  return {
    id: `battery:${instanceId}`,
    label: readingLabel('Voltage', name),
    abbr: 'VOLT',
    description: `${name} voltage.`,
    sensorGloss: 'No battery data',
    paths: [path],
    zonesPath: path,
    category: 'electrical',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('voltage', [trendCandidate(path)], 1),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const volts = asNumber(cell.value);
      return {
        state,
        value: formatFixed(volts, 1),
        unit: 'V',
        siValue: volts,
      };
    },
  };
}

// State of charge for a single battery instance: a 0..1 ratio shown as a whole-number percent.
export function batterySocTileDef(instanceId: string): TileDef {
  const path = `electrical.batteries.${instanceId}.capacity.stateOfCharge`;
  const name = titledSource(instanceId, 'battery');
  return {
    id: `battery-soc:${instanceId}`,
    label: readingLabel('State of charge', name),
    abbr: 'SOC',
    description: `${name} state of charge.`,
    sensorGloss: 'No charge data',
    paths: [path],
    zonesPath: path,
    category: 'electrical',
    kind: 'numeric',
    viz: 'battery',
    trend: trendMetadata('ratio', [trendCandidate(path)], 0),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const ratio = asNumber(cell.value);
      return { state, value: formatPercent(ratio), unit: '%', siValue: ratio };
    },
  };
}

// Estimated time remaining at the present load for a single battery instance.
export function batteryTimeTileDef(instanceId: string): TileDef {
  const path = `electrical.batteries.${instanceId}.capacity.timeRemaining`;
  const name = titledSource(instanceId, 'battery');
  return {
    id: `battery-time:${instanceId}`,
    label: readingLabel('Time remaining', name),
    abbr: 'TIME',
    description: `${name} time remaining at the present load.`,
    sensorGloss: 'No time estimate',
    paths: [path],
    zonesPath: path,
    category: 'electrical',
    kind: 'numeric',
    trend: trendMetadata('duration', [trendCandidate(path)], 1),
    read({ store, clock }) {
      const cell = store.cell(path);
      const seconds = asNumber(cell.value);
      // timeRemaining is null when the battery is full or charging: a real reported-then-absent
      // reading, shown as the placeholder rather than a fabricated duration.
      if (seconds === undefined) {
        return {
          state: cell.epoch === 0 ? 'never' : 'placeholder',
          value: PLACEHOLDER,
          unit: '',
        };
      }
      return {
        state: grade(cell, clock),
        value: formatDuration(seconds),
        unit: '',
        siValue: seconds,
      };
    },
  };
}

// Instantaneous current for a single battery instance: signed, negative while discharging.
export function batteryCurrentTileDef(instanceId: string): TileDef {
  const path = `electrical.batteries.${instanceId}.current`;
  const name = titledSource(instanceId, 'battery');
  return {
    id: `battery-current:${instanceId}`,
    label: readingLabel('Current', name),
    abbr: 'AMPS',
    description: `${name} current, negative when discharging.`,
    sensorGloss: 'No current data',
    paths: [path],
    zonesPath: path,
    category: 'electrical',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('current', [trendCandidate(path)], 1),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const amps = asNumber(cell.value);
      return { state, value: formatFixed(amps, 1), unit: 'A', siValue: amps };
    },
  };
}

function titleId(instanceId: string): string {
  return instanceId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function titledSource(instanceId: string, suffix: string): string {
  const name = titleId(instanceId);
  return name.toLowerCase().split(/\s+/).includes(suffix.toLowerCase())
    ? name
    : `${name} ${suffix}`;
}

function readingLabel(reading: string, source: string): string {
  return `${reading} · ${source}`;
}

function formatWatts(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return PLACEHOLDER;
  return Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) : value.toFixed(0);
}

function wattsUnit(value: number | undefined): string {
  return value !== undefined && Math.abs(value) >= 1000 ? 'kW' : 'W';
}

function formatEnergy(valueJoules: number | undefined): string {
  if (valueJoules === undefined || Number.isNaN(valueJoules)) return PLACEHOLDER;
  return (valueJoules / 3_600_000).toFixed(1);
}

function formatVolume(m3: number | undefined, mode: TileDeps['units']['mode']): string {
  if (m3 === undefined || Number.isNaN(m3)) return PLACEHOLDER;
  return mode === 'imperial' ? (m3 * 264.172052).toFixed(1) : (m3 * 1000).toFixed(0);
}

function volumeUnit(mode: TileDeps['units']['mode']): string {
  return mode === 'imperial' ? 'gal' : 'L';
}

export function propulsionRpmTileDef(instanceId: string): TileDef {
  const path = `propulsion.${instanceId}.revolutions`;
  const name = titledSource(instanceId, 'engine');
  return {
    id: `prop-rpm:${instanceId}`,
    label: readingLabel('RPM', name),
    abbr: 'RPM',
    description: `${name} revolutions per minute.`,
    sensorGloss: 'No engine speed',
    paths: [path],
    zonesPath: path,
    category: 'propulsion',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('rpm', [trendCandidate(path)], 0),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const rps = asNumber(cell.value);
      const rpm = rps === undefined ? undefined : rps * 60;
      return { state, value: formatFixed(rpm, 0), unit: 'rpm', siValue: rps };
    },
  };
}

export function propulsionTemperatureTileDef(instanceId: string): TileDef {
  const path = `propulsion.${instanceId}.temperature`;
  const name = titledSource(instanceId, 'engine');
  return {
    id: `prop-temp:${instanceId}`,
    label: readingLabel('Temperature', name),
    abbr: 'TEMP',
    description: `${name} temperature.`,
    sensorGloss: 'No engine temperature',
    paths: [path],
    zonesPath: path,
    category: 'propulsion',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('temperature', [trendCandidate(path)], 1),
    read: temperatureRead(path),
  };
}

function propulsionCoolantTileDef(instanceId: string): TileDef {
  const path = `propulsion.${instanceId}.coolantTemperature`;
  const name = titledSource(instanceId, 'engine');
  return {
    id: `prop-coolant:${instanceId}`,
    label: readingLabel('Coolant temperature', name),
    abbr: 'COOL',
    description: `${name} coolant temperature.`,
    sensorGloss: 'No coolant temperature',
    paths: [path],
    zonesPath: path,
    category: 'propulsion',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('temperature', [trendCandidate(path)], 1),
    read: temperatureRead(path),
  };
}

function propulsionOilPressureTileDef(instanceId: string): TileDef {
  const path = `propulsion.${instanceId}.oilPressure`;
  const name = titledSource(instanceId, 'engine');
  return {
    id: `prop-oil:${instanceId}`,
    label: readingLabel('Oil pressure', name),
    abbr: 'OIL',
    description: `${name} oil pressure.`,
    sensorGloss: 'No oil pressure',
    paths: [path],
    zonesPath: path,
    category: 'propulsion',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('pressure', [trendCandidate(path)], 0, 2),
    read({ store, clock, units }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const pa = asNumber(cell.value);
      return {
        state,
        value: formatPressureOr(pa, units.mode),
        unit: pressureUnit(units.mode),
        siValue: pa,
      };
    },
  };
}

export function propulsionLoadTileDef(instanceId: string): TileDef {
  const path = `propulsion.${instanceId}.engineLoad`;
  const name = titledSource(instanceId, 'engine');
  return {
    id: `prop-load:${instanceId}`,
    label: readingLabel('Load', name),
    abbr: 'LOAD',
    description: `${name} load.`,
    sensorGloss: 'No engine load',
    paths: [path],
    zonesPath: path,
    category: 'propulsion',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('ratio', [trendCandidate(path)], 0),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const ratio = asNumber(cell.value);
      return { state, value: formatPercent(ratio), unit: '%', siValue: ratio };
    },
  };
}

export function tankLevelTileDef(instanceId: string): TileDef {
  const path = `tanks.${instanceId}.currentLevel`;
  const name = titledSource(instanceId, 'tank');
  return {
    id: `tank-level:${instanceId}`,
    label: readingLabel('Level', name),
    abbr: 'LEVEL',
    description: `${name} level.`,
    sensorGloss: 'No tank level',
    paths: [path],
    zonesPath: path,
    category: 'tanks',
    kind: 'numeric',
    viz: 'battery',
    trend: trendMetadata('ratio', [trendCandidate(path)], 0),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const ratio = asNumber(cell.value);
      return { state, value: formatPercent(ratio), unit: '%', siValue: ratio };
    },
  };
}

function tankVolumeTileDef(instanceId: string): TileDef {
  const path = `tanks.${instanceId}.currentVolume`;
  const name = titledSource(instanceId, 'tank');
  return {
    id: `tank-volume:${instanceId}`,
    label: readingLabel('Volume', name),
    abbr: 'VOL',
    description: `${name} volume.`,
    sensorGloss: 'No tank volume',
    paths: [path],
    zonesPath: path,
    category: 'tanks',
    kind: 'numeric',
    trend: trendMetadata('volume', [trendCandidate(path)], 0, 1),
    read({ store, clock, units }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const m3 = asNumber(cell.value);
      return {
        state,
        value: formatVolume(m3, units.mode),
        unit: volumeUnit(units.mode),
        siValue: m3,
      };
    },
  };
}

export function solarPowerTileDef(instanceId: string): TileDef {
  const path = `electrical.solar.${instanceId}.panelPower`;
  const name = titledSource(instanceId, 'solar');
  return {
    id: `solar-power:${instanceId}`,
    label: readingLabel('Power', name),
    abbr: 'POWER',
    description: `${name} panel power.`,
    sensorGloss: 'No solar power',
    paths: [path],
    zonesPath: path,
    category: 'electrical',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('power', [trendCandidate(path)], 0),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const watts = asNumber(cell.value);
      return { state, value: formatWatts(watts), unit: wattsUnit(watts), siValue: watts };
    },
  };
}

function solarCurrentTileDef(instanceId: string): TileDef {
  const path = `electrical.solar.${instanceId}.panelCurrent`;
  const name = titledSource(instanceId, 'solar');
  return {
    id: `solar-current:${instanceId}`,
    label: readingLabel('Current', name),
    abbr: 'AMPS',
    description: `${name} panel current.`,
    sensorGloss: 'No solar current',
    paths: [path],
    zonesPath: path,
    category: 'electrical',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('current', [trendCandidate(path)], 1),
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const amps = asNumber(cell.value);
      return { state, value: formatFixed(amps, 1), unit: 'A', siValue: amps };
    },
  };
}

function solarYieldTileDef(instanceId: string): TileDef {
  const path = `electrical.solar.${instanceId}.yieldToday`;
  const name = titledSource(instanceId, 'solar');
  return {
    id: `solar-yield:${instanceId}`,
    label: readingLabel('Energy today', name),
    abbr: 'TODAY',
    description: `${name} energy yield today.`,
    sensorGloss: 'No solar yield',
    paths: [path],
    zonesPath: path,
    category: 'electrical',
    kind: 'numeric',
    read({ store, clock }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const joules = asNumber(cell.value);
      return { state, value: formatEnergy(joules), unit: 'kWh', siValue: joules };
    },
  };
}

export function insideTemperatureTileDef(instanceId: string): TileDef {
  const path = `environment.inside.${instanceId}.temperature`;
  const name = titleId(instanceId);
  return {
    id: `inside-temp:${instanceId}`,
    label: readingLabel('Temperature', name),
    abbr: 'TEMP',
    description: `${name} temperature.`,
    sensorGloss: 'No inside temperature',
    paths: [path],
    zonesPath: path,
    category: 'cabin',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('temperature', [trendCandidate(path)], 1),
    read: temperatureRead(path),
  };
}

export function insideHumidityTileDef(instanceId: string): TileDef {
  const primary = `environment.inside.${instanceId}.relativeHumidity`;
  const fallback = `environment.inside.${instanceId}.humidity`;
  const name = titleId(instanceId);
  return {
    id: `inside-humidity:${instanceId}`,
    label: readingLabel('Humidity', name),
    abbr: 'RH',
    description: `${name} relative humidity.`,
    sensorGloss: 'No humidity',
    paths: [primary, fallback],
    zonesPath: primary,
    category: 'cabin',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata(
      'ratio',
      [trendCandidate(primary, 'Relative humidity'), trendCandidate(fallback, 'Humidity')],
      0,
    ),
    read({ store, clock }) {
      const primaryCell = store.cell(primary);
      const fallbackCell = store.cell(fallback);
      const cell = primaryCell.epoch > 0 ? primaryCell : fallbackCell;
      const state = grade(cell, clock);
      const ratio = asNumber(cell.value);
      return { state, value: formatPercent(ratio), unit: '%', siValue: ratio };
    },
  };
}

function insidePressureTileDef(instanceId: string): TileDef {
  const path = `environment.inside.${instanceId}.pressure`;
  const name = titleId(instanceId);
  return {
    id: `inside-pressure:${instanceId}`,
    label: readingLabel('Pressure', name),
    abbr: 'BARO',
    description: `${name} air pressure.`,
    sensorGloss: 'No inside pressure',
    paths: [path],
    zonesPath: path,
    category: 'cabin',
    kind: 'numeric',
    viz: 'spark',
    trend: trendMetadata('pressure', [trendCandidate(path)], 0, 2),
    read({ store, clock, units }) {
      const cell = store.cell(path);
      const state = grade(cell, clock);
      const pa = asNumber(cell.value);
      return {
        state,
        value: formatPressureOr(pa, units.mode),
        unit: pressureUnit(units.mode),
        siValue: pa,
      };
    },
  };
}

// The full per-instance tile set: voltage, state of charge, time remaining, and current. The
// catalog getter and cell warm-up derive their paths from this so the four defs never drift.
export function batteryDefsFor(instanceId: string): TileDef[] {
  return [
    batteryTileDef(instanceId),
    batterySocTileDef(instanceId),
    batteryTimeTileDef(instanceId),
    batteryCurrentTileDef(instanceId),
  ];
}

export function propulsionDefsFor(instanceId: string): TileDef[] {
  return [
    propulsionRpmTileDef(instanceId),
    propulsionTemperatureTileDef(instanceId),
    propulsionCoolantTileDef(instanceId),
    propulsionOilPressureTileDef(instanceId),
    propulsionLoadTileDef(instanceId),
  ];
}

export function tankDefsFor(instanceId: string): TileDef[] {
  return [tankLevelTileDef(instanceId), tankVolumeTileDef(instanceId)];
}

export function solarDefsFor(instanceId: string): TileDef[] {
  return [
    solarPowerTileDef(instanceId),
    solarCurrentTileDef(instanceId),
    solarYieldTileDef(instanceId),
  ];
}

export function insideDefsFor(instanceId: string): TileDef[] {
  return [
    insideTemperatureTileDef(instanceId),
    insideHumidityTileDef(instanceId),
    insidePressureTileDef(instanceId),
  ];
}

// Most dynamic instance ids allow digits, letters, underscores, and hyphens only. Tank ids may also
// carry one dot because Signal K commonly nests tanks by type, such as tanks.fuel.port.
const DYNAMIC_ID_RE =
  /^(battery(?:-(?:soc|time|current))?|prop-(?:rpm|temp|coolant|oil|load)|tank-(?:level|volume)|solar-(?:power|current|yield)|inside-(?:temp|humidity|pressure)):([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?)$/;

function dynamicDefsFor(kind: string, instanceId: string): TileDef[] {
  if (!kind.startsWith('tank-') && instanceId.includes('.')) return [];
  if (kind.startsWith('battery')) return batteryDefsFor(instanceId);
  if (kind.startsWith('prop-')) return propulsionDefsFor(instanceId);
  if (kind.startsWith('tank-')) return tankDefsFor(instanceId);
  if (kind.startsWith('solar-')) return solarDefsFor(instanceId);
  if (kind.startsWith('inside-')) return insideDefsFor(instanceId);
  return [];
}

// Dynamic defs are memoized by id: tileById runs on every tiles read (a hot, reactive path), and a
// fresh def per call would allocate per render and break identity-keyed consumers. The id space is
// finite (discovered instances times four), so the cache is bounded.
const dynamicDefCache = new Map<string, TileDef>();

export function tileById(id: string): TileDef | undefined {
  const staticDef = TILE_CATALOG.find((def) => def.id === id);
  if (staticDef) return staticDef;
  const cached = dynamicDefCache.get(id);
  if (cached) return cached;
  const match = DYNAMIC_ID_RE.exec(id);
  if (!match) return undefined;
  const def = dynamicDefsFor(match[1], match[2]).find((d) => d.id === id);
  if (def) dynamicDefCache.set(id, def);
  return def;
}

// ALL_CATALOG_PATHS covers only the static catalog (course tile contributes no paths; battery
// paths are dynamic and ensured separately when discovery lands).
export const ALL_CATALOG_PATHS: readonly string[] = [
  ...new Set(TILE_CATALOG.flatMap((def) => def.paths)),
];

// Client-side default zones applied when a path has no server-configured meta.zones. The server's
// zones always take precedence when present. Depths in meters (SI).
export const CLIENT_DEFAULT_ZONES: ReadonlyMap<string, MetaZone[]> = new Map([
  [
    SK_PATHS.depthBelowKeel,
    [
      { upper: 2, state: 'alarm', message: 'Shallow' },
      { lower: 2, upper: 5, state: 'warn' },
    ],
  ],
]);
