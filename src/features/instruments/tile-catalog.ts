import type { CourseGuidance } from '$entities/course';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { asNumber } from '$shared/geo';
import type { ReactiveClock } from '$shared/lib';
import {
  formatBearingOr,
  formatFixed,
  formatKnotsOr,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  formatNmOr,
  formatPressureOr,
  lengthUnit,
  PLACEHOLDER,
  pressureUnit,
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
  referenceLabel?: string;
  angleRad?: number;
}

export interface TileDef {
  id: string;
  label: string;
  description: string;
  sensorGloss: string;
  paths: string[];
  zonesPath: string;
  kind: 'numeric' | 'wind' | 'position';
  read(deps: TileDeps): TileReading;
}

export const TILE_STALE_MS = 10_000;

// Structural alias avoids importing PathCell from the shared/signalk internal file.
type PathCell = ReturnType<SignalKStore['cell']>;

function grade(cell: PathCell, clock: ReactiveClock): TileValueState {
  if (cell.epoch === 0) return 'never';
  if (clock.now - cell.epoch > TILE_STALE_MS) return 'stale';
  return cell.value === undefined ? 'placeholder' : 'live';
}

const SOG_DEF: TileDef = {
  id: 'sog',
  label: 'SOG',
  description: 'Speed over ground',
  sensorGloss: 'No speed data',
  paths: [SK_PATHS.speedOverGround],
  zonesPath: SK_PATHS.speedOverGround,
  kind: 'numeric',
  read({ vessel, store, clock }) {
    const cell = store.cell(SK_PATHS.speedOverGround);
    const state = grade(cell, clock);
    const mps = vessel.sogMps;
    return { state, value: formatKnotsOr(mps), unit: 'kn', siValue: mps };
  },
};

const HDG_DEF: TileDef = {
  id: 'heading',
  label: 'HDG',
  description: 'Heading',
  sensorGloss: 'No heading data',
  // COG is a last-resort fallback; subscribing it here keeps the cell warm.
  paths: [SK_PATHS.headingTrue, SK_PATHS.headingMagnetic, SK_PATHS.courseOverGroundTrue],
  zonesPath: SK_PATHS.headingTrue,
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
      value: formatBearingOr(value),
      unit: '°',
      siValue: value,
      referenceLabel,
    };
  },
};

const DEPTH_DEF: TileDef = {
  id: 'depth',
  label: 'DEPTH',
  description: 'Depth below transducer',
  sensorGloss: 'No depth sensor',
  paths: [SK_PATHS.depthBelowTransducer],
  zonesPath: SK_PATHS.depthBelowTransducer,
  kind: 'numeric',
  read({ vessel, store, clock, units }) {
    const cell = store.cell(SK_PATHS.depthBelowTransducer);
    const state = grade(cell, clock);
    const meters = vessel.depthMeters;
    const mode = units.mode;
    return {
      state,
      value: formatLengthOr(meters, mode),
      unit: lengthUnit(mode),
      siValue: meters,
    };
  },
};

const WIND_APPARENT_DEF: TileDef = {
  id: 'wind-apparent',
  label: 'AWS',
  description: 'Apparent wind',
  sensorGloss: 'No wind sensor',
  paths: [SK_PATHS.windSpeedApparent, SK_PATHS.windAngleApparent],
  zonesPath: SK_PATHS.windSpeedApparent,
  kind: 'wind',
  read({ vessel, store, clock }) {
    const cell = store.cell(SK_PATHS.windSpeedApparent);
    const state = grade(cell, clock);
    const mps = vessel.windSpeedApparentMps;
    const angleRad = asNumber(store.cell(SK_PATHS.windAngleApparent).value);
    return { state, value: formatKnotsOr(mps), unit: 'kn', siValue: mps, angleRad };
  },
};

