import { DARK_SCRIM, type Rgba, rasterIconColored } from '$shared/map';

// Distinct from the AIS source id ('binnacle-ais'): this is the map image id.
export const AIS_ICON_ID = 'binnacle-ais-icon';
const SIZE = 28;
// The triangle half-width at row y is y / this divisor, which sets the apex angle: a larger divisor
// draws a narrower, taller-looking triangle.
const HALF_WIDTH_DIVISOR = 2.6;
// A dark halo just outside the colored stroke, so the thin hollow triangle holds on same-luminance day
// water. The shared DARK_SCRIM, as the route line and selection ring use: it lifts the marker on the
// light chart and is invisible on the dark dusk and night-red maps, where the stroke carries on its own.
const HALO = DARK_SCRIM;

// A hollow triangle for AIS targets, distinct from the filled own-vessel icon, colored per theme with
// a dark halo for contrast.
export function aisIconImage(color: Rgba): ImageData {
  return rasterIconColored(SIZE, (x, y, center) => {
    const halfWidth = y / HALF_WIDTH_DIVISOR;
    const dx = Math.abs(x - center);
    const onSide = y > 3 && Math.abs(dx - halfWidth) <= 1.4 && dx <= halfWidth + 1.4;
    const onBase = y >= SIZE - 3 && dx <= halfWidth;
    if (onSide || onBase) return color;
    // One pixel wider on each edge of the stroke: the halo band.
    const onSideHalo = y > 2 && Math.abs(dx - halfWidth) <= 2.4 && dx <= halfWidth + 2.4;
    const onBaseHalo = y >= SIZE - 4 && dx <= halfWidth + 1;
    return onSideHalo || onBaseHalo ? HALO : null;
  });
}

// Map image ids for the non-vessel AIS kinds, distinct from the source and vessel-icon ids.
export const ATON_ICON_ID = 'binnacle-ais-aton-icon';
export const ATON_VIRTUAL_ICON_ID = 'binnacle-ais-aton-virtual-icon';
export const SAR_ICON_ID = 'binnacle-ais-sar-icon';

// The diamond's Manhattan radius in pixels: small on purpose, a mark on the chart rather than a
// moving contact.
const DIAMOND_RADIUS = 8;

// A small filled diamond for a physical navigation aid (AIS message 21).
export function atonIconImage(color: Rgba): ImageData {
  return rasterIconColored(SIZE, (x, y, center) => {
    const d = Math.abs(x - center) + Math.abs(y - center);
    if (d <= DIAMOND_RADIUS) return color;
    return d <= DIAMOND_RADIUS + 1.5 ? HALO : null;
  });
}

// The hollow variant for a virtual aid: broadcast only, nothing physically on the water.
export function atonVirtualIconImage(color: Rgba): ImageData {
  return rasterIconColored(SIZE, (x, y, center) => {
    const d = Math.abs(x - center) + Math.abs(y - center);
    if (Math.abs(d - DIAMOND_RADIUS) <= 1.4) return color;
    return Math.abs(d - DIAMOND_RADIUS) <= 2.4 ? HALO : null;
  });
}

// The cross half-length and half-thickness for the SAR marker below.
const CROSS_ARM = 10;
const CROSS_BAR = 2;

// A bold cross for a search-and-rescue aircraft, unmistakable for a vessel triangle or an aid.
export function sarIconImage(color: Rgba): ImageData {
  return rasterIconColored(SIZE, (x, y, center) => {
    const dx = Math.abs(x - center);
    const dy = Math.abs(y - center);
    const onBars = (dx <= CROSS_BAR && dy <= CROSS_ARM) || (dy <= CROSS_BAR && dx <= CROSS_ARM);
    if (onBars) return color;
    const onHalo =
      (dx <= CROSS_BAR + 1 && dy <= CROSS_ARM + 1) || (dy <= CROSS_BAR + 1 && dx <= CROSS_ARM + 1);
    return onHalo ? HALO : null;
  });
}
