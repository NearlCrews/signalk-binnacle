import { HISTORY_RESOLUTION_SECONDS, HISTORY_WINDOW_SECONDS } from '$shared/signalk';

export type TimeTravelRangeId = '1h' | '6h' | '24h' | '7d';
export type TimeTravelSpeed = 0.5 | 1 | 2;

export interface TimeTravelPreset {
  id: TimeTravelRangeId;
  label: string;
  name: string;
  durationSeconds: number;
  resolutionSeconds: number;
  coarseStepSeconds: number;
  maxRows: number;
}

export const TIME_TRAVEL_MAX_ROWS = 2_048;

function preset(
  id: TimeTravelRangeId,
  label: string,
  name: string,
  durationSeconds: number,
  resolutionSeconds: number,
  coarseStepSeconds: number,
): TimeTravelPreset {
  return {
    id,
    label,
    name,
    durationSeconds,
    resolutionSeconds,
    coarseStepSeconds,
    maxRows: Math.ceil(durationSeconds / resolutionSeconds) + 2,
  };
}

const DEFAULT_PRESET = preset(
  '24h',
  '24 h',
  '24 hours',
  HISTORY_WINDOW_SECONDS,
  HISTORY_RESOLUTION_SECONDS,
  15 * 60,
);

export const TIME_TRAVEL_PRESETS: readonly TimeTravelPreset[] = [
  preset('1h', '1 h', '1 hour', 60 * 60, 5, 60),
  preset('6h', '6 h', '6 hours', 6 * 60 * 60, 15, 5 * 60),
  DEFAULT_PRESET,
  preset('7d', '7 d', '7 days', 7 * 24 * 60 * 60, 5 * 60, 60 * 60),
] as const;

export const DEFAULT_TIME_TRAVEL_RANGE: TimeTravelRangeId = '24h';
export const TIME_TRAVEL_SPEEDS: readonly TimeTravelSpeed[] = [0.5, 1, 2] as const;

// Plain-language playback speeds, so the visible control says what it does rather than asking the
// navigator to read a multiplier at the helm. The rate stays in the accessible name, spelled out
// per speed because "1 times real time" is not a sentence.
const SPEED_TEXT: Readonly<Record<TimeTravelSpeed, { label: string; description: string }>> = {
  0.5: { label: 'Slow', description: 'Slow playback, 0.5 times real time' },
  1: { label: 'Normal', description: 'Normal playback, real time' },
  2: { label: 'Fast', description: 'Fast playback, 2 times real time' },
};

export function timeTravelSpeedLabel(speed: TimeTravelSpeed): string {
  return SPEED_TEXT[speed].label;
}

export function timeTravelSpeedDescription(speed: TimeTravelSpeed): string {
  return SPEED_TEXT[speed].description;
}

export function timeTravelPreset(id: TimeTravelRangeId): TimeTravelPreset {
  return TIME_TRAVEL_PRESETS.find((candidate) => candidate.id === id) ?? DEFAULT_PRESET;
}
