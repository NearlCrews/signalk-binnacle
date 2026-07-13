// Plain-language grouping and summary of the chart sources for the offline-charts builder. The
// registry ChartSource (id, title, bounds) carries no category or parent, so this joins the covering
// sources to the webapp's augmented catalog (assembled once from the feature source modules) to group
// them under the same plain Layers-panel categories and to hide facet rows. No third vocabulary: the
// category titles come from layer-category.

import type { ChartSource } from 'signalk-chart-sources';
import { BOUNDARY_SOURCES } from '$features/boundaries-overlay';
import { STREAMING_CHART_SOURCES } from '$features/depth-charts';
import { CATEGORY_ORDER, CATEGORY_TITLES } from '$features/layers-panel';
import { MPA_SOURCES } from '$features/mpa-overlays';
import { SEAMARK_SOURCES } from '$features/seamark-overlay';
import { capitalize } from '$shared/lib';

interface SourceMeta {
  category: string;
  parent?: string;
  region?: string;
}

// One by-id catalog assembled from every augmented source module plus the base map. The depth sources
// declare no category (they draw in the bathymetry band), so they default to the charts category, the
// same fallback layer-category applies.
const SOURCE_MODULES = [STREAMING_CHART_SOURCES, MPA_SOURCES, BOUNDARY_SOURCES, SEAMARK_SOURCES];
const META: Record<string, SourceMeta> = (() => {
  const map: Record<string, SourceMeta> = {};
  for (const module of SOURCE_MODULES) {
    for (const s of module) {
      map[s.id] = { category: s.category ?? 'charts', parent: s.parent, region: s.region };
    }
  }
  map.basemap = { category: 'charts', region: 'Global' };
  return map;
})();

/** A facet is a child of another overlay (ZOC, uncertainty, Natura 2000); it is hidden from the builder. */
export function isFacet(source: { id: string }): boolean {
  return META[source.id]?.parent !== undefined;
}

// Specialist layers a typical recreational boater rarely needs: the heavy second US depth layer, the
// coarse worldwide bathymetry, the boundary lines, and the protected-area zones. They are off by
// default and grouped apart so they do not clutter the layers that cover the area.
const SPECIALIST = new Set([
  'depth-bluetopo',
  'depth-gebco',
  'bound-eez',
  'bound-12nm',
  'mpa-emodnet',
  'mpa-natura2000',
  'mpa-noaa',
]);

/** True for a specialist layer that is off by default and belongs in the Advanced bucket. */
export function isSpecialist(id: string): boolean {
  return SPECIALIST.has(id);
}

export interface SourceGroup {
  category: string;
  title: string;
  sources: ChartSource[];
}

const ADVANCED_CATEGORY = 'advanced';

/** Group the covering sources for the builder: the layers that matter under their plain Layers-panel
 * category, and the specialist layers apart under an Advanced bucket at the end. Facets are dropped. */
export function coveringGroups(covering: ChartSource[]): SourceGroup[] {
  const byCategory = new Map<string, ChartSource[]>();
  for (const source of covering) {
    if (isFacet(source)) continue;
    const category = isSpecialist(source.id)
      ? ADVANCED_CATEGORY
      : (META[source.id]?.category ?? 'charts');
    const list = byCategory.get(category) ?? [];
    list.push(source);
    byCategory.set(category, list);
  }
  const order = [...CATEGORY_ORDER, ADVANCED_CATEGORY];
  return order
    .filter((c) => byCategory.has(c))
    .map((c) => ({
      category: c,
      title: c === ADVANCED_CATEGORY ? 'Advanced layers' : (CATEGORY_TITLES[c] ?? c),
      sources: byCategory.get(c) ?? [],
    }));
}

// The plain noun each source contributes to the "what is included" sentence. Several depth sources map
// to the same noun, deliberately de-duped in the summary.
const PLAIN_NOUN: Record<string, string> = {
  'depth-noaa-enc': 'the nautical chart',
  'depth-emodnet': 'depth',
  'depth-bluetopo': 'depth',
  'depth-gebco': 'depth',
  seamark: 'navigation marks',
  basemap: 'the base map',
  'bound-eez': 'boundaries',
  'bound-12nm': 'boundaries',
  'mpa-emodnet': 'protected areas',
  'mpa-noaa': 'protected areas',
};

// A plain one-line description per non-facet source, shown as the hover and focus tooltip on each
// layer in the builder so a novice can learn what a layer is without leaving the list.
const SOURCE_DESC: Record<string, string> = {
  basemap: 'The underlying world map: land, water, coastlines, and place names.',
  'depth-noaa-enc': 'The official US nautical chart: charted depths, buoys, lights, and hazards.',
  'depth-emodnet': 'A colored seabed-depth map of European waters.',
  'depth-bluetopo': 'High-resolution US seabed-depth shading.',
  'depth-gebco': 'A coarse worldwide seabed map, useful well offshore.',
  seamark: 'Buoys, beacons, lights, and harbors, worldwide.',
  'bound-eez': "The borders between neighboring countries' waters.",
  'bound-12nm': 'The 12-nautical-mile territorial-sea line.',
  'mpa-emodnet': 'European conservation and restricted-use zones.',
  'mpa-noaa': 'US marine protected areas.',
};

/** A plain-language description of a source for a tooltip, if one is defined. */
export function sourceDescription(id: string): string | undefined {
  return SOURCE_DESC[id];
}

function joinPlain(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** A plain sentence describing the selected sources, for example "The nautical chart, depth, and the
 * base map." Facets are ignored; nouns are de-duped in source order. */
export function includedSummary(selected: ChartSource[]): string {
  const nouns: string[] = [];
  for (const source of selected) {
    if (isFacet(source)) continue;
    const noun = PLAIN_NOUN[source.id];
    if (noun !== undefined && !nouns.includes(noun)) nouns.push(noun);
  }
  if (nouns.length === 0) return 'No charts selected for this area.';
  return `${capitalize(joinPlain(nouns))}.`;
}
