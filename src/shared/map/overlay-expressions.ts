import type { ExpressionSpecification } from 'maplibre-gl';

// The neutral [0, 0] icon offset: a centered marker disc with no provided-symbol anchor to honor.
const CENTERED_OFFSET: [number, number] = [0, 0];

// The shared marker zoom scaling both symbol overlays apply through icon-size (0.6 at zoom 9 up to
// 0.9 at zoom 14). MapLibre 6 stopped scaling icon-offset by icon-size, so the offsets carry the
// same zoom interpolation themselves to keep a provided symbol's anchor pixel pinned to the
// geographic point at every zoom. The one source of the stops: both overlays build their icon-size
// from markerIconSizeExpression below, so a tuning edit cannot desynchronize sizes from offsets.
const MARKER_SCALE_STOPS: readonly (readonly [number, number])[] = [
  [9, 0.6],
  [14, 0.9],
];

// The marker icon-size expression over the shared stops. The optional perStop mapper lets a
// consumer wrap each stop's scale in its own data expression (the waypoint overlay cases on the
// iconSize property so nameless marker discs stay at 1) while the zoom stops stay shared.
export function markerIconSizeExpression(
  perStop: (scale: number) => number | ExpressionSpecification = (scale) => scale,
): ExpressionSpecification {
  const interpolate: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, scale] of MARKER_SCALE_STOPS) interpolate.push(zoom, perStop(scale));
  return interpolate as ExpressionSpecification;
}

// Per-feature icon offset as a MapLibre `match` on a feature property, wrapped in the marker zoom
// interpolation (camera expressions must wrap data expressions, not the other way around). The
// match keeps each provided symbol's offset as a real literal array in the style, and every
// centered marker falls through to CENTERED_OFFSET. The keyed property differs by overlay
// (waypoints carry 'iconImage', notes carry 'icon'), so it is a parameter. MapLibre 6 encodes
// nested GeoJSON properties across the worker, so a per-feature ['get', 'iconOffset'] is a
// possible future simplification of this match.
export function iconOffsetExpression(
  propertyKey: string,
  offsets: ReadonlyMap<string, readonly [number, number]>,
): ExpressionSpecification | [number, number] {
  if (offsets.size === 0) return CENTERED_OFFSET;
  const interpolate: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, scale] of MARKER_SCALE_STOPS) {
    const match: unknown[] = ['match', ['get', propertyKey]];
    for (const [iconId, offset] of offsets) {
      match.push(iconId, ['literal', [offset[0] * scale, offset[1] * scale]]);
    }
    match.push(['literal', CENTERED_OFFSET]);
    interpolate.push(zoom, match);
  }
  return interpolate as ExpressionSpecification;
}
