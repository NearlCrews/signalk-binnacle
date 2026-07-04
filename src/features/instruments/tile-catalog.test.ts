import { describe, expect, it } from 'vitest';
import type { CourseGuidance } from '$entities/course';
import { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import type { ReactiveClock, UnitsMode } from '$shared/lib';
import { PLACEHOLDER } from '$shared/lib';
import { PersistedValue } from '$shared/settings';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore, SK_PATHS } from '$shared/signalk';
import type { TileDeps } from './tile-catalog';
import {
  ALL_CATALOG_PATHS,
  batteryTileDef,
  CLIENT_DEFAULT_ZONES,
  DEFAULT_TILES,
  TILE_CATALOG,
  TILE_STALE_MS,
  tileById,
} from './tile-catalog';

// Asserts the tile exists and calls read() - avoids non-null assertions throughout tests.
function readTile(id: string, deps: TileDeps) {
  const def = tileById(id);
  if (!def) throw new Error(`No tile with id '${id}'`);
  return def.read(deps);
}

function skFrame(self: Record<string, unknown>, epoch = 1000): SKFrame {
  return {
    self: new Map(Object.entries(self)) as SKFrame['self'],
    connection: { phase: 'open', attempt: 0 },
    epoch,
  };
}

function makeDeps(clock: ReactiveClock, mode: UnitsMode = 'metric') {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  // OwnVessel pre-creates its own paths; add the instrument-only paths the tiles need.
  store.ensureCells([
    SK_PATHS.speedThroughWater,
    SK_PATHS.headingMagnetic,
    SK_PATHS.windAngleApparent,
    SK_PATHS.windSpeedTrue,
    SK_PATHS.windAngleTrueWater,
  ]);
  // PersistedValue uses fallback when no storage is available (Node test env).
  const local = new PersistedValue<UnitsMode>('binnacle:units', mode);
  const units = new UnitsStore(local);
  return { store, vessel, units, clock, course: inactiveCourse() };
}

function inactiveCourse(): CourseGuidance {
  return { active: false } as unknown as CourseGuidance;
}

function activeCourse(dtwMeters: number | undefined, btwRad: number | undefined): CourseGuidance {
  return {
    active: true,
    distanceToNextMeters: dtwMeters,
    bearingToNextRad: btwRad,
  } as unknown as CourseGuidance;
}

describe('tile catalog structure', () => {
  it('DEFAULT_TILES are sog, heading, depth, wind-apparent in that order', () => {
    expect(DEFAULT_TILES).toEqual(['sog', 'heading', 'depth', 'wind-apparent']);
  });

  it('every DEFAULT_TILES id resolves via tileById', () => {
    for (const id of DEFAULT_TILES) {
      expect(tileById(id), `tileById('${id}')`).toBeDefined();
    }
  });

  it('tileById returns undefined for an unknown id', () => {
    expect(tileById('no-such-tile')).toBeUndefined();
  });

  it('ALL_CATALOG_PATHS contains every path from every def', () => {
    const all = new Set(ALL_CATALOG_PATHS);
    for (const def of TILE_CATALOG) {
      for (const path of def.paths) {
        expect(all.has(path), `${path} in ALL_CATALOG_PATHS (from ${def.id})`).toBe(true);
      }
    }
  });

  it('ALL_CATALOG_PATHS has no duplicate entries', () => {
    expect(ALL_CATALOG_PATHS.length).toBe(new Set(ALL_CATALOG_PATHS).size);
  });

  it('ALL_CATALOG_PATHS includes the new instrument paths added in Tasks 1-3', () => {
    const all = new Set(ALL_CATALOG_PATHS);
    expect(all.has(SK_PATHS.speedThroughWater)).toBe(true);
    expect(all.has(SK_PATHS.windAngleApparent)).toBe(true);
    expect(all.has(SK_PATHS.windSpeedTrue)).toBe(true);
    expect(all.has(SK_PATHS.windAngleTrueWater)).toBe(true);
    expect(all.has(SK_PATHS.headingMagnetic)).toBe(true);
  });
});

describe('state grading', () => {
  it("epoch === 0 → 'never' with value === PLACEHOLDER", () => {
    const clock = { now: 5000 };
    const deps = makeDeps(clock);
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it("value undefined after a report → 'placeholder'", () => {
    const clock = { now: 5000 };
    const deps = makeDeps(clock);
    // Stamp the epoch without setting a value (direct cell write, as the brief allows).
    const cell = deps.store.cell(SK_PATHS.speedOverGround);
    cell.epoch = 5000;
    // cell.value remains undefined (default)
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('placeholder');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it("elapsed > TILE_STALE_MS → 'stale' with last value retained (not PLACEHOLDER)", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 3.0 }, 1000));
    clock.now = 1000 + TILE_STALE_MS + 1;
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('stale');
    expect(reading.value).not.toBe(PLACEHOLDER);
  });

  it("elapsed <= TILE_STALE_MS with value present → 'live'", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 3.0 }, 1000));
    clock.now = 1000 + 100;
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('live');
  });
});

