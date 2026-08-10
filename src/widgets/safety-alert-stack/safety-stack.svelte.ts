// The emergency rail's promotion model. One condition renders as the full strip (the primary);
// every other active condition is a compact chip. Default primacy follows urgency, the operator
// may inspect a lower-priority condition, and only a newly raised (or re-raised) more-urgent
// condition preempts that inspection: a standing higher-priority condition the operator
// deliberately demoted does not snap back on its own.

export interface SafetyCondition {
  id: string;
  active: boolean;
  // Lower is more urgent; ties break by array order.
  rank: number;
  acknowledged: boolean;
}

// Acknowledged conditions sort after every unacknowledged one, whatever their base rank.
const ACK_RANK_PENALTY = 100;

export function effectiveRank(condition: SafetyCondition): number {
  return condition.rank + (condition.acknowledged ? ACK_RANK_PENALTY : 0);
}

export class SafetyStack {
  #inspectedId = $state<string | undefined>(undefined);
  #shownId = $state<string | undefined>(undefined);
  // Last pass's effective rank per active condition, for rising-edge detection. A plain map:
  // written and read only inside update().
  #previousRanks = new Map<string, number>();

  // The condition to render as the full strip, or undefined when nothing is active.
  get shownId(): string | undefined {
    return this.#shownId;
  }

  // The operator taps a chip to promote its condition.
  inspect(id: string): void {
    this.#inspectedId = id;
  }

  update(conditions: readonly SafetyCondition[]): void {
    const active = conditions.filter((condition) => condition.active);
    const ranks = new Map(active.map((condition) => [condition.id, effectiveRank(condition)]));
    if (active.length === 0) {
      this.#inspectedId = undefined;
      this.#shownId = undefined;
      this.#previousRanks = ranks;
      return;
    }
    const inspected = active.find((condition) => condition.id === this.#inspectedId);
    if (!inspected) {
      this.#inspectedId = undefined;
    } else {
      const inspectedRank = effectiveRank(inspected);
      for (const condition of active) {
        if (condition.id === inspected.id) continue;
        const rank = effectiveRank(condition);
        const previous = this.#previousRanks.get(condition.id);
        const rising = previous === undefined || rank < previous;
        if (rising && rank < inspectedRank) {
          this.#inspectedId = undefined;
          break;
        }
      }
    }
    this.#previousRanks = ranks;
    if (this.#inspectedId !== undefined) {
      this.#shownId = this.#inspectedId;
      return;
    }
    let best: SafetyCondition | undefined;
    for (const condition of active) {
      if (!best || effectiveRank(condition) < effectiveRank(best)) best = condition;
    }
    this.#shownId = best?.id;
  }
}
