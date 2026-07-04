// Crow's Nest explicit POI type, from the Signal K notes resource.
export type PoiType =
  | 'Marina'
  | 'Anchorage'
  | 'Hazard'
  | 'Business'
  | 'BoatRamp'
  | 'Bridge'
  | 'Dam'
  | 'Ferry'
  | 'Inlet'
  | 'Lock'
  | 'LocalKnowledge'
  | 'Navigational'
  | 'Airport'
  | 'Unknown';

// Crow's Nest (and other notes providers) tag each note with a Freeboard `skIcon`.
// Binnacle groups them into a handful of marker categories, each with its own glyph and
// themed color. A category is the single source for both.
export type PoiCategory =
  | 'anchorage'
  | 'marina'
  | 'fuel'
  | 'services'
  | 'inlet'
  | 'ramp'
  | 'bridge'
  | 'hazard'
  | 'navaid'
  | 'structure'
  | 'generic';

// Exact skIcon to category for the canonical Freeboard / Crow's Nest vocabulary.
const SKICON_CATEGORY: Record<string, PoiCategory> = {
  anchorage: 'anchorage',
  anchor_berth: 'anchorage',
  mooring: 'anchorage',
  marina: 'marina',
  harbour: 'marina',
  yacht_club: 'marina',
  fuel: 'fuel',
  fuel_station: 'fuel',
  water: 'services',
  water_tap: 'services',
  pumpout: 'services',
  provisions: 'services',
  electricity: 'services',
  repairs: 'services',
  chandler: 'services',
  business: 'services',
  inlet: 'inlet',
  hazard: 'hazard',
  obstruction: 'hazard',
  rock: 'hazard',
  wreck: 'hazard',
  beacon_isolated_danger: 'hazard',
  buoy_isolated_danger: 'hazard',
  // Crow's Nest tags lights, daybeacons, pierhead lights, and channel buoys as
  // navigation-structure; they are navaids.
  'navigation-structure': 'navaid',
  beacon_cardinal: 'navaid',
  beacon_lateral: 'navaid',
  beacon_safe_water: 'navaid',
  beacon_special_purpose: 'navaid',
  buoy_cardinal: 'navaid',
  buoy_lateral: 'navaid',
  buoy_safe_water: 'navaid',
  buoy_special_purpose: 'navaid',
  light_float: 'navaid',
  light_major: 'navaid',
  light_minor: 'navaid',
  light_vessel: 'navaid',
  bridge: 'bridge',
  boatramp: 'ramp',
  dam: 'structure',
  lock: 'structure',
  lock_basin: 'structure',
  ferry: 'structure',
};

// Ordered keyword fallback for skIcons not in the exact table. Providers use many naming
// variants (active_captain prefixes, plurals, hyphen vs underscore), so a substring match
// keeps an unfamiliar variant in the right bucket instead of dropping it to a plain pin.
// Order matters: navaid (buoy, beacon, light) is checked before the services 'water' so a
// "safe_water" mark stays a navaid, and hazard 'danger' is checked before navaid so an
// isolated-danger mark stays a hazard, both matching the exact table above.
const KEYWORD_CATEGORY: ReadonlyArray<readonly [string, PoiCategory]> = [
  ['fuel', 'fuel'],
  ['anchor', 'anchorage'],
  ['mooring', 'anchorage'],
  ['marina', 'marina'],
  ['harbour', 'marina'],
  ['harbor', 'marina'],
  ['yacht', 'marina'],
  ['wreck', 'hazard'],
  ['rock', 'hazard'],
  ['obstruction', 'hazard'],
  ['hazard', 'hazard'],
  ['danger', 'hazard'],
  ['buoy', 'navaid'],
  ['beacon', 'navaid'],
  ['light', 'navaid'],
  ['navigation', 'navaid'],
  ['inlet', 'inlet'],
  ['pumpout', 'services'],
  ['pump_out', 'services'],
  ['water', 'services'],
  ['provision', 'services'],
  ['grocery', 'services'],
  ['repair', 'services'],
  ['chandler', 'services'],
  ['business', 'services'],
  ['bridge', 'bridge'],
  ['ramp', 'ramp'],
  ['lock', 'structure'],
  ['dam', 'structure'],
  ['ferry', 'structure'],
];

