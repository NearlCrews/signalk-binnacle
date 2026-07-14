export type LatestWriterState = 'idle' | 'saving' | 'saved' | 'error';

export interface LatestWriter<T> {
  submit(value: T): void;
  retry(): void;
  dispose(): void;
  readonly state: LatestWriterState;
}

interface LatestWriterOptions {
  savedDurationMs?: number;
  schedule?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

// Serializes whole-document settings writes and coalesces changes made while one is in flight. The
// latest submitted snapshot is always the final request, so a slow older response cannot restore stale
// settings. A failed superseded request stays silent because the queued latest snapshot immediately
// retries the full document; only the last failed request produces the visible error state.
export function createLatestWriter<T>(
  write: (value: T) => Promise<void>,
  options: LatestWriterOptions = {},
): LatestWriter<T> {
  const savedDurationMs = options.savedDurationMs ?? 2_000;
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel = options.cancel ?? clearTimeout;

  let state = $state<LatestWriterState>('idle');
  let latest: T | undefined;
  let hasLatest = false;
  let lastAttempt: T | undefined;
  let hasLastAttempt = false;
  let running = false;
  let disposed = false;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  function clearSavedTimer(): void {
    if (savedTimer !== undefined) cancel(savedTimer);
    savedTimer = undefined;
  }

  function showSaved(): void {
    state = 'saved';
    clearSavedTimer();
    savedTimer = schedule(() => {
      savedTimer = undefined;
      if (!disposed && state === 'saved') state = 'idle';
    }, savedDurationMs);
  }

  async function drain(): Promise<void> {
    if (running || disposed) return;
    running = true;
    try {
      while (hasLatest && !disposed) {
        const value = latest as T;
        hasLatest = false;
        lastAttempt = value;
        hasLastAttempt = true;
        let ok = true;
        try {
          await write(value);
        } catch {
          ok = false;
        }
        if (disposed) return;
        // A newer snapshot supersedes both success and failure feedback from this request.
        if (hasLatest) continue;
        if (ok) showSaved();
        else state = 'error';
      }
    } finally {
      running = false;
      // A submit can land after the loop condition but before running clears.
      if (hasLatest && !disposed) void drain();
    }
  }

  function submit(value: T): void {
    if (disposed) return;
    latest = value;
    hasLatest = true;
    clearSavedTimer();
    state = 'saving';
    void drain();
  }

  return {
    submit,
    retry(): void {
      if (hasLastAttempt) submit(lastAttempt as T);
    },
    dispose(): void {
      disposed = true;
      hasLatest = false;
      clearSavedTimer();
    },
    get state() {
      return state;
    },
  };
}
