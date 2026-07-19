import type { Map as MapLibreMap } from 'maplibre-gl';
import { decodeSvgToImageData, type MapThemePaint, setMapImage } from '$shared/map';
import { POI_CATEGORIES, type PoiCategory, poiIconId } from './poi-categories';

// Per-category glyphs. Most are Lucide glyphs (anchor, sailboat, triangle-alert, fuel,
// wrench, landmark, map-pin) per the spec's chosen app icon family; navaid is a custom
// beacon (a diamond daymark on a post) in the same 24x24 / 2px stroke weight, the spec's
// sanctioned "one-off custom SVG". Authentic S-52 buoy and light symbols replace navaid
// when the chart-symbol atlas lands.
const GLYPHS: Record<PoiCategory, string> = {
  anchorage:
    '<path d="M12 6v16"/><path d="m19 13 2-1a9 9 0 0 1-18 0l2 1"/><path d="M9 11h6"/><circle cx="12" cy="4" r="2"/>',
  marina:
    '<path d="M10 2v15"/><path d="M7 22a4 4 0 0 1-4-4 1 1 0 0 1 1-1h16a1 1 0 0 1 1 1 4 4 0 0 1-4 4z"/><path d="M9.159 2.46a1 1 0 0 1 1.521-.193l9.977 8.98A1 1 0 0 1 20 13H4a1 1 0 0 1-.824-1.567z"/>',
  fuel: '<line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  services:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  inlet:
    '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  ramp: '<path d="M6 4 14 13"/><path d="M10 4 18 13"/><path d="M3 19c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1"/>',
  bridge:
    '<path d="M4 20V7"/><path d="M20 20V7"/><path d="M4 7c4 8 12 8 16 0"/><path d="M3 14h18"/><path d="M9 14v-2.3"/><path d="M15 14v-2.3"/>',
  hazard:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  navaid: '<path d="M12 2 16 7 12 12 8 7Z"/><path d="M12 12v9"/><path d="M8 21h8"/>',
  structure:
    '<path d="M10 18v-7"/><path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/>',
  generic:
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
};

// A hazard reads as danger, a navaid as a caution, everything else as the standard POI accent.
// Shared so the canvas marker and the inline HTML icon classify a category the same way.
type FillRole = 'danger' | 'warning' | 'default';
function fillRole(category: PoiCategory): FillRole {
  if (category === 'hazard') return 'danger';
  if (category === 'navaid') return 'warning';
  return 'default';
}

function fillColor(category: PoiCategory, paint: MapThemePaint): string {
  return { danger: paint.danger, warning: paint.warning, default: paint.note }[fillRole(category)];
}

function markerSvg(category: PoiCategory, paint: MapThemePaint): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">',
    `<circle cx="15" cy="15" r="14" fill="${fillColor(category, paint)}"/>`,
    `<g transform="translate(3,3)" fill="none" stroke="${paint.markerGlyph}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`,
    GLYPHS[category],
    '</g></svg>',
  ].join('');
}

// Inline SVG for HTML UI contexts (dialogs, pickers, the POI search list). Uses CSS variables so the
// icon adapts to the theme without canvas rasterization, so the string depends only on the category.
// Cached once per category: the POI search rebuilds its list on every filter keystroke.
const inlineIconCache = new Map<PoiCategory, string>();
export function poiInlineIconSvg(category: PoiCategory): string {
  const cached = inlineIconCache.get(category);
  if (cached !== undefined) return cached;
  const fill = { danger: 'var(--alarm)', warning: 'var(--warning)', default: 'var(--accent)' }[
    fillRole(category)
  ];
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 30 30" aria-hidden="true">',
    `<circle cx="15" cy="15" r="14" fill="${fill}"/>`,
    '<g transform="translate(3,3)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    GLYPHS[category],
    '</g></svg>',
  ].join('');
  inlineIconCache.set(category, svg);
  return svg;
}

const ICON_PX = 60;

// Rasterize the marker SVG to a fixed 60x60 bitmap. Browser only: the node test environment has no
// document, so decodeSvgToImageData returns null and the icon is simply not registered there (the
// source and layer still install).
export async function rasterizeSvg(svg: string): Promise<ImageData | null> {
  return decodeSvgToImageData(svg, (img, ctx) => {
    const { canvas } = ctx;
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    ctx.drawImage(img, 0, 0, ICON_PX, ICON_PX);
    return ctx.getImageData(0, 0, ICON_PX, ICON_PX);
  });
}

// The note and navaid glyphs are rasterized at 2x for retina crispness, so they register with a
// pixelRatio of 2 (the shared setMapImage defaults to 1). Shared with the navaid symbols.
export const ICON_PIXEL_RATIO = 2;

// Register (or recolor, on a theme change) the marker icon for every category. Never
// throws: an icon that fails to rasterize is skipped so it cannot break overlay setup.
export async function registerPoiIcons(
  map: MapLibreMap,
  paint: MapThemePaint,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await Promise.all(
    POI_CATEGORIES.map(async (category) => {
      const image = await rasterizeSvg(markerSvg(category, paint));
      if (!image || !isCurrent()) return;
      setMapImage(map, poiIconId(category), image, ICON_PIXEL_RATIO);
    }),
  );
}
