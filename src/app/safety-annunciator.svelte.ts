// One priority-aware spoken safety channel. Five independent assertive regions had no
// deterministic order when several hazards changed in one pass, and a later low-priority
// notification could interrupt an urgent announcement. This serializes them: the worst changed
// message takes the single assertive region, every other changed message queues into a polite
// region and is delivered after the urgent one, and an unchanged message is never re-spoken.

export interface SafetyAnnouncement {
  id: string;
  // Lower is more urgent.
  rank: number;
  // Empty when the channel has nothing to say; a transition to empty releases the channel.
  text: string;
}

// Pacing for the polite queue: long enough for a screen reader to finish the previous message.
const POLITE_GAP_MS = 4_000;

export function createSafetyAnnunciator() {
  let assertive = $state('');
  let polite = $state('');
  const lastTexts = new Map<string, string>();
  // The channel currently holding the assertive region, so a worse-ranked later change cannot
  // interrupt it and queues politely instead.
  let holderId: string | undefined;
  let holderRank = Number.POSITIVE_INFINITY;
  const queue: SafetyAnnouncement[] = [];
  let politeId: string | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleDrain(): void {
    if (drainTimer !== undefined) return;
    drainTimer = setTimeout(() => {
      drainTimer = undefined;
      let next = queue.shift();
      while (next && lastTexts.get(next.id) !== next.text) next = queue.shift();
      if (next === undefined) return;
      polite = next.text;
      politeId = next.id;
      if (queue.length > 0) scheduleDrain();
    }, POLITE_GAP_MS);
  }

  function enqueue(items: readonly SafetyAnnouncement[]): void {
    for (const item of items) {
      if (item.text) queue.push(item);
    }
    if (queue.length > 0) scheduleDrain();
  }

  function update(items: readonly SafetyAnnouncement[]): void {
    const changed: SafetyAnnouncement[] = [];
    for (const item of items) {
      const last = lastTexts.get(item.id) ?? '';
      if (item.text === last) continue;
      lastTexts.set(item.id, item.text);
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].id === item.id) queue.splice(index, 1);
      }
      if (politeId === item.id) {
        polite = '';
        politeId = undefined;
      }
      if (item.text) changed.push(item);
      else if (holderId === item.id) {
        // The holder resolved; the region stays quiet until the next change claims it.
        holderId = undefined;
        holderRank = Number.POSITIVE_INFINITY;
        assertive = '';
      }
    }
    if (changed.length === 0) return;
    changed.sort((a, b) => a.rank - b.rank);
    const worst = changed[0];
    if (holderId === undefined || holderId === worst.id || worst.rank <= holderRank) {
      assertive = worst.text;
      holderId = worst.id;
      holderRank = worst.rank;
      enqueue(changed.slice(1));
    } else {
      enqueue(changed);
    }
  }

  function dispose(): void {
    if (drainTimer !== undefined) clearTimeout(drainTimer);
    drainTimer = undefined;
    queue.length = 0;
  }

  return {
    update,
    dispose,
    get assertive() {
      return assertive;
    },
    get polite() {
      return polite;
    },
  };
}
