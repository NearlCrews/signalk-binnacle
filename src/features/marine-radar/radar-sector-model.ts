import { RAD_TO_DEG } from '$shared/lib';
import { isBoundedRadarAngleRange } from './radar-angle';
import type { ControlDefinition, RadarControlEntry, RadarSectorValue } from './radar-types';

export interface RadarSectorDraft {
  startDegrees: number;
  endDegrees: number;
  enabled: boolean;
}

export function isNativeSectorDefinition(def: ControlDefinition): boolean {
  return (
    def.dialect === 'native' &&
    def.type === 'sector' &&
    isBoundedRadarAngleRange(def.range) &&
    def.hasEnabled === true
  );
}

export function radarSectorValue(
  entry: RadarControlEntry | undefined,
): RadarSectorValue | undefined {
  if (
    !entry ||
    typeof entry.value !== 'number' ||
    !Number.isFinite(entry.value) ||
    !Number.isFinite(entry.endValue)
  ) {
    return undefined;
  }
  return {
    value: entry.value,
    endValue: entry.endValue as number,
    enabled: entry.enabled ?? false,
  };
}

export function sectorDraftFromValue(value: RadarSectorValue): RadarSectorDraft {
  return {
    startDegrees: value.value * RAD_TO_DEG,
    endDegrees: value.endValue * RAD_TO_DEG,
    enabled: value.enabled,
  };
}

export function sectorValueFromDraft(draft: RadarSectorDraft): RadarSectorValue {
  return {
    value: draft.startDegrees / RAD_TO_DEG,
    endValue: draft.endDegrees / RAD_TO_DEG,
    enabled: draft.enabled,
  };
}

export function validateRadarSector(
  def: ControlDefinition,
  value: RadarSectorValue,
): string | undefined {
  if (!isNativeSectorDefinition(def)) return 'This sector shape is not supported for editing.';
  if (!Number.isFinite(value.value) || !Number.isFinite(value.endValue))
    return 'Both sector angles must be finite numbers.';
  const range = def.range;
  if (!range) return 'The radar did not report complete sector bounds.';
  if (
    value.value < range.min ||
    value.value > range.max ||
    value.endValue < range.min ||
    value.endValue > range.max
  ) {
    return 'Start and end angles must stay within the radar limits.';
  }
  return undefined;
}

export function radarSectorSignature(value: RadarSectorValue): string {
  return [value.value, value.endValue, value.enabled].join('|');
}
