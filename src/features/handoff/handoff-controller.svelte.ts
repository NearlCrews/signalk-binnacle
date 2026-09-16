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

// A full queue must never silently discard an unsynced watch record.
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
  online?: () => boolean;
  // Fires after a snapshot is taken; the composition root offers a logbook entry from it.
  onCreated?: () => void;
}

export interface HandoffController {
  draft: string;
  readonly error: string | undefined;
  readonly pendingCount: number;
  readonly queueFull: boolean;
  readonly memoryOnly: boolean;
  readonly records: readonly HandoffRecord[];
  readonly loadState: 'idle' | 'loading' | 'ready' | 'unavailable';
  readonly syncing: boolean;
  create(note: string): boolean;
  refresh(): Promise<void>;
  syncDrafts(): Promise<void>;
  dispose(): void;
}

export function createHandoffController(deps: HandoffDeps): HandoffController {
  const now = deps.now ?? Date.now;
  let shared = $state<HandoffSnapshot[]>([]);
  let loadState = $state<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  let syncing = $state(false);
  let draft = $state('');
  let error = $state<string | undefined>();
  let loadGeneration = 0;
  let writesDuringLoad: Map<string, HandoffSnapshot> | undefined;
  let disposed = false;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

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
    const acceptedWrites = new Map<string, HandoffSnapshot>();
    writesDuringLoad = acceptedWrites;
    loadState = loadState === 'idle' ? 'loading' : loadState;
    const result = await deps.client().load();
    if (disposed || generation !== loadGeneration) return;
    writesDuringLoad = undefined;
    if (result.state === 'unavailable') {
      loadState = 'unavailable';
      return;
    }
    // The server snapshot may predate a POST accepted while this GET was in flight. Its local
    // draft has already been removed, so retain that accepted write until a later read catches up.
    const merged = new Map(result.snapshots.map((snapshot) => [snapshot.id, snapshot]));
    for (const [id, snapshot] of acceptedWrites) merged.set(id, snapshot);
    shared = newestHandoffs([...merged.values()], 200);
    loadState = 'ready';
    void deps.client().prune(result.snapshots);
    void syncDrafts();
  }

  // Serialized: one pass posts drafts oldest first, stopping at the first failure so order is
  // preserved and a dead server costs one request, not one per draft.
  async function syncDrafts(): Promise<void> {
    if (disposed || syncing || deps.online?.() === false) return;
    if (deps.drafts.value.length === 0) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    syncing = true;
    try {
      while (!disposed && deps.online?.() !== false) {
        const draft = [...deps.drafts.value].sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!draft) break;
        const accepted = await deps.client().post(draft);
        if (disposed) return;
        if (!accepted) {
          loadState = 'unavailable';
          if (deps.online?.() !== false) {
            const delay = Math.min(120_000, 5_000 * 2 ** retryAttempt);
            retryAttempt = Math.min(5, retryAttempt + 1);
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              void syncDrafts();
            }, delay);
          }
          return;
        }
        retryAttempt = 0;
        writesDuringLoad?.set(draft.id, draft);
        deps.drafts.set(deps.drafts.value.filter((entry) => entry.id !== draft.id));
        shared = newestHandoffs([draft, ...shared], 200);
        if (loadState !== 'ready') loadState = 'ready';
      }
    } finally {
      syncing = false;
    }
  }

  function create(note: string): boolean {
    error = undefined;
    if (disposed) return false;
    if (deps.drafts.value.length >= MAX_DRAFTS) {
      error =
        'Ten snapshots are waiting to sync. Reconnect and retry syncing before taking another.';
      return false;
    }
    const snapshot: HandoffSnapshot = {
      id: uuidv4(),
      createdAt: now(),
      note: note.trim().slice(0, MAX_HANDOFF_NOTE_LENGTH),
      facts: deps.collectFacts().slice(0, MAX_HANDOFF_FACTS),
    };
    const previous = deps.drafts.value;
    deps.drafts.set([...previous, snapshot]);
    if (deps.drafts.lastWriteFailed) {
      // Keep the authored text and all accepted records. Do not offer success for a snapshot
      // that could not be durably queued, or enqueue a duplicate when the navigator retries.
      deps.drafts.set(previous);
      error =
        'The snapshot could not be saved on this device. Your note is retained in memory; keep the app open and retry.';
      return false;
    }
    void syncDrafts();
    deps.onCreated?.();
    return true;
  }

  return {
    get draft() {
      return draft;
    },
    set draft(value: string) {
      draft = value.slice(0, MAX_HANDOFF_NOTE_LENGTH);
    },
    get error() {
      return error;
    },
    get pendingCount() {
      return deps.drafts.value.length;
    },
    get queueFull() {
      return deps.drafts.value.length >= MAX_DRAFTS;
    },
    get memoryOnly() {
      return deps.drafts.lastWriteFailed;
    },
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
    dispose(): void {
      disposed = true;
      loadGeneration += 1;
      writesDuringLoad = undefined;
      clearTimeout(retryTimer);
    },
  };
}
