import { DEFAULT_JSON_RESPONSE_BYTES, readBoundedJson } from './bounded-json';
import { withTimeout } from './fetch-timeout';

// The default fetch applies a timeout so a half-open boat link cannot hang a request forever; an
// aborted fetch throws and is caught below into undefined, like any other transport failure. A test
// that injects its own fetchFn keeps full control and gets no timeout wrapping.
const timeoutFetch: typeof fetch = (url, init) => globalThis.fetch(url, withTimeout(init));

// Best-effort JSON fetch: centralizes the degrade-to-undefined, never-throw contract the free-API
// weather clients share, so a non-ok response, a transport failure, a timeout, or a JSON parse error
// all yield undefined rather than propagating.
export async function fetchJsonOrUndefined<T>(
  url: string,
  init?: RequestInit,
  fetchFn: typeof fetch = timeoutFetch,
  maxBytes: number = DEFAULT_JSON_RESPONSE_BYTES,
): Promise<T | undefined> {
  try {
    const r = await fetchFn(url, init);
    if (!r.ok) return undefined;
    return await readBoundedJson<T>(r, maxBytes);
  } catch {
    return undefined;
  }
}
