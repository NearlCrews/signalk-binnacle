import { describe, expect, it } from 'vitest';
import { SK_PATHS } from '$shared/signalk';
import {
  insideHumidityTileDef,
  propulsionDefsFor,
  solarDefsFor,
  TILE_CATALOG,
  tileById,
  trendDescriptorFor,
} from './tile-catalog';

function descriptor(id: string) {
  const tile = tileById(id);
  if (!tile) throw new Error(`Missing tile ${id}`);
  const trend = trendDescriptorFor(tile);
  if (!trend) throw new Error(`Tile ${id} is not trendable`);
  return trend;
}

describe('instrument trend descriptors', () => {
  it('marks only the designed static readings as trendable', () => {
    expect(TILE_CATALOG.filter((tile) => tile.trend).map((tile) => tile.id)).toEqual([
      'sog',
      'depth',
      'wind-apparent',
      'stw',
      'wind-true',
      'pressure',
      'water-temp',
      'air-temp',
      'gnss-satellites',
      'rate-of-turn',
    ]);
    expect(
      ['heading', 'position', 'course', 'course-vmg', 'course-xte'].every(
        (id) => tileById(id)?.trend === undefined,
      ),
    ).toBe(true);
  });

  it('uses transducer, surface, and keel priority for depth history', () => {
    const depth = descriptor('depth');
    expect(depth.candidates.map((candidate) => candidate.path)).toEqual([
      SK_PATHS.depthBelowTransducer,
      SK_PATHS.depthBelowSurface,
      SK_PATHS.depthBelowKeel,
    ]);
    expect(depth.description).toContain('preferring below-transducer');
  });

  it('uses max for wind, last for GNSS count, and average otherwise', () => {
    expect(descriptor('wind-apparent').aggregate).toBe('max');
    expect(descriptor('wind-true').aggregate).toBe('max');
    expect(descriptor('gnss-satellites').aggregate).toBe('last');
    expect(descriptor('depth').aggregate).toBe('average');
  });

  it('declares ordered fallbacks for apparent wind and cabin humidity', () => {
    const apparentWind = descriptor('wind-apparent');
    expect(apparentWind.candidates.map((candidate) => candidate.path)).toEqual([
      SK_PATHS.windSpeedApparent,
      SK_PATHS.windSpeedOverGround,
    ]);
    expect(apparentWind.description).toContain('falling back to ground wind');
    expect(
      trendDescriptorFor(insideHumidityTileDef('salon'))?.candidates.map(
        (candidate) => candidate.path,
      ),
    ).toEqual(['environment.inside.salon.relativeHumidity', 'environment.inside.salon.humidity']);
  });

  it('includes dynamic engine readings and excludes cumulative solar yield', () => {
    expect(propulsionDefsFor('port').every((tile) => tile.trend !== undefined)).toBe(true);
    const solar = solarDefsFor('house');
    expect(solar.find((tile) => tile.id === 'solar-power:house')?.trend).toBeDefined();
    expect(solar.find((tile) => tile.id === 'solar-current:house')?.trend).toBeDefined();
    expect(solar.find((tile) => tile.id === 'solar-yield:house')?.trend).toBeUndefined();
  });
});
