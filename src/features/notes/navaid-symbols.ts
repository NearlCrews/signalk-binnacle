import type { Map as MapLibreMap } from 'maplibre-gl';
import { ICON_PIXEL_RATIO, poiIconId, rasterizeSvg } from '$entities/poi-icons';
import { type MapThemePaint, setMapImage } from '$shared/map';

type NavaidKind = 'lighthouse' | 'light' | 'buoy' | 'daybeacon' | 'generic';
type NavaidSide = 'port' | 'starboard' | 'none';

export interface NavaidClass {
  kind: NavaidKind;
  side: NavaidSide;
}

const RE_AID_NUM = /(\d+)[a-z]?\b/;
const RE_LIGHTHOUSE = /lighthouse/;
const RE_DAYBEACON = /daybeacon/;
const RE_BUOY = /buoy/;
const RE_LIGHT = /\blight\b|pierhead|breakwater/;

// Crow's Nest tags every light, beacon, and buoy with the same skIcon
// (navigation-structure), so the specific kind is inferred from the note name and the
// lateral side from the aid's number using the US IALA-B convention (even = red, starboard
// hand; odd = green, port hand). Full S-52 symbology keyed off S-57 ENC attributes
// (BOYSHP, COLOUR, CATLAM) is a later spec; notes carry no such attributes.
export function navaidClassify(name: string): NavaidClass {
  const n = name.toLowerCase();
  // Aid numbers may carry a letter suffix ("Buoy 2A"); the digits alone decide the side.
  const num = n.match(RE_AID_NUM);
  const side: NavaidSide = num ? (Number(num[1]) % 2 === 0 ? 'starboard' : 'port') : 'none';
  if (RE_LIGHTHOUSE.test(n)) return { kind: 'lighthouse', side: 'none' };
  if (RE_DAYBEACON.test(n)) return { kind: 'daybeacon', side };
  // A "lighted buoy" is a buoy, so buoy is matched before the light keyword.
  if (RE_BUOY.test(n)) return { kind: 'buoy', side };
  if (RE_LIGHT.test(n)) {
    return { kind: 'light', side: 'none' };
  }
  return { kind: 'generic', side: 'none' };
}

// The map-image id for a classification. A generic navaid reuses the existing poi-navaid
// disc; every other kind has its own registered symbol.
export function navaidIconId({ kind, side }: NavaidClass): string {
  switch (kind) {
    case 'generic':
      return poiIconId('navaid');
    case 'lighthouse':
      return 'binnacle-navaid-lighthouse';
    case 'light':
      return 'binnacle-navaid-light';
    default:
      return `binnacle-navaid-${kind}-${side}`;
  }
}

const NAVAID_VARIANTS: readonly NavaidClass[] = [
  { kind: 'light', side: 'none' },
  { kind: 'lighthouse', side: 'none' },
  { kind: 'buoy', side: 'starboard' },
  { kind: 'buoy', side: 'port' },
  { kind: 'buoy', side: 'none' },
  { kind: 'daybeacon', side: 'starboard' },
  { kind: 'daybeacon', side: 'port' },
  { kind: 'daybeacon', side: 'none' },
];

function sideFill(side: NavaidSide, paint: MapThemePaint): string {
  if (side === 'starboard') return paint.navStarboard;
  if (side === 'port') return paint.navPort;
  return paint.note;
}

// The inner shapes for a navaid, in a 30x30 viewBox with a ground line near y=24. Lateral
// side is carried by shape (cone vs cylinder, triangle vs square) so it survives night-red,
// where the green and red collapse to two red shades.
function shape(cls: NavaidClass, paint: MapThemePaint): string {
  const fill = sideFill(cls.side, paint);
  switch (cls.kind) {
    case 'light':
      return [
        `<circle cx="9" cy="23" r="2.2" fill="${paint.navLight}"/>`,
        `<path d="M9 23 C 9 14 14 9 23 7 C 16 12 13 16 12 23 Z" fill="${paint.navLight}"/>`,
      ].join('');
    case 'lighthouse':
      return [
        `<path d="M11 26 L12.5 13 L17.5 13 L19 26 Z" fill="${paint.note}"/>`,
        `<rect x="12.5" y="8" width="5" height="5" fill="${paint.navLight}"/>`,
        `<path d="M15 8 L15 4 M12 7 L8 5 M18 7 L22 5" stroke="${paint.navLight}"/>`,
      ].join('');
    case 'buoy':
      if (cls.side === 'starboard') {
        return `<path d="M15 9 L20 22 L10 22 Z" fill="${fill}"/><line x1="15" y1="22" x2="15" y2="26"/>`;
      }
      if (cls.side === 'port') {
        return `<rect x="10" y="10" width="10" height="12" rx="1" fill="${fill}"/><line x1="15" y1="22" x2="15" y2="26"/>`;
      }
      return `<circle cx="15" cy="15" r="7" fill="${fill}"/><line x1="15" y1="22" x2="15" y2="26"/>`;
    default:
      // Daybeacon: a green square daymark to port, a red triangle to starboard, both on a post.
      if (cls.side === 'port') {
        return `<line x1="15" y1="26" x2="15" y2="15"/><rect x="9.5" y="5" width="11" height="10" fill="${fill}"/>`;
      }
      return `<line x1="15" y1="26" x2="15" y2="14"/><path d="M15 4 L21 14 L9 14 Z" fill="${fill}"/>`;
  }
}

function navaidSvg(cls: NavaidClass, paint: MapThemePaint): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none" ',
    `stroke="${paint.markerGlyph}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">`,
    shape(cls, paint),
    '</svg>',
  ].join('');
}

// Register (or recolor) every navaid symbol. Never throws: a symbol that fails to rasterize
// is skipped, leaving the generic navaid disc as the fallback.
export async function registerNavaidIcons(
  map: MapLibreMap,
  paint: MapThemePaint,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await Promise.all(
    NAVAID_VARIANTS.map(async (cls) => {
      const image = await rasterizeSvg(navaidSvg(cls, paint));
      if (!image || !isCurrent()) return;
      setMapImage(map, navaidIconId(cls), image, ICON_PIXEL_RATIO);
    }),
  );
}
