// Warms lazy panel chunks once the page has settled, so the first tap on a large panel opens from
// cache instead of paying its chunk fetch at that moment. Loads run one at a time to stay off the
// critical path. A failed fetch is swallowed on purpose: each panel's own open path handles and
// surfaces its load failure, so a prefetch miss must stay silent.
export interface IdlePrefetchOptions {
  // The settle window: the setTimeout delay when requestIdleCallback is unavailable, and the
  // idle-callback deadline when it is, so a busy page still starts warming within the bound.
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 3_000;

export function idlePrefetch(
  loaders: ReadonlyArray<() => Promise<unknown>>,
  options: IdlePrefetchOptions = {},
): () => void {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let cancelled = false;

  const run = async (): Promise<void> => {
    for (const load of loaders) {
      if (cancelled) return;
      try {
        await load();
      } catch {
        // Silent by design; see the module comment.
      }
    }
  };
  const start = (): void => void run();

  let cancelPending: () => void;
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(start, { timeout: delayMs });
    cancelPending = () => cancelIdleCallback(handle);
  } else {
    const handle = setTimeout(start, delayMs);
    cancelPending = () => clearTimeout(handle);
  }

  return () => {
    cancelled = true;
    cancelPending();
  };
}
