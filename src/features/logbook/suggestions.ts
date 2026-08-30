import { cleanTruncatedText } from '$shared/signalk';

// Drafts for the moments Binnacle offers to log: short factual sentences built only from what the
// caller states, never from inferred conditions. Nothing here writes anything; a draft becomes a
// log entry only when the navigator taps Log it in the panel.

const MAX_NAME_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 600;

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function logbookHandoffSuggestion(factsSummary: string): string {
  const summary = cleanTruncatedText(factsSummary, MAX_SUMMARY_LENGTH);
  return summary ? `Watch handed over. ${sentence(summary)}` : 'Watch handed over.';
}

export type CourseSuggestionKind = 'started' | 'arrived' | 'stopped';

export function logbookCourseSuggestion(
  kind: CourseSuggestionKind,
  destinationName?: string,
): string {
  const name = cleanTruncatedText(destinationName, MAX_NAME_LENGTH);
  switch (kind) {
    case 'started':
      return name ? `Navigation started to ${name}.` : 'Navigation started.';
    case 'arrived':
      return name ? `Arrived at ${name}.` : 'Arrived at the destination.';
    case 'stopped':
      return name ? `Navigation to ${name} stopped.` : 'Navigation stopped.';
  }
}

export type AnchorSuggestionKind = 'dropped' | 'raised';

export function logbookAnchorSuggestion(kind: AnchorSuggestionKind, radiusMeters?: number): string {
  if (kind === 'raised') return 'Anchor up.';
  const radius =
    typeof radiusMeters === 'number' && Number.isFinite(radiusMeters) && radiusMeters > 0
      ? Math.round(radiusMeters)
      : undefined;
  return radius ? `Anchor down, watch radius ${radius} m.` : 'Anchor down.';
}
