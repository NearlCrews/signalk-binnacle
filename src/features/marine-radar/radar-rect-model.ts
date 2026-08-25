import type { UnitsMode } from '$shared/lib';
import { displayRadarDistance, siRadarDistance } from './radar-area-units';
import { MAX_RADAR_DISTANCE_METERS } from './radar-limits';
import type { ControlDefinition, RadarControlEntry, RadarRectValue } from './radar-types';

const MIN_EDGE_METERS = 0.001;

export interface RadarRectDraft {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  enabled: boolean;
}

export function isNativeRectDefinition(def: ControlDefinition): boolean {
  return (
    def.dialect === 'native' &&
    def.type === 'rect' &&
    def.range?.unit === 'm' &&
    def.hasEnabled === true &&
    def.maxDistance !== undefined &&
    Number.isFinite(def.maxDistance) &&
    def.maxDistance > 0 &&
    def.maxDistance <= MAX_RADAR_DISTANCE_METERS
  );
}

export function radarRectValue(entry: RadarControlEntry | undefined): RadarRectValue | undefined {
  if (
    !entry ||
    !Number.isFinite(entry.x1) ||
    !Number.isFinite(entry.y1) ||
    !Number.isFinite(entry.x2) ||
    !Number.isFinite(entry.y2) ||
    !Number.isFinite(entry.width)
  ) {
    return undefined;
  }
  return {
    x1: entry.x1 as number,
    y1: entry.y1 as number,
    x2: entry.x2 as number,
    y2: entry.y2 as number,
    width: entry.width as number,
    enabled: entry.enabled ?? false,
  };
}

export function rectDraftFromValue(value: RadarRectValue, unitsMode: UnitsMode): RadarRectDraft {
  return {
    x1: displayRadarDistance(value.x1, unitsMode),
    y1: displayRadarDistance(value.y1, unitsMode),
    x2: displayRadarDistance(value.x2, unitsMode),
    y2: displayRadarDistance(value.y2, unitsMode),
    width: displayRadarDistance(value.width, unitsMode),
    enabled: value.enabled,
  };
}

export function rectValueFromDraft(draft: RadarRectDraft, unitsMode: UnitsMode): RadarRectValue {
  return {
    x1: siRadarDistance(draft.x1, unitsMode),
    y1: siRadarDistance(draft.y1, unitsMode),
    x2: siRadarDistance(draft.x2, unitsMode),
    y2: siRadarDistance(draft.y2, unitsMode),
    width: siRadarDistance(draft.width, unitsMode),
    enabled: draft.enabled,
  };
}

export function validateRadarRect(
  def: ControlDefinition,
  value: RadarRectValue,
): string | undefined {
  if (!isNativeRectDefinition(def)) return 'This rectangle shape is not supported for editing.';
  const numbers = [value.x1, value.y1, value.x2, value.y2, value.width];
  if (numbers.some((number) => !Number.isFinite(number)))
    return 'Every rectangle value must be a finite number.';
  const maxDistance = def.maxDistance;
  if (maxDistance === undefined) return 'The radar did not report complete rectangle bounds.';
  if ([value.x1, value.y1, value.x2, value.y2].some((number) => Math.abs(number) > maxDistance))
    return 'Every corner must stay within the radar limits.';
  if (value.width <= 0 || value.width > maxDistance)
    return 'Width must be positive and stay within the radar limits.';
  if (Math.hypot(value.x2 - value.x1, value.y2 - value.y1) < MIN_EDGE_METERS)
    return 'The two edge points must be different.';
  return undefined;
}

export function radarRectSignature(value: RadarRectValue): string {
  return [value.x1, value.y1, value.x2, value.y2, value.width, value.enabled].join('|');
}