describe('sog tile', () => {
  it('formats speed in knots and carries siValue as m/s', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // 1 m/s = 3600/1852 ≈ 1.944 kn
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 1.0 }, 1000));
    const reading = readTile('sog', deps);
    expect(reading.unit).toBe('kn');
    // formatKnotsOr rounds to 1 decimal place, so compare within 1-decimal tolerance.
    expect(Number(reading.value)).toBeCloseTo(1.944, 1);
    expect(reading.siValue).toBeCloseTo(1.0);
  });
});

describe('depth tile', () => {
  it('formats in meters and returns unit m when mode is metric', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowTransducer]: 10.0 }, 1000));
    const reading = readTile('depth', deps);
    expect(reading.unit).toBe('m');
    expect(reading.value).toBe('10.0');
  });

  it('formats in feet and returns unit ft when mode is imperial', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'imperial');
    // 1 m = 1/0.3048 ≈ 3.281 ft
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowTransducer]: 1.0 }, 1000));
    const reading = readTile('depth', deps);
    expect(reading.unit).toBe('ft');
    // formatLengthOr rounds to 1 decimal place, so compare within 1-decimal tolerance.
    expect(Number(reading.value)).toBeCloseTo(3.281, 1);
  });
});

describe('heading tile fallback chain', () => {
  it('headingTrue present → no referenceLabel, bearing in degrees', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // π/2 rad = 90°
    deps.store.applyFrame(skFrame({ [SK_PATHS.headingTrue]: Math.PI / 2 }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBeUndefined();
    expect(Number(reading.value)).toBeCloseTo(90, 0);
  });

  it('only headingMagnetic reported → state live, referenceLabel M', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.headingMagnetic]: Math.PI }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBe('M');
    expect(Number(reading.value)).toBeCloseTo(180, 0);
  });

  it('only COG reported → state live, referenceLabel COG', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.courseOverGroundTrue]: Math.PI / 4 }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBe('COG');
  });

  it("none reported → state 'never', value PLACEHOLDER", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it('primary stale but still preferred over a fresh magnetic fallback', () => {
    // Once headingTrue has ever reported, the tile grades on it even if stale.
    // It should not silently switch to a magnetic source mid-passage.
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.headingTrue]: 0, [SK_PATHS.headingMagnetic]: 0.1 }, 1000),
    );
    clock.now = 1000 + TILE_STALE_MS + 1;
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('stale');
    expect(reading.referenceLabel).toBeUndefined();
  });
});

describe('wind-apparent tile', () => {
  it('returns live state, knots speed, signed angleRad, and m/s siValue', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // -0.5 rad = port side (negative = port by Signal K convention)
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedApparent]: 5.0, [SK_PATHS.windAngleApparent]: -0.5 }, 1000),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('kn');
    // 5.0 m/s ≈ 9.72 kn
    expect(Number(reading.value)).toBeCloseTo(9.72, 1);
    expect(reading.siValue).toBeCloseTo(5.0);
    expect(reading.angleRad).toBeCloseTo(-0.5);
  });
});

describe('wind-true tile', () => {
  it('reads from windSpeedTrue and windAngleTrueWater cells', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedTrue]: 6.0, [SK_PATHS.windAngleTrueWater]: 0.8 }, 1000),
    );
    const reading = readTile('wind-true', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('kn');
    expect(reading.siValue).toBeCloseTo(6.0);
    expect(reading.angleRad).toBeCloseTo(0.8);
  });
});

describe('pressure tile', () => {
  it('formats in hPa (metric)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    // 101325 Pa = 1013 hPa
    deps.store.applyFrame(skFrame({ [SK_PATHS.outsidePressure]: 101325 }, 1000));
    const reading = readTile('pressure', deps);
    expect(reading.unit).toBe('hPa');
    expect(reading.value).toBe('1013');
  });

  it('formats in inHg (imperial)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'imperial');
    // 101325 Pa ≈ 29.92 inHg
    deps.store.applyFrame(skFrame({ [SK_PATHS.outsidePressure]: 101325 }, 1000));
    const reading = readTile('pressure', deps);
    expect(reading.unit).toBe('inHg');
    expect(Number(reading.value)).toBeCloseTo(29.92, 1);
  });
});

describe('position tile', () => {
  it('returns PLACEHOLDER when no fix', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const reading = readTile('position', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it('returns formatted lat and lon separated by newline when fix present', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.position]: { latitude: 36.8, longitude: -121.7 } }, 1000),
    );
    const reading = readTile('position', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('');
    const [latLine, lonLine] = reading.value.split('\n');
    expect(latLine).toContain('N');
    expect(lonLine).toContain('W');
  });
});

