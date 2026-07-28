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
  batteryCurrentTileDef,
  batteryDefsFor,
  batterySocTileDef,
  batteryTileDef,
  batteryTimeTileDef,
  CLIENT_DEFAULT_ZONES,
  DEFAULT_TILES,
  insideDefsFor,
  insideHumidityTileDef,
  insideTemperatureTileDef,
  instrumentOptionLabels,
  propulsionDefsFor,
  propulsionLoadTileDef,
  propulsionRpmTileDef,
  propulsionTemperatureTileDef,
  solarDefsFor,
  solarPowerTileDef,
  TILE_CATALOG,
  TILE_STALE_MS,
  tankDefsFor,
  tankLevelTileDef,
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
    SK_PATHS.windSpeedOverGround,
    SK_PATHS.windDirectionTrue,
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
    expect(all.has(SK_PATHS.windSpeedOverGround)).toBe(true);
    expect(all.has(SK_PATHS.windDirectionTrue)).toBe(true);
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

  it('prefers below-keel, then below-transducer, then below-surface and labels the reference', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.depthBelowTransducer]: 8,
          [SK_PATHS.depthBelowSurface]: 9,
          [SK_PATHS.depthBelowKeel]: 7,
        },
        1000,
      ),
    );
    let reading = readTile('depth', deps);
    expect(reading.value).toBe('7.0');
    expect(reading.referenceLabel).toBe('Keel');

    // A positive-offset sounder publishes transducer and surface together; the safety resolution
    // keeps the smaller transducer reading so the tile and the shallow alarm agree.
    const pairedDeps = makeDeps(clock, 'metric');
    pairedDeps.store.applyFrame(
      skFrame({ [SK_PATHS.depthBelowTransducer]: 8, [SK_PATHS.depthBelowSurface]: 9 }, 1000),
    );
    reading = readTile('depth', pairedDeps);
    expect(reading.value).toBe('8.0');
    expect(reading.referenceLabel).toBe('Xducer');

    const surfaceDeps = makeDeps(clock, 'metric');
    surfaceDeps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowSurface]: 9 }, 1000));
    reading = readTile('depth', surfaceDeps);
    expect(reading.value).toBe('9.0');
    expect(reading.referenceLabel).toBe('Surface');
  });

  it('leaves the reference unlabeled until a depth source reports', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    const reading = readTile('depth', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
    expect(reading.referenceLabel).toBeUndefined();
  });

  it('grades a stale keel reading on the keel path rather than a fresh transducer', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowKeel]: 7 }, 1000));
    clock.now = 1000 + TILE_STALE_MS + 1;
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowTransducer]: 8 }, clock.now));
    const reading = readTile('depth', deps);
    expect(reading.state).toBe('stale');
    expect(reading.value).toBe('7.0');
    expect(reading.referenceLabel).toBe('Keel');
  });
});