const CATEGORY_LABEL: Record<PoiCategory, string> = {
  anchorage: 'Anchorage',
  marina: 'Marina',
  fuel: 'Fuel',
  services: 'Services',
  inlet: 'Inlet',
  ramp: 'Boat ramp',
  bridge: 'Bridge',
  hazard: 'Hazard',
  navaid: 'Navigation aid',
  structure: 'Structure',
  generic: 'Point of interest',
};

// Every category, derived from the label record's keys rather than hand-listed, so the list cannot
// drift from the union: a new PoiCategory must be added to CATEGORY_LABEL (a Record<PoiCategory,
// string> the compiler checks for exhaustiveness), which then flows here automatically.
export const POI_CATEGORIES: readonly PoiCategory[] = Object.keys(CATEGORY_LABEL) as PoiCategory[];

const POI_CATEGORY_SET = new Set<string>(POI_CATEGORIES);

// Whether a raw string is a known marker category, for narrowing a provider- or user-supplied value
// before it is used as a PoiCategory. The membership set is built once here instead of at each call
// site that previously rebuilt `new Set(POI_CATEGORIES)`.
export function isPoiCategory(value: string): value is PoiCategory {
  return POI_CATEGORY_SET.has(value);
}

// A raw string narrowed to a PoiCategory, falling back to the given category (generic by default)
// when it is not a known one.
export function asPoiCategory(raw: string, fallback: PoiCategory = 'generic'): PoiCategory {
  return isPoiCategory(raw) ? raw : fallback;
}

// Resolved skIcon strings memoized across calls: the same provider icon value repeats across many
// notes and the resolver runs per note per overlay refresh, so the keyword scan runs once per
// distinct string instead of per call. Bounded by the small set of icon names providers emit.
const SKICON_CACHE = new Map<string, PoiCategory>();

export function categoryForSkIcon(skIcon: string | undefined): PoiCategory {
  if (!skIcon) return 'generic';
  const cached = SKICON_CACHE.get(skIcon);
  if (cached) return cached;
  // Lowercase once: the exact table and keyword needles are all lowercase, so a capitalized
  // provider variant still classifies instead of falling through to a generic pin.
  const lower = skIcon.toLowerCase();
  const resolved =
    SKICON_CATEGORY[lower] ??
    KEYWORD_CATEGORY.find(([needle]) => lower.includes(needle))?.[1] ??
    'generic';
  SKICON_CACHE.set(skIcon, resolved);
  return resolved;
}

export function categoryLabel(category: PoiCategory): string {
  return CATEGORY_LABEL[category];
}

export function poiIconId(category: PoiCategory): string {
  return `binnacle-poi-${category}`;
}

// Cluster priority, highest first: a cluster shows its most important member's icon. Safety
// (hazard) and navigation (navaid) lead, then passages and destinations, then services. The values
// are distinct so the cluster icon can match on the aggregated maximum rank.
const CATEGORY_RANK: Record<PoiCategory, number> = {
  hazard: 100,
  navaid: 90,
  inlet: 70,
  anchorage: 60,
  marina: 55,
  fuel: 50,
  services: 40,
  ramp: 30,
  bridge: 25,
  structure: 20,
  generic: 0,
};

export function categoryRank(category: PoiCategory): number {
  return CATEGORY_RANK[category];
}

// Crow's Nest's explicit POI type, mapped to a marker category. Types with no dedicated
// Binnacle marker return undefined so the caller falls back to skIcon inference.
const TYPE_CATEGORY: Partial<Record<PoiType, PoiCategory>> = {
  Marina: 'marina',
  Anchorage: 'anchorage',
  Hazard: 'hazard',
  Business: 'services',
  BoatRamp: 'ramp',
  Bridge: 'bridge',
  Dam: 'structure',
  Lock: 'structure',
  Ferry: 'structure',
  Inlet: 'inlet',
  Navigational: 'navaid',
};

export function poiCategoryForType(type: PoiType | undefined): PoiCategory | undefined {
  return type ? TYPE_CATEGORY[type] : undefined;
}
