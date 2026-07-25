import { createRasterOverlay, type OverlayModule, type RasterOverlaySource } from '$shared/map';
import { gibsDate } from './gibs-date';

// NASA GIBS daily global ocean fields. Sea-surface temperature reveals current boundaries (the Gulf
// Stream, eddies, and upwelling); sea ice concentration is go/no-go for high-latitude cruising. Both
// are GHRSST L4 MUR, multicolor rasters that dim but do not recolor at night, so they default hidden
// and are best left off at night. They are independent toggles (sea ice matters without SST in polar
// waters). The product is published at native zoom 7; MapLibre overzooms above that.
const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const gibsTiles = (layer: string, date: string): string =>
  `${GIBS_WMTS}/${layer}/default/${date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;

const GIBS_ATTRIBUTION = 'NASA EOSDIS GIBS; GHRSST L4 MUR (JPL PO.DAAC)';
const GIBS_DEFAULT_OPACITY = 0.7;

// Built as a function so the date is resolved at construction time, not at module load.
export function buildOceanSources(): RasterOverlaySource[] {
  const date = gibsDate();
  const datedDescription = (summary: string): string =>
    `${summary} NASA imagery date: ${date}. Reload after the UTC date changes to refresh it.`;
  return [
    {
      id: 'gibs-sst',
      title: 'Sea-surface temperature',
      description: datedDescription('A satellite color map of how warm the sea surface is.'),
      tiles: [gibsTiles('GHRSST_L4_MUR_Sea_Surface_Temperature', date)],
      minzoom: 0,
      maxzoom: 7,
      // A background field, so it defaults translucent and the chart reads through it.
      defaultOpacity: GIBS_DEFAULT_OPACITY,
      attribution: GIBS_ATTRIBUTION,
    },
    {
      id: 'gibs-sea-ice',
      title: 'Sea ice concentration',
      description: datedDescription('How much of the sea surface is covered by ice.'),
      tiles: [gibsTiles('GHRSST_L4_MUR_Sea_Ice_Concentration', date)],
      minzoom: 0,
      maxzoom: 7,
      defaultOpacity: GIBS_DEFAULT_OPACITY,
      attribution: GIBS_ATTRIBUTION,
    },
  ];
}

// The ocean fields draw in the weather band (a background layer under the live overlays); the band
// lives in the slice so the composing widget does not hardcode it.
export function createOceanOverlay(source: RasterOverlaySource): OverlayModule {
  return createRasterOverlay(source, 'weather');
}
