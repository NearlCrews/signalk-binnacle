import type { NormalizedSection } from './notes-detail';

// Lower ranks render first. Section ids are stable per source (see the Crow's Nest integration
// doc), so a single rank by id leads with the decision-relevant facts (a hazard's danger and
// depth, a marina's dockage, depth, and fuel, a light's characteristic) and trails with reviews,
// provenance, and free text. Unknown ids sit in the middle, ahead of reviews and source.
const SECTION_RANK: Record<string, number> = {
  feature: 0,
  light: 1,
  depth: 2,
  dockage: 2,
  navigation: 3,
  fuel: 4,
  structure: 5,
  mooring: 6,
  daymark: 6,
  contact: 7,
  signals: 7,
  amenities: 8,
  services: 9,
  retail: 10,
  quality: 11,
  remarks: 12,
  notes: 12,
  information: 12,
  business: 16,
  review: 17,
  featuredReview: 18,
  source: 20,
};
const DEFAULT_RANK = 13;

// Order sections by helm relevance without dropping any: an unrecognized section still renders,
// it just sits in the middle. Stable within a rank, so same-rank sections keep their source order.
export function orderSections(sections: readonly NormalizedSection[]): NormalizedSection[] {
  return sections
    .map((section, index) => ({ section, index, rank: SECTION_RANK[section.id] ?? DEFAULT_RANK }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.section);
}

const GENERIC_NOTE_LABELS = new Set(['notes', 'note', 'information', 'remark', 'remarks']);

// A note label that repeats its section heading or is a generic catch-all adds nothing above the
// prose, so the panel drops it and shows the note full-width.
export function isRedundantNoteLabel(label: string, sectionTitle: string): boolean {
  const lower = label.trim().toLowerCase();
  return lower === sectionTitle.trim().toLowerCase() || GENERIC_NOTE_LABELS.has(lower);
}

// The producer leads an ENC hazard with a boolean "Dangerous" flag so a consumer can surface the
// danger status prominently (see the integration doc); this identifies that item.
export function isDangerFlag(label: string, kind: string | undefined): boolean {
  return kind === 'flag' && label.trim().toLowerCase() === 'dangerous';
}

export function dangerFlagText(value: unknown): string {
  if (value === true) return 'Dangerous to navigation';
  if (value === false) return 'Provider does not mark this feature as dangerous';
  return 'Danger status unknown';
}

export function flagText(value: unknown): string {
  return value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
}
