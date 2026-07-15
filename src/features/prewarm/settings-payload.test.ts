import { describe, expect, it } from 'vitest';
import { buildConfigPayload, extractPositionWarm } from './settings-payload';

// The bare positionWarm block, matching what GET /api/position-warm/config actually returns (the
// route responds with the block directly, not a { positionWarm } wrapper).
const bareBlock = {
  enabled: true,
  radiusMeters: 3704,
  moveThresholdMeters: 1852,
  intervalSecs: 60,
  baseZoom: 12,
  sources: ['depth-noaa-enc', 'seamark'],
};

describe('extractPositionWarm', () => {
  it('parses the bare block returned by GET /api/position-warm/config', () => {
    expect(extractPositionWarm(bareBlock)).toEqual(bareBlock);
  });

  it('also parses a { positionWarm } wrapper, so either server shape loads', () => {
    expect(extractPositionWarm({ positionWarm: bareBlock })).toEqual(bareBlock);
  });

  it('returns null for a non-object', () => {
    expect(extractPositionWarm(null)).toBeNull();
    expect(extractPositionWarm('nope')).toBeNull();
  });

  it('returns null when a required field is missing or the wrong type', () => {
    const { enabled, ...noEnabled } = bareBlock;
    expect(extractPositionWarm(noEnabled)).toBeNull();
    expect(extractPositionWarm({ ...bareBlock, radiusMeters: '3704' })).toBeNull();
    expect(extractPositionWarm({ ...bareBlock, sources: 'seamark' })).toBeNull();
  });

  it('drops non-string entries from sources', () => {
    expect(extractPositionWarm({ ...bareBlock, sources: ['seamark', 3, null] })).toEqual({
      ...bareBlock,
      sources: ['seamark'],
    });
  });

  it.each([
    { radiusMeters: Number.NaN },
    { radiusMeters: Number.POSITIVE_INFINITY },
    { radiusMeters: 0 },
    { moveThresholdMeters: -1 },
    { intervalSecs: 59 },
    { intervalSecs: 60.5 },
    { baseZoom: -1 },
    { baseZoom: 22.5 },
    { baseZoom: 23 },
  ])('rejects unsafe numeric settings: %o', (override) => {
    expect(extractPositionWarm({ ...bareBlock, ...override })).toBeNull();
  });

  it('normalizes duplicate and empty source ids', () => {
    expect(
      extractPositionWarm({ ...bareBlock, sources: ['seamark', '', 'seamark', 'depth'] })?.sources,
    ).toEqual(['seamark', 'depth']);
  });
});

describe('buildConfigPayload', () => {
  it('wraps the settings so POST can merge only the positionWarm key', () => {
    expect(buildConfigPayload(bareBlock)).toEqual({ positionWarm: bareBlock });
  });
});