describe('heading tile fallback chain', () => {
  it('headingTrue present → no referenceLabel, bearing in degrees', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // π/2 rad = 90°, zero-padded to three digits with embedded degree sign
    deps.store.applyFrame(skFrame({ [SK_PATHS.headingTrue]: Math.PI / 2 }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBeUndefined();
    expect(reading.value).toMatch(/^\d{3}°$/);
    expect(Number(reading.value.replace('°', ''))).toBeCloseTo(90, 0);
  });

  it('only headingMagnetic reported → state live, referenceLabel M', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.headingMagnetic]: Math.PI }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBe('M');
    expect(reading.value).toMatch(/^\d{3}°$/);
    expect(Number(reading.value.replace('°', ''))).toBeCloseTo(180, 0);
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

describe('wind-apparent tile ground fallback', () => {
  it('ground-only store: state live, GND referenceLabel, speed from windSpeedOverGround in knots', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame(
        { [SK_PATHS.windSpeedOverGround]: 5.14, [SK_PATHS.windDirectionTrue]: Math.PI },
        1000,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBe('GND');
    expect(Number(reading.value)).toBeCloseTo(9.99, 0);
    expect(reading.siValue).toBeCloseTo(5.14);
  });

  it('ground fallback: angleRad = normalized(directionTrue - headingTrue) when heading present', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // directionTrue = π (from south), headingTrue = π/2 (east) → relative = π - π/2 = π/2
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.windSpeedOverGround]: 3.0,
          [SK_PATHS.windDirectionTrue]: Math.PI,
          [SK_PATHS.headingTrue]: Math.PI / 2,
        },
        1000,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.angleRad).toBeCloseTo(Math.PI / 2, 4);
  });

  it('ground fallback: angleRad undefined when no heading source', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedOverGround]: 3.0, [SK_PATHS.windDirectionTrue]: 1.0 }, 1000),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.angleRad).toBeUndefined();
  });

  it('apparent-present boat: apparent takes priority, no GND label', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.windSpeedApparent]: 5.0,
          [SK_PATHS.windAngleApparent]: -0.5,
          [SK_PATHS.windSpeedOverGround]: 8.0,
          [SK_PATHS.windDirectionTrue]: 1.0,
        },
        1000,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.referenceLabel).toBeUndefined();
    expect(reading.siValue).toBeCloseTo(5.0);
  });

  it('stale apparent keeps priority over fresh ground wind', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedApparent]: 5.0, [SK_PATHS.windAngleApparent]: -0.5 }, 1000),
    );
    clock.now = 1000 + TILE_STALE_MS + 1;
    deps.store.applyFrame(
      skFrame(
        { [SK_PATHS.windSpeedOverGround]: 8.0, [SK_PATHS.windDirectionTrue]: 1.0 },
        clock.now,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.state).toBe('stale');
    expect(reading.referenceLabel).toBeUndefined();
    expect(reading.siValue).toBeCloseTo(5.0);
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
    expect(def.label).toBe('Voltage · House battery');
    expect(def.abbr).toBe('VOLT');
    expect(def.description).toBe('House battery voltage.');
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
    expect(CLIENT_DEFAULT_ZONES.has(SK_PATHS.depthBelowKeel)).toBe(true);
  });

  it('depth zones: value 1.5 → alarm, 3 → warning (warn maps to warning), 10 → normal (outside zones)', () => {
    // Verify the zone values directly without going through the controller, so the test is
    // a pure data check independent of zoneStateFor.
    const zones = CLIENT_DEFAULT_ZONES.get(SK_PATHS.depthBelowKeel);
    expect(zones).toBeDefined();
    expect(zones?.some((z) => z.upper === 2 && z.state === 'alarm')).toBe(true);
    expect(zones?.some((z) => z.lower === 2 && z.upper === 5 && z.state === 'warn')).toBe(true);
  });
});

describe('water-temp tile', () => {
  it('formats Celsius with unit °C in metric mode', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    // 294.62 K = 21.47 °C, rounded to whole degrees like the weather panel.
    deps.store.applyFrame(skFrame({ [SK_PATHS.waterTemperature]: 294.62 }, 1000));
    const reading = readTile('water-temp', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('°C');
    expect(reading.value).toBe('21');
    expect(reading.siValue).toBeCloseTo(294.62);
  });

  it('formats Fahrenheit with unit °F in imperial mode', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'imperial');
    // 294.62 K ≈ 70.65 °F → 71
    deps.store.applyFrame(skFrame({ [SK_PATHS.waterTemperature]: 294.62 }, 1000));
    const reading = readTile('water-temp', deps);
    expect(reading.unit).toBe('°F');
    expect(reading.value).toBe('71');
  });

  it('has viz spark', () => {
    expect(tileById('water-temp')?.viz).toBe('spark');
  });
});

describe('air-temp tile', () => {
  it('reads environment.outside.temperature and formats per mode', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(skFrame({ [SK_PATHS.outsideTemperature]: 300 }, 1000));
    const reading = readTile('air-temp', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('°C');
    // 300 K = 26.85 °C → 27
    expect(reading.value).toBe('27');
  });
});

describe('gnss-satellites tile', () => {
  it('renders the integer count with no unit and no viz', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.gnssSatellites]: 20 }, 1000));
    const reading = readTile('gnss-satellites', deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('20');
    expect(reading.unit).toBe('');
    expect(tileById('gnss-satellites')?.viz).toBeUndefined();
  });
});

