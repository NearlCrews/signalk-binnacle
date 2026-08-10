import { hasControlCharacters, isRecord } from '$shared/lib';

// A watch-handoff snapshot: what this station saw at one moment, for the oncoming watch to review.
// Facts are captured as labeled plain-text lines at creation time, so a snapshot stays honest about
// what was known then rather than silently re-deriving from later data. Creating one never mutates
// profiles, acknowledgment state, routes, or navigation.

export interface HandoffFact {
  label: string;
  value: string;
}

export interface HandoffSnapshot {
  id: string;
  // Wall-clock epoch milliseconds when the snapshot was taken.
  createdAt: number;
  // A short operator note; may be empty.
  note: string;
  facts: HandoffFact[];
}

// Where a snapshot lives right now: on the server for every station, queued on this device until
// the server accepts it, or on this device only because the server offers no shared store.
export type HandoffSyncState = 'shared' | 'pending' | 'device-only';

export interface HandoffRecord extends HandoffSnapshot {
  sync: HandoffSyncState;
}

export const MAX_HANDOFF_NOTE_LENGTH = 500;
export const MAX_HANDOFF_FACTS = 40;
export const MAX_HANDOFF_FACT_TEXT = 200;
// How many snapshots the panel lists and the shared document is pruned to.
export const MAX_HANDOFF_SNAPSHOTS = 20;

function cleanShortText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || hasControlCharacters(value)) return undefined;
  const text = value.trim();
  return text.length > maxLength ? undefined : text;
}

export function isHandoffFact(value: unknown): value is HandoffFact {
  if (!isRecord(value)) return false;
  const label = cleanShortText(value.label, MAX_HANDOFF_FACT_TEXT);
  const fact = cleanShortText(value.value, MAX_HANDOFF_FACT_TEXT);
  return label !== undefined && label.length > 0 && fact !== undefined;
}

// Validates a snapshot from any untrusted source (the shared server document, a stored draft), so
// one corrupt entry never takes the whole list down.
export function isHandoffSnapshot(value: unknown): value is HandoffSnapshot {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 64) return false;
  if (hasControlCharacters(value.id)) return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
  if (value.createdAt <= 0) return false;
  if (cleanShortText(value.note, MAX_HANDOFF_NOTE_LENGTH) === undefined) return false;
  if (!Array.isArray(value.facts) || value.facts.length > MAX_HANDOFF_FACTS) return false;
  return value.facts.every(isHandoffFact);
}

// Newest first, bounded, for the panel list and for pruning the shared document.
export function newestHandoffs(
  snapshots: readonly HandoffSnapshot[],
  limit = MAX_HANDOFF_SNAPSHOTS,
): HandoffSnapshot[] {
  return [...snapshots].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