const STW_DEF: TileDef = {
  id: 'stw',
  label: 'STW',
  description: 'Speed through water',
  sensorGloss: 'No log sensor',
  paths: [SK_PATHS.speedThroughWater],
  zonesPath: SK_PATHS.speedThroughWater,
  kind: 'numeric',
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
  label: 'TWS',
  description: 'True wind',
  sensorGloss: 'No true wind data',
  paths: [SK_PATHS.windSpeedTrue, SK_PATHS.windAngleTrueWater],
  zonesPath: SK_PATHS.windSpeedTrue,
  kind: 'wind',
  read({ store, clock }) {
    const cell = store.cell(SK_PATHS.windSpeedTrue);
    const state = grade(cell, clock);
    const mps = asNumber(cell.value);
    const angleRad = asNumber(store.cell(SK_PATHS.windAngleTrueWater).value);
    return { state, value: formatKnotsOr(mps), unit: 'kn', siValue: mps, angleRad };
  },
};

const PRESSURE_DEF: TileDef = {
  id: 'pressure',
  label: 'BARO',
  description: 'Barometric pressure',
  sensorGloss: 'No pressure sensor',
  paths: [SK_PATHS.outsidePressure],
  zonesPath: SK_PATHS.outsidePressure,
  kind: 'numeric',
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
  label: 'POS',
  description: 'Vessel position',
  sensorGloss: 'No position fix',
  paths: [SK_PATHS.position],
  zonesPath: SK_PATHS.position,
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

const COURSE_DEF: TileDef = {
  id: 'course',
  label: 'WPT',
  description: 'Course to waypoint',
  sensorGloss: 'No active course',
  paths: [],
  zonesPath: COURSE_ZONES_PATH,
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

export const TILE_CATALOG: readonly TileDef[] = [
  SOG_DEF,
  HDG_DEF,
  DEPTH_DEF,
  WIND_APPARENT_DEF,
  STW_DEF,
  WIND_TRUE_DEF,
  PRESSURE_DEF,
  POSITION_DEF,
  COURSE_DEF,
];

export const DEFAULT_TILES: readonly string[] = ['sog', 'heading', 'depth', 'wind-apparent'];

// Battery instance id pattern: digits, letters, underscores, and hyphens only. Anything outside
// this set (spaces, dots, slashes) would corrupt the SK path and is rejected.
const BATTERY_INSTANCE_RE = /^battery:([A-Za-z0-9_-]+)$/;

// Build a tile def for a single battery instance on demand. The def is created at lookup time,
// so discovery (which runs asynchronously) does not need to be complete for a stored selection
// containing a battery tile to resolve correctly.
export function batteryTileDef(instanceId: string): TileDef {
  const path = `electrical.batteries.${instanceId}.voltage`;
  return {
    id: `battery:${instanceId}`,
    label: `BATT ${instanceId.toUpperCase()}`,
    description: `Battery ${instanceId} voltage`,
    sensorGloss: 'No battery data',
    paths: [path],
    zonesPath: path,
    kind: 'numeric',
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

export function tileById(id: string): TileDef | undefined {
  const staticDef = TILE_CATALOG.find((def) => def.id === id);
  if (staticDef) return staticDef;
  const match = BATTERY_INSTANCE_RE.exec(id);
  if (match) return batteryTileDef(match[1]);
  return undefined;
}

// ALL_CATALOG_PATHS covers only the static catalog (course tile contributes no paths; battery
// paths are dynamic and ensured separately when discovery lands).
export const ALL_CATALOG_PATHS: readonly string[] = [
  ...new Set(TILE_CATALOG.flatMap((def) => def.paths)),
];

const MIN_PERIOD_BY_PATH: ReadonlyMap<string, number> = new Map([
  [SK_PATHS.headingTrue, 200],
  [SK_PATHS.outsidePressure, 5000],
]);

export function minPeriodFor(path: string): number {
  return MIN_PERIOD_BY_PATH.get(path) ?? 1000;
}

// Client-side default zones applied when a path has no server-configured meta.zones. The server's
// zones always take precedence when present. Depths in meters (SI).
export const CLIENT_DEFAULT_ZONES: ReadonlyMap<string, MetaZone[]> = new Map([
  [
    SK_PATHS.depthBelowTransducer,
    [
      { upper: 2, state: 'alarm', message: 'Shallow' },
      { lower: 2, upper: 5, state: 'warn' },
    ],
  ],
]);