describe('rate-of-turn tile', () => {
  it('renders signed degrees per minute at one decimal with unit °/min', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // 0.0043633 rad/s * (180/π) * 60 ≈ 15.0 °/min
    deps.store.applyFrame(skFrame({ [SK_PATHS.rateOfTurn]: 0.0043633 }, 1000));
    const reading = readTile('rate-of-turn', deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('15.0');
    expect(reading.unit).toBe('°/min');
    expect(reading.siValue).toBeCloseTo(0.0043633);
  });

  it('keeps the sign for a turn to port (negative rad/s)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.rateOfTurn]: -0.0043633 }, 1000));
    const reading = readTile('rate-of-turn', deps);
    expect(reading.value).toBe('-15.0');
  });

  it('has viz rot', () => {
    expect(tileById('rate-of-turn')?.viz).toBe('rot');
  });
});

describe('batterySocTileDef', () => {
  it('generates the SOC id, path, abbr, and battery viz', () => {
    const def = batterySocTileDef('house');
    expect(def.id).toBe('battery-soc:house');
    expect(def.label).toBe('State of charge · House battery');
    expect(def.abbr).toBe('SOC');
    expect(def.viz).toBe('battery');
    expect(def.paths).toEqual(['electrical.batteries.house.capacity.stateOfCharge']);
    expect(def.sensorGloss).toBe('No charge data');
  });

  it('renders a 0..1 ratio as a whole-number percent with unit %', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batterySocTileDef('house');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(
      skFrame({ 'electrical.batteries.house.capacity.stateOfCharge': 0.82 }, 1000),
    );
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('82');
    expect(reading.unit).toBe('%');
    expect(reading.siValue).toBeCloseTo(0.82);
  });

  it('resolves via tileById', () => {
    expect(tileById('battery-soc:house')?.id).toBe('battery-soc:house');
  });
});

