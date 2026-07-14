// A server that accepts the TCP connection but never responds (a half-open link on a boat, a stalled
// proxy) would otherwise hang a fetch for the browser default, which can be minutes. Wrapping the
// request init with a timeout AbortSignal bounds that wait. A caller-owned cancellation signal is
// composed with the timeout so either condition stops the request. An environment without
// AbortSignal.timeout degrades to caller cancellation only rather than throwing.
export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export function withTimeout(
  init?: RequestInit,
  ms: number = DEFAULT_FETCH_TIMEOUT_MS,
): RequestInit {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return init ?? {};
  }
  const timeout = AbortSignal.timeout(ms);
  if (!init?.signal) return { ...init, signal: timeout };
  if (typeof AbortSignal.any === 'function') {
    return { ...init, signal: AbortSignal.any([init.signal, timeout]) };
  }
  const controller = new AbortController();
  const caller = init.signal;
  function cleanup(): void {
    caller.removeEventListener('abort', onCallerAbort);
    timeout.removeEventListener('abort', onTimeoutAbort);
  }
  const forwardAbort = (signal: AbortSignal): void => {
    cleanup();
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  function onCallerAbort(): void {
    forwardAbort(caller);
  }
  function onTimeoutAbort(): void {
    forwardAbort(timeout);
  }
  if (caller.aborted) {
    forwardAbort(caller);
  } else if (timeout.aborted) {
    forwardAbort(timeout);
  } else {
    caller.addEventListener('abort', onCallerAbort, { once: true });
    timeout.addEventListener('abort', onTimeoutAbort, { once: true });
  }
  return { ...init, signal: controller.signal };
}
