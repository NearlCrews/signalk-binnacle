import { createBusyGate } from '$shared/lib';
import { cleanTruncatedText } from '$shared/signalk';
import {
  createLogEntry,
  detectLogbook,
  fetchRecentEntries,
  type LogbookAvailability,
  type LogbookEntry,
  MAX_LOGBOOK_TEXT_LENGTH,
  MAX_RECENT_ENTRIES,
} from './logbook-client';

export interface LogbookDeps {
  origin: () => string;
  getToken: () => string | undefined;
  // Compatibility with callers sharing device-token dependencies. The admin-session plugin
  // deliberately does not use that independent access gate.
  writeBlocked?: () => boolean;
  requestWriteAccess?: () => Promise<void>;
  now?: () => number;
}

// One pending draft at a time, newest wins. It is only ever an offer: the panel prefills the
// composer with it, and nothing is logged without a tap.
export interface LogbookSuggestion {
  text: string;
  offeredAt: number;
}

type LogbookLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface LogbookController {
  readonly availability: 'unknown' | LogbookAvailability;
  readonly entries: readonly LogbookEntry[];
  readonly loadState: LogbookLoadState;
  readonly busy: boolean;
  readonly checking: boolean;
  readonly error: string | undefined;
  readonly suggestion: LogbookSuggestion | undefined;
  start(): void;
  recheck(): Promise<void>;
  refresh(): Promise<void>;
  addEntry(text: string): Promise<boolean>;
  offerEntry(text: string): void;
  dismissSuggestion(): void;
  clearError(): void;
}

export function createLogbookController(deps: LogbookDeps): LogbookController {
  const now = deps.now ?? Date.now;
  let availability = $state<'unknown' | LogbookAvailability>('unknown');
  let entries = $state<LogbookEntry[]>([]);
  let loadState = $state<LogbookLoadState>('idle');
  let busy = $state(false);
  let checking = $state(false);
  let error = $state<string | undefined>();
  let suggestion = $state<LogbookSuggestion | undefined>();
  let loadGeneration = 0;
  let started = false;

  const withBusy = createBusyGate(
    () => busy,
    (value) => {
      busy = value;
    },
  );

  async function refresh(): Promise<void> {
    const generation = ++loadGeneration;
    if (entries.length === 0) loadState = 'loading';
    const result = await fetchRecentEntries(deps.origin(), deps.getToken());
    if (generation !== loadGeneration) return;
    if (result.state === 'ok') {
      entries = result.entries;
      availability = 'available';
      loadState = 'ready';
      return;
    }
    if (result.state === 'absent') {
      availability = 'absent';
      entries = [];
      loadState = 'idle';
      return;
    }
    if (result.state === 'unauthorized') {
      availability = 'unauthorized';
      return;
    }
    // A transient failure keeps the accepted entries and the availability verdict.
    loadState = 'error';
  }

  async function recheck(): Promise<void> {
    if (checking) return;
    checking = true;
    try {
      const result = await detectLogbook(deps.origin(), deps.getToken());
      availability = result;
      if (result === 'available') await refresh();
    } finally {
      checking = false;
    }
  }

  function start(): void {
    if (started) return;
    started = true;
    void recheck();
  }

  const addEntry = withBusy(async (text: string): Promise<boolean> => {
    error = undefined;
    const cleaned = cleanTruncatedText(text, MAX_LOGBOOK_TEXT_LENGTH);
    if (!cleaned) {
      error = 'Enter the log text first.';
      return false;
    }
    const outcome = await createLogEntry(deps.origin(), deps.getToken(), cleaned);
    // A 404 mid-session means the plugin was disabled or removed; the panel falls back to its
    // landing state instead of blaming the connection.
    if (outcome === 'unavailable') {
      availability = 'absent';
      error = 'The logbook is no longer available on the server, so the entry was not logged.';
      return false;
    }
    if (outcome === 'access-denied') {
      availability = 'unauthorized';
      error =
        'The entry was not logged. Sign in to Signal K as an administrator, then check again.';
      return false;
    }
    if (outcome !== 'ok') {
      error = 'Could not log the entry. Check the connection.';
      return false;
    }
    // The accepted entry shows immediately; the follow-up refresh replaces it with the server's
    // copy, which carries the plugin's own timestamp and captured conditions.
    const echo: LogbookEntry = {
      datetime: new Date(now()).toISOString(),
      timeMs: now(),
      text: cleaned,
      origin: 'manual',
    };
    entries = [echo, ...entries].slice(0, MAX_RECENT_ENTRIES);
    // Any successful entry consumes the pending offer: its moment has been logged, edited or not.
    suggestion = undefined;
    void refresh();
    return true;
  }, false);

  function offerEntry(text: string): void {
    const cleaned = cleanTruncatedText(text, MAX_LOGBOOK_TEXT_LENGTH);
    if (!cleaned) return;
    suggestion = { text: cleaned, offeredAt: now() };
  }

  return {
    get availability() {
      return availability;
    },
    get entries() {
      return entries;
    },
    get loadState() {
      return loadState;
    },
    get busy() {
      return busy;
    },
    get checking() {
      return checking;
    },
    get error() {
      return error;
    },
    get suggestion() {
      return suggestion;
    },
    start,
    recheck,
    refresh,
    addEntry,
    offerEntry,
    dismissSuggestion() {
      suggestion = undefined;
    },
    clearError() {
      error = undefined;
    },
  };
}
