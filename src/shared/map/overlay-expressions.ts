import type { ExpressionSpecification } from 'maplibre-gl';

// The neutral [0, 0] icon offset: a centered marker disc with no provided-symbol anchor to honor.
const CENTERED_OFFSET: [number, number] = [0, 0];

// Per-feature icon offset as a MapLibre `match` on a feature property. MapLibre stringifies an
// array-valued GeoJSON property crossing to the worker, so a per-symbol anchor offset cannot ride on
// the feature as ['get', 'iconOffset']; the match keeps each provided symbol's offset as a real literal
// array in the style, and every centered marker falls through to CENTERED_OFFSET. The keyed property
// differs by overlay (waypoints carry 'iconImage', notes carry 'icon'), so it is a parameter.
export function iconOffsetExpression(
  propertyKey: string,
  offsets: ReadonlyMap<string, readonly [number, number]>,
): ExpressionSpecification | [number, number] {
  if (offsets.size === 0) return CENTERED_OFFSET;
  const match: unknown[] = ['match', ['get', propertyKey]];
  for (const [iconId, offset] of offsets) match.push(iconId, ['literal', offset]);
  match.push(['literal', CENTERED_OFFSET]);
  return match as ExpressionSpecification;
}
