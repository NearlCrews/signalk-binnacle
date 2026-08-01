import type { TimeBracket, WeatherGrid } from '$entities/weather';
import { lerp, lerpAngle } from '$shared/lib';
import { emptyFeatureCollection } from '$shared/map';
import { cellArrowFeatures } from './arrow-features';

const STRIDE = 2; // draw every other cell in each axis so the field is not littered with arrows
const ARROW_FRACTION = 0.5;

// One arrow per strided grid cell pointing the way the waves travel (the reverse of the
// meteorological from-direction); the wave field already colors by height, so the arrows carry no
// properties. Direction is blended around the compass (lerpAngle, never a plain lerp: a linear
// blend from 350 to 10 degrees sweeps through 180 and points the arrow backwards), and cells
// missing direction or height are skipped. Empty when the grid carries no wave direction or height.
export function waveArrowFeatures(
  grid: WeatherGrid,
  bracket: TimeBracket,
): GeoJSON.FeatureCollection {
  const dir = grid.waveDirection;
  const height = grid.waveHeight;
  if (!dir || !height) return emptyFeatureCollection();
  const d0 = dir[bracket.lo] ?? [];
  const d1 = dir[bracket.hi] ?? d0;
  const h0 = height[bracket.lo] ?? [];
  const h1 = height[bracket.hi] ?? h0;
  return cellArrowFeatures(grid, STRIDE, ARROW_FRACTION, (i) => {
    const direction = lerpAngle(d0[i], d1[i], bracket.frac);
    const waveHeight = lerp(h0[i], h1[i], bracket.frac);
    if (Number.isNaN(direction) || Number.isNaN(waveHeight)) return undefined;
    // Travel vector: the reverse of the from-direction, the same convention as the wind arrows.
    return { u: -Math.sin(direction), v: -Math.cos(direction), props: {} };
  });
}
