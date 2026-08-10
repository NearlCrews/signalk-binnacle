interface RetryableLazyLoaderOptions {
  timeoutMs?: number;
  timeoutMessage?: string;
}

import { withPromiseTimeout } from './promise-timeout';

const DEFAULT_LAZY_UI_TIMEOUT_MS = 15_000;

export function createRetryableLazyLoader<T>(
  load: () => Promise<T>,
  options: RetryableLazyLoaderOptions = {},
): () => Promise<T> {
  let cached: Promise<T> | undefined;

  return () => {
    if (cached) return cached;

    const source = load();
    const pending =
      options.timeoutMs === undefined
        ? source
        : withPromiseTimeout(
            source,
            options.timeoutMs,
            options.timeoutMessage ?? 'Lazy module load timed out.',
          );
    cached = pending;
    void pending.catch(() => {
      if (cached === pending) cached = undefined;
    });
    return pending;
  };
}

// User-visible lazy surfaces provide a retry path, so a stalled request may time out and clear its
// cache. Lower-level one-shot registration uses createRetryableLazyLoader directly and waits for a
// slow import instead of permanently rolling back the feature.
export function createRetryableLazyUiLoader<T>(
  load: () => Promise<T>,
  options: RetryableLazyLoaderOptions = {},
): () => Promise<T> {
  return createRetryableLazyLoader(load, {
    timeoutMs: DEFAULT_LAZY_UI_TIMEOUT_MS,
    ...options,
  });
}
