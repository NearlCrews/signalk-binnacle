import { RAD_TO_DEG, type UnitsMode } from '$shared/lib';
import { isBoundedRadarAngleRange } from './radar-angle';
import { displayRadarDistance, siRadarDistance } from './radar-area-units';
import { MAX_RADAR_DISTANCE_METERS } from './radar-limits';
import type { ControlDefinition, RadarControlEntry, RadarZoneValue } from './radar-types';

export interface RadarZoneDraft {
  startDegrees: number;
  endDegrees: number;
  innerDistance: number;
  outerDistance: number;
  enabled: boolean;
}

export function isNativeZoneDefinition(def: ControlDefinition): boolean {
  return (
    def.dialect === 'native' &&
    def.type === 'zone' &&
    isBoundedRadarAngleRange(def.range) &&
    def.hasEnabled === true &&
    def.maxDistance !== undefined &&
    Number.isFinite(def.maxDistance) &&
    def.maxDistance > 0 &&
    def.maxDistance <= MAX_RADAR_DISTANCE_METERS
  );
}

export function radarZoneValue(entry: RadarControlEntry | undefined): RadarZoneValue | undefined {
  if (
    !entry ||
    typeof entry.value !== 'number' ||
    !Number.isFinite(entry.value) ||
    !Number.isFinite(entry.endValue) ||
    !Number.isFinite(entry.startDistance) ||
    !Number.isFinite(entry.endDistance)
  ) {
    return undefined;
  }
  return {
    value: entry.value,
    endValue: entry.endValue as number,
    startDistance: entry.startDistance as number,
    endDistance: entry.endDistance as number,
    enabled: entry.enabled ?? false,
  };
}

export function zoneDraftFromValue(value: RadarZoneValue, unitsMode: UnitsMode): RadarZoneDraft {
  return {
    startDegrees: value.value * RAD_TO_DEG,
    endDegrees: value.endValue * RAD_TO_DEG,
    innerDistance: displayRadarDistance(value.startDistance, unitsMode),
    outerDistance: displayRadarDistance(value.endDistance, unitsMode),
    enabled: value.enabled,
  };
}

export function zoneValueFromDraft(draft: RadarZoneDraft, unitsMode: UnitsMode): RadarZoneValue {
  return {
    value: draft.startDegrees / RAD_TO_DEG,
    endValue: draft.endDegrees / RAD_TO_DEG,
    startDistance: siRadarDistance(draft.innerDistance, unitsMode),
    endDistance: siRadarDistance(draft.outerDistance, unitsMode),
    enabled: draft.enabled,
  };
}

export function validateRadarZone(
  def: ControlDefinition,
  value: RadarZoneValue,
): string | undefined {
  if (!isNativeZoneDefinition(def)) return 'This guard-zone shape is not supported for editing.';
  const numbers = [value.value, value.endValue, value.startDistance, value.endDistance];
  if (numbers.some((number) => !Number.isFinite(number)))
    return 'Every guard-zone value must be a finite number.';
  const range = def.range;
  const maxDistance = def.maxDistance;
  if (!range || maxDistance === undefined)
    return 'The radar did not report complete guard-zone bounds.';
  if (
    value.value < range.min ||
    value.value > range.max ||
    value.endValue < range.min ||
    value.endValue > range.max
  ) {
    return 'Start and end angles must stay within the radar limits.';
  }
  if (
    value.startDistance < 0 ||
    value.endDistance < 0 ||
    value.startDistance > maxDistance ||
    value.endDistance > maxDistance
  ) {
    return 'Inner and outer distances must stay within the radar limits.';
  }
  if (value.startDistance > value.endDistance)
    return 'Inner distance cannot be greater than outer distance.';
  return undefined;
}

export function radarZoneSignature(value: RadarZoneValue): string {
  return [value.value, value.endValue, value.startDistance, value.endDistance, value.enabled].join(
    '|',
  );
}
