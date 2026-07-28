import { describe, expect, it } from 'vitest';
import { TIME_TRAVEL_MAX_ROWS, TIME_TRAVEL_PRESETS, timeTravelPreset } from './time-travel-presets';

describe('time travel presets', () => {
  it('keeps every query within the feature row budget', () => {
    for (const preset of TIME_TRAVEL_PRESETS) {
      expect(preset.maxRows).toBeLessThanOrEqual(TIME_TRAVEL_MAX_ROWS);
      expect(preset.durationSeconds / preset.resolutionSeconds).toBeLessThanOrEqual(
        TIME_TRAVEL_MAX_ROWS,
      );
    }
  });

  it('defines the exact duration and resolution contract', () => {
    expect(
      TIME_TRAVEL_PRESETS.map(({ id, durationSeconds, resolutionSeconds }) => ({
        id,
        durationSeconds,
        resolutionSeconds,
      })),
    ).toEqual([
      { id: '1h', durationSeconds: 3_600, resolutionSeconds: 5 },
      { id: '6h', durationSeconds: 21_600, resolutionSeconds: 15 },
      { id: '24h', durationSeconds: 86_400, resolutionSeconds: 60 },
      { id: '7d', durationSeconds: 604_800, resolutionSeconds: 300 },
    ]);
  });

  it('falls back to the default preset for a defensive unknown value', () => {
    expect(timeTravelPreset('not-a-range' as never).id).toBe('24h');
  });
});