describe('course tile', () => {
  it("returns state 'never' and PLACEHOLDER when no course is active", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const reading = readTile('course', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
    expect(reading.unit).toBe('');
  });

  it("returns state 'live' with DTW/BTW two-line value when course is active", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // 1852 m = 1.00 nm; Math.PI / 4 rad = 45 deg
    deps.course = activeCourse(1852, Math.PI / 4);
    const reading = readTile('course', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('');
    const [dtwLine, btwLine] = reading.value.split('\n');
    expect(dtwLine).toContain('nm');
    // dtwLine is e.g. "1.00 nm"; parseFloat parses the leading numeric portion.
    expect(parseFloat(dtwLine)).toBeCloseTo(1.0, 1);
    expect(btwLine).toContain('°');
    expect(parseFloat(btwLine)).toBeCloseTo(45, 0);
  });

  it('renders PLACEHOLDER lines when active with undefined DTW and BTW', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.course = activeCourse(undefined, undefined);
    const reading = readTile('course', deps);
    expect(reading.state).toBe('live');
    const [dtwLine, btwLine] = reading.value.split('\n');
    expect(dtwLine).toContain(PLACEHOLDER);
    expect(btwLine).toContain(PLACEHOLDER);
  });

  it('carries no siValue (the distance path has no zones to band against)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.course = activeCourse(3704, 0);
    const reading = readTile('course', deps);
    expect(reading.siValue).toBeUndefined();
  });

  it('course tile has empty paths array (no demand subscription needed)', () => {
    const def = tileById('course');
    expect(def?.paths).toEqual([]);
  });

  it('course tile is NOT in DEFAULT_TILES', () => {
    expect(DEFAULT_TILES).not.toContain('course');
  });

  it('course tile IS in TILE_CATALOG', () => {
    expect(TILE_CATALOG.some((d) => d.id === 'course')).toBe(true);
  });
});

describe('batteryTileDef', () => {
  it('generates correct id, label, and path for an instance', () => {
    const def = batteryTileDef('house');
    expect(def.id).toBe('battery:house');
    expect(def.label).toBe('BATT HOUSE');
    expect(def.description).toBe('Battery house voltage');
    expect(def.paths).toEqual(['electrical.batteries.house.voltage']);
    expect(def.zonesPath).toBe('electrical.batteries.house.voltage');
    expect(def.kind).toBe('numeric');
    expect(def.sensorGloss).toBe('No battery data');
  });

  it('reads voltage from the store cell', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTileDef('house');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'electrical.batteries.house.voltage': 12.6 }, 1000));
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('12.6');
    expect(reading.unit).toBe('V');
    expect(reading.siValue).toBeCloseTo(12.6);
  });

  it("returns state 'never' and unit V when no data", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTileDef('starter');
    deps.store.ensureCells(def.paths);
    const reading = def.read(deps);
    expect(reading.state).toBe('never');
    expect(reading.unit).toBe('V');
  });
});

describe('tileById battery: pattern', () => {
  it('resolves a valid battery instance id', () => {
    const def = tileById('battery:house');
    expect(def).toBeDefined();
    expect(def?.id).toBe('battery:house');
  });

  it('resolves battery ids with digits and hyphens', () => {
    expect(tileById('battery:bank-1')).toBeDefined();
    expect(tileById('battery:b2')).toBeDefined();
  });

  it('returns undefined for battery: ids with invalid characters', () => {
    expect(tileById('battery:has space')).toBeUndefined();
    expect(tileById('battery:has.dot')).toBeUndefined();
    expect(tileById('battery:')).toBeUndefined();
  });

  it('still resolves all static tile ids', () => {
    for (const def of TILE_CATALOG) {
      expect(tileById(def.id), `tileById('${def.id}')`).toBeDefined();
    }
  });
});

describe('CLIENT_DEFAULT_ZONES', () => {
  it('contains an entry for the depth path', () => {
    expect(CLIENT_DEFAULT_ZONES.has(SK_PATHS.depthBelowTransducer)).toBe(true);
  });

  it('depth zones: value 1.5 → alarm, 3 → warning (warn maps to warning), 10 → normal (outside zones)', () => {
    // Verify the zone values directly without going through the controller, so the test is
    // a pure data check independent of zoneStateFor.
    const zones = CLIENT_DEFAULT_ZONES.get(SK_PATHS.depthBelowTransducer);
    expect(zones).toBeDefined();
    expect(zones?.some((z) => z.upper === 2 && z.state === 'alarm')).toBe(true);
    expect(zones?.some((z) => z.lower === 2 && z.upper === 5 && z.state === 'warn')).toBe(true);
  });
});
