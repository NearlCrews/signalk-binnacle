import type { Theme } from '$shared/ui';
import { type Rgba, themedRamp, tupleCss } from './color-ramp';

// Speed stops in m/s. Day and dusk use a marine wind ramp: teal, green, yellow, orange, red.
const DAY: Array<[number, Rgba]> = [
  [0, [0.16, 0.66, 0.79, 0.0]],
  [3, [0.16, 0.66, 0.79, 0.9]],
  [7, [0.22, 0.77, 0.41, 0.9]],
  [12, [0.9, 0.85, 0.23, 0.9]],
  [18, [0.94, 0.54, 0.23, 0.95]],
  [26, [0.88, 0.28, 0.23, 1.0]],
];
// Night-red: a deep red band on black, brightness rising with speed, no blue and minimal green so
// the hue stays pure red and the brightest pixel stays low to protect dark adaptation.
const NIGHT: Array<[number, Rgba]> = [
  [0, [0.3, 0.04, 0, 0.0]],
  [7, [0.5, 0.06, 0, 0.85]],
  [18, [0.68, 0.09, 0, 0.95]],
  [26, [0.85, 0.13, 0, 1.0]],
];

const EXPR_SPEEDS = [0, 3, 7, 12, 18, 26];

const windColorExpressionCache = new Map<Theme, unknown[]>();

// A MapLibre interpolate expression that colors a feature by its numeric `speed` property (m/s) for
// the theme. Returned as a plain nested array so this module stays free of MapLibre types; the
// overlay casts it to ExpressionSpecification.
export function windColorExpression(theme: Theme): unknown[] {
  const cached = windColorExpressionCache.get(theme);
  if (cached) return cached;
  const stops = EXPR_SPEEDS.flatMap((s) => [s, tupleCss(windColor(s, theme))]);
  const expr: unknown[] = ['interpolate', ['linear'], ['get', 'speed'], ...stops];
  windColorExpressionCache.set(theme, expr);
  return expr;
}

export const windColor = themedRamp(DAY, NIGHT);