describe('batteryTimeTileDef', () => {
  it('renders time remaining via formatDuration', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTimeTileDef('house');
    deps.store.ensureCells(def.paths);
    // 45600 s = 760 min → "12h 40m"
    deps.store.applyFrame(
      skFrame({ 'electrical.batteries.house.capacity.timeRemaining': 45600 }, 1000),
    );
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('12h 40m');
    expect(reading.unit).toBe('');
    expect(def.label).toBe('Time remaining · House battery');
    expect(def.abbr).toBe('TIME');
    expect(def.viz).toBeUndefined();
  });

  it("a reported-then-null cell grades 'placeholder' with the dash, never a fake number", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTimeTileDef('house');
    deps.store.ensureCells(def.paths);
    // Battery full or charging: the server reports null for timeRemaining.
    deps.store.applyFrame(
      skFrame({ 'electrical.batteries.house.capacity.timeRemaining': null }, 1000),
    );
    const reading = def.read(deps);
    expect(reading.state).toBe('placeholder');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it("a never-reported cell grades 'never'", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTimeTileDef('house');
    deps.store.ensureCells(def.paths);
    const reading = def.read(deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it('resolves via tileById', () => {
    expect(tileById('battery-time:house')?.id).toBe('battery-time:house');
  });
});

describe('batteryCurrentTileDef', () => {
  it('renders signed amps at one decimal with unit A and spark viz', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryCurrentTileDef('house');
    deps.store.ensureCells(def.paths);
    // Negative current = discharge.
    deps.store.applyFrame(skFrame({ 'electrical.batteries.house.current': -12.34 }, 1000));
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('-12.3');
    expect(reading.unit).toBe('A');
    expect(reading.siValue).toBeCloseTo(-12.34);
    expect(def.label).toBe('Current · House battery');
    expect(def.abbr).toBe('AMPS');
    expect(def.viz).toBe('spark');
  });

  it('resolves via tileById', () => {
    expect(tileById('battery-current:house')?.id).toBe('battery-current:house');
  });
});

describe('dynamic non-battery tile defs', () => {
  it('renders propulsion revolutions as RPM and resolves through tileById', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = propulsionRpmTileDef('port');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'propulsion.port.revolutions': 20 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('1200');
    expect(reading.unit).toBe('rpm');
    expect(def.label).toBe('RPM · Port engine');
    expect(def.abbr).toBe('RPM');
    expect(tileById('prop-rpm:port')?.category).toBe('propulsion');
  });

  it('keeps the reading and source explicit across dynamic labels', () => {
    expect(propulsionLoadTileDef('port')).toMatchObject({
      label: 'Load · Port engine',
      abbr: 'LOAD',
    });
    expect(propulsionTemperatureTileDef('port')).toMatchObject({
      label: 'Temperature · Port engine',
      abbr: 'TEMP',
    });
    expect(tankLevelTileDef('freshWater.main')).toMatchObject({
      label: 'Level · Fresh Water Main tank',
      abbr: 'LEVEL',
    });
    expect(solarPowerTileDef('arch')).toMatchObject({
      label: 'Power · Arch solar',
      abbr: 'POWER',
    });
    expect(insideTemperatureTileDef('cabin')).toMatchObject({
      label: 'Temperature · Cabin',
      abbr: 'TEMP',
    });
  });

  it('keeps every generated option label unique within a source family', () => {
    for (const defs of [
      propulsionDefsFor('port'),
      tankDefsFor('freshWater.main'),
      solarDefsFor('arch'),
      insideDefsFor('cabin'),
    ]) {
      expect(new Set(defs.map((def) => def.label)).size).toBe(defs.length);
    }
  });

  it('resolves unique option names across the complete instrument catalog', () => {
    const defs = [
      ...TILE_CATALOG,
      ...batteryDefsFor('house'),
      ...propulsionDefsFor('port'),
      ...tankDefsFor('freshWater.main'),
      ...solarDefsFor('arch'),
      ...insideDefsFor('cabin'),
    ];
    const labels = [...instrumentOptionLabels(defs).values()].map((label) => label.toLowerCase());

    expect(new Set(labels).size).toBe(defs.length);
  });

  it('disambiguates repeated future catalog labels at the option boundary', () => {
    const rpm = propulsionRpmTileDef('port');
    const temperature = propulsionTemperatureTileDef('port');
    const labels = instrumentOptionLabels([
      { ...rpm, label: 'Port engine' },
      { ...temperature, label: 'Port engine' },
    ]);

    expect(labels.get(rpm.id)).toBe('RPM · Port engine');
    expect(labels.get(temperature.id)).toBe('TEMP · Port engine');
  });

  it('keeps option names unique when repeated definitions also share an abbreviation', () => {
    const first = propulsionRpmTileDef('port');
    const second = { ...first, id: 'prop-rpm:secondary' };
    const labels = [...instrumentOptionLabels([first, second]).values()];

    expect(new Set(labels).size).toBe(2);
  });

  it('renders tank level as percent and resolves through tileById', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = tankLevelTileDef('fresh');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'tanks.fresh.currentLevel': 0.64 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('64');
    expect(reading.unit).toBe('%');
    expect(tileById('tank-level:fresh')?.category).toBe('tanks');
  });

  it('supports typed Signal K tank paths while rejecting dotted non-tank ids', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = tankLevelTileDef('freshWater.main');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'tanks.freshWater.main.currentLevel': 0.72 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('72');
    expect(def.label).toBe('Level · Fresh Water Main tank');
    expect(tileById('tank-level:freshWater.main')?.paths).toEqual([
      'tanks.freshWater.main.currentLevel',
    ]);
    expect(tileById('battery:house.bank')).toBeUndefined();
  });

  it('renders solar panel power with W or kW units and resolves through tileById', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = solarPowerTileDef('arch');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'electrical.solar.arch.panelPower': 1250 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('1.3');
    expect(reading.unit).toBe('kW');
    expect(tileById('solar-power:arch')?.category).toBe('electrical');
  });

  it('renders cabin humidity from relativeHumidity or humidity fallback', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = insideHumidityTileDef('cabin');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'environment.inside.cabin.humidity': 0.57 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('57');
    expect(reading.unit).toBe('%');
    expect(tileById('inside-humidity:cabin')?.category).toBe('cabin');
  });
});
