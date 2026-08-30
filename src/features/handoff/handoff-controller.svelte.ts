import {
  type HandoffFact,
  type HandoffRecord,
  type HandoffSnapshot,
  MAX_HANDOFF_FACTS,
  MAX_HANDOFF_NOTE_LENGTH,
  MAX_HANDOFF_SNAPSHOTS,
  newestHandoffs,
} from '$entities/handoff';
import { uuidv4 } from '$shared/lib';
import type { PersistedValue } from '$shared/settings';
import type { HandoffClient } from './handoff-client';

// How many unsynced drafts a device queues; past the bound the oldest draft is dropped, never the
// newest snapshot (the one being handed over right now).
const MAX_DRAFTS = 10;

export interface HandoffDeps {
  client: () => HandoffClient;
  // Builds the fact lines at snapshot time from the live stores. Injected so this controller reads
  // through the composition root and never reaches into features itself.
  collectFacts: () => HandoffFact[];
  // The bounded offline draft queue, persisted on this device. The composition root owns the
  // reconnect edge: an App effect calls syncDrafts when the browser comes back online.
  drafts: PersistedValue<HandoffSnapshot[]>;
  now?: () => number;
  // Fires after a snapshot is taken; the composition root offers a logbook entry from it.
  onCreated?: () => void;
}

export interface HandoffController {
  readonly records: readonly HandoffRecord[];
  readonly loadState: 'idle' | 'loading' | 'ready' | 'unavailable';
  readonly syncing: boolean;
  create(note: string): void;
  refresh(): Promise<void>;
  syncDrafts(): Promise<void>;
}

export function createHandoffController(deps: HandoffDeps): HandoffController {
  const now = deps.now ?? Date.now;
  let shared = $state<HandoffSnapshot[]>([]);
  let loadState = $state<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  let syncing = $state(false);
  let loadGeneration = 0;

  // The shared list plus this device's drafts, deduplicated by id (a draft overrides its shared
  // copy so a just-synced snapshot never shows twice), newest first, bounded for display.
  const records = $derived.by<readonly HandoffRecord[]>(() => {
    const draftSync: HandoffRecord['sync'] =
      loadState === 'unavailable' ? 'device-only' : 'pending';
    const merged = new Map<string, HandoffRecord>();
    for (const snapshot of shared) merged.set(snapshot.id, { ...snapshot, sync: 'shared' });
    for (const draft of deps.drafts.value) merged.set(draft.id, { ...draft, sync: draftSync });
    return [...merged.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_HANDOFF_SNAPSHOTS);
  });

  async function refresh(): Promise<void> {
    const generation = ++loadGeneration;
    loadState = loadState === 'idle' ? 'loading' : loadState;
    const result = await deps.client().load();
    if (generation !== loadGeneration) return;
    if (result.state === 'unavailable') {
      loadState = 'unavailable';
      return;
    }
    shared = result.snapshots;
    loadState = 'ready';
    void deps.client().prune(result.snapshots);
  }

  // Serialized: one pass posts drafts oldest first, stopping at the first failure so order is
  // preserved and a dead server costs one request, not one per draft.
  async function syncDrafts(): Promise<void> {
    if (syncing) return;
    if (deps.drafts.value.length === 0) return;
    syncing = true;
    try {
      const queue = [...deps.drafts.value].sort((a, b) => a.createdAt - b.createdAt);
      for (const draft of queue) {
        const accepted = await deps.client().post(draft);
        if (!accepted) return;
        deps.drafts.set(deps.drafts.value.filter((entry) => entry.id !== draft.id));
        shared = newestHandoffs([draft, ...shared], 200);
        if (loadState !== 'ready') loadState = 'ready';
      }
    } finally {
      syncing = false;
    }
  }

  function create(note: string): void {
    const snapshot: HandoffSnapshot = {
      id: uuidv4(),
      createdAt: now(),
      note: note.trim().slice(0, MAX_HANDOFF_NOTE_LENGTH),
      facts: deps.collectFacts().slice(0, MAX_HANDOFF_FACTS),
    };
    const queue = [...deps.drafts.value, snapshot];
    deps.drafts.set(queue.length > MAX_DRAFTS ? queue.slice(queue.length - MAX_DRAFTS) : queue);
    void syncDrafts();
    deps.onCreated?.();
  }

  return {
    get records() {
      return records;
    },
    get loadState() {
      return loadState;
    },
    get syncing() {
      return syncing;
    },
    create,
    refresh,
    syncDrafts,
  };
}
