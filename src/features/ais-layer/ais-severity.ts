import type { Assessment, Severity } from '$entities/collision';

// The grading order the AIS symbol layers sort and gate by: danger, warning, unassessed, then
// clear. Text placement gives priority to lower sort keys, so a graded target's label survives the
// collisions that thin the rest. Unassessed sits above clear on purpose: a target the collision
// math could not grade is less certain than one it examined and cleared.
export const DANGER_RANK = 0;
export const WARNING_RANK = 1;
export const UNASSESSED_RANK = 2;
export const CLEAR_RANK = 3;

// The paint grade a rank maps back to, for the feature-state severity the vector color reads.
// Unassessed renders as clear there on purpose: the vector line's color grades threat, and the
// unassessed distinction belongs to the lookout panel, not a color a helmsman must decode.
export function severityForRank(rank: number): Severity {
  if (rank === DANGER_RANK) return 'danger';
  if (rank === WARNING_RANK) return 'warning';
  return 'clear';
}

export interface SeverityTracker {
  // The current rank for a target id; ids the assessment does not grade read as clear.
  rankFor(id: string): number;
  // Re-read the assessment and fold it into the tracked ranks. Returns true when any target's
  // grade changed since the last sync; onChanged receives each drifted id with its new rank,
  // including a departure back to CLEAR_RANK. Identity-gated, so the steady-state call is one
  // comparison.
  sync(onChanged?: (id: string, rank: number) => void): boolean;
  reset(): void;
}

// One tracker per overlay instance: each keeps its own applied-grading record so a hidden or
// re-added overlay catches up on its own schedule. Without an assessment getter (the composition
// root has not wired collision grading), every target reads clear and sync reports no changes.
export function createSeverityTracker(assessment?: () => Assessment): SeverityTracker {
  let lastAssessment: Assessment | undefined;
  // Only graded and unassessed ids are held; absence is clear.
  const ranks = new Map<string, number>();
  const seen = new Set<string>();

  const apply = (
    id: string,
    rank: number,
    onChanged?: (id: string, rank: number) => void,
  ): boolean => {
    if (ranks.get(id) === rank) return false;
    ranks.set(id, rank);
    onChanged?.(id, rank);
    return true;
  };

  return {
    rankFor(id) {
      return ranks.get(id) ?? CLEAR_RANK;
    },
    sync(onChanged) {
      if (!assessment) return false;
      const current = assessment();
      if (current === lastAssessment) return false;
      lastAssessment = current;
      seen.clear();
      let changed = false;
      for (const contact of current.contacts) {
        seen.add(contact.id);
        const rank = contact.severity === 'danger' ? DANGER_RANK : WARNING_RANK;
        if (apply(contact.id, rank, onChanged)) changed = true;
      }
      for (const contact of current.unassessed) {
        // An id somehow both graded and unassessed keeps the graded rank.
        if (seen.has(contact.id)) continue;
        seen.add(contact.id);
        if (apply(contact.id, UNASSESSED_RANK, onChanged)) changed = true;
      }
      // Ids the assessment no longer mentions fall back to clear and leave the map, so a pruned
      // target cannot pin its entry forever.
      if (ranks.size > seen.size) {
        for (const id of ranks.keys()) {
          if (seen.has(id)) continue;
          ranks.delete(id);
          onChanged?.(id, CLEAR_RANK);
          changed = true;
        }
      }
      return changed;
    },
    reset() {
      lastAssessment = undefined;
      ranks.clear();
    },
  };
}
