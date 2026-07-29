import type { ControlDefinition } from './radar-types';

export const FULL_CIRCLE_RADIANS = Math.PI * 2;
const ANGLE_EPSILON = 1e-9;

type RadarAngleRange = NonNullable<ControlDefinition['range']>;

// Native radar-area angles may use either -pi..pi or 0..2pi, but they must describe no more than
// one revolution. Keeping the absolute domain bounded also prevents a malformed provider from
// sending numerically unstable angles into chart geometry.
export function isBoundedRadarAngleRange(
  range: ControlDefinition['range'],
): range is RadarAngleRange {
  return (
    range?.unit === 'rad' &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.min <= range.max &&
    range.min >= -FULL_CIRCLE_RADIANS - ANGLE_EPSILON &&
    range.max <= FULL_CIRCLE_RADIANS + ANGLE_EPSILON &&
    range.max - range.min <= FULL_CIRCLE_RADIANS + ANGLE_EPSILON
  );
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

// Map a bearing into the provider's declared interval in constant time. If a narrow provider range
// does not contain an equivalent angle, use the nearest angular boundary.
export function radarAngleInRange(angle: number, range: ControlDefinition['range']): number {
  if (!Number.isFinite(angle) || !isBoundedRadarAngleRange(range)) return angle;
  const normalized = range.min + positiveModulo(angle - range.min, FULL_CIRCLE_RADIANS);
  if (normalized <= range.max + ANGLE_EPSILON) {
    return Math.min(range.max, normalized);
  }
  const distanceToMax = normalized - range.max;
  const distanceToMin = range.min + FULL_CIRCLE_RADIANS - normalized;
  return distanceToMax <= distanceToMin ? range.max : range.min;
}

// A zero angular difference means a full radar circle. Every other span is normalized to one
// clockwise revolution, which gives tessellation a fixed upper bound.
export function clockwiseRadarSpan(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const raw = end - start;
  if (Math.abs(raw) < 0.001) return FULL_CIRCLE_RADIANS;
  const normalized = positiveModulo(raw, FULL_CIRCLE_RADIANS);
  return normalized < 0.001 ? FULL_CIRCLE_RADIANS : normalized;
}
