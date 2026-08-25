import {
  hasControlCharacters,
  isRecord,
  isUnsafeProviderKey,
  readBoundedJson,
  withTimeout,
} from '$shared/lib';

// Helpers shared by the resource clients (charts, notes, tracks): the bearer-auth request init
// and the string guards for parsing untyped resource JSON. A token is sent only when present.

export function authInit(token: string | undefined, extra?: RequestInit): RequestInit | undefined {
  if (!token && !extra) return undefined;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  return { ...extra, headers: { ...headers, ...extra?.headers } };
}

// Chart Locker management routes use Signal K's administrator middleware, which authenticates the
// browser's shared admin session. Never attach Binnacle's device bearer token to these requests:
// that token represents the webapp client, not the signed-in administrator, and can mask a valid
// administrator cookie on secured servers. `include` is Signal K's documented cookie-session
// contract, and `no-store` prevents an authentication refusal from surviving a successful login.
export function adminSessionInit(extra?: RequestInit): RequestInit {
  return { ...extra, credentials: 'include', cache: 'no-store' };
}

type WriteOutcomeListener = (ok: boolean, status: number) => void;

interface SignalKResourceClientOptions {
  fetch?: typeof fetch;
  getToken?: () => string | undefined;
  onWriteOutcome?: WriteOutcomeListener;
  timeoutMs?: number;
}

// Injectable Signal K REST transport. Feature controllers can own one instance with live token and
// outcome getters, while the compatibility functions below preserve the current call-site contract
// during incremental migration.
export class SignalKResourceClient {
  #fetch: typeof fetch;
  #getToken: () => string | undefined;
  #onWriteOutcome: WriteOutcomeListener | undefined;
  #timeoutMs: number | undefined;

  constructor(options: SignalKResourceClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#getToken = options.getToken ?? (() => undefined);
    this.#onWriteOutcome = options.onWriteOutcome;
    this.#timeoutMs = options.timeoutMs;
  }

  async fetchJson<T>(url: string): Promise<T | undefined> {
    try {
      const response = await this.#fetch(
        url,
        withTimeout(authInit(this.#getToken()), this.#timeoutMs),
      );
      if (!response.ok) return undefined;
      return await readBoundedJson<T>(response);
    } catch {
      return undefined;
    }
  }

  async fetchJsonOutcome<T>(url: string): Promise<FetchJsonOutcome<T>> {
    try {
      const response = await this.#fetch(
        url,
        withTimeout(authInit(this.#getToken()), this.#timeoutMs),
      );
      if (response.status === 404) return { state: 'not-found' };
      if (!response.ok) return { state: 'failed' };
      return { state: 'ok', value: await readBoundedJson<T>(response) };
    } catch {
      return { state: 'failed' };
    }
  }

  async sendJson(url: string, method: string, body?: unknown): Promise<Response | undefined> {
    try {
      const response = await this.#fetch(
        url,
        withTimeout(
          authInit(this.#getToken(), {
            method,
            ...(body !== undefined
              ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
              : {}),
          }),
          this.#timeoutMs,
        ),
      );
      this.#onWriteOutcome?.(response.ok, response.status);
      return response;
    } catch {
      return undefined;
    }
  }

  async put(url: string, body: unknown): Promise<boolean> {
    return (await this.sendJson(url, 'PUT', body))?.ok ?? false;
  }

  async post(url: string, body?: unknown): Promise<boolean> {
    return (await this.sendJson(url, 'POST', body))?.ok ?? false;
  }

  async delete(url: string): Promise<boolean> {
    return (await this.sendJson(url, 'DELETE'))?.ok ?? false;
  }
}

// Best-effort authenticated GET returning parsed JSON, or undefined on any non-OK status, network
// failure, timeout, or parse error. The bearer-auth GET-then-degrade shape recurs across the
// applicationData, trails, notes-detail, and tides clients; this is its single home.
export function fetchAuthedJson<T>(url: string, token: string | undefined): Promise<T | undefined> {
  return new SignalKResourceClient({ getToken: () => token }).fetchJson<T>(url);
}

export interface FetchJsonOutcome<T> {
  state: 'ok' | 'not-found' | 'failed';
  value?: T;
}

// Discovery scans need to distinguish a real absent branch from a transport or access failure so
// accepted catalog data is not erased by a transient outage.
export async function fetchAuthedJsonOutcome<T>(
  url: string,
  token: string | undefined,
): Promise<FetchJsonOutcome<T>> {
  return new SignalKResourceClient({ getToken: () => token }).fetchJsonOutcome<T>(url);
}

// The Signal K resources API returns a keyed object (id to record). An error envelope
// ({state, statusCode, message}) or an array arriving with a 200 is not that shape, so reject it:
// every resource client shares this guard so a malformed body never flows on as bogus records.
export function asKeyedObject(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body)) return undefined;
  if (
    Object.hasOwn(body, 'state') &&
    Object.hasOwn(body, 'statusCode') &&
    Object.hasOwn(body, 'message')
  ) {
    return undefined;
  }
  const entries = Object.entries(body);
  if (entries.length > 10_000) return undefined;
  const clean = Object.create(null) as Record<string, unknown>;
  for (const [id, value] of entries) {
    if (isUnsafeProviderKey(id)) continue;
    clean[id] = value;
  }
  return clean;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384
    ? value
    : undefined;
}

// Trim a provider-controlled resource string and CLIP it to the caller's bound, rejecting only an
// empty value or one carrying control characters. A route or waypoint name a provider sent longer
// than Binnacle displays is still the mariner's name for that mark, so it is shortened rather than
// dropped. Built on str, so it inherits the 16,384-character pre-bound before any slicing.
// The reject-on-oversized counterpart is cleanBoundedText in $shared/lib.
const MAX_RESOURCE_ID_LENGTH = 512;

// A Signal K resource id must round-trip byte-exact into the URL path, so reject rather than
// repair: an id that differs from its trim, carries control characters, or exceeds the bound
// never reaches the server. The route, waypoint, and track clients all guard writes and deletes
// through this one definition.
export function cleanResourceId(value: unknown): string | undefined {
  const text = str(value);
  if (
    !text ||
    text.length > MAX_RESOURCE_ID_LENGTH ||
    text !== text.trim() ||
    hasControlCharacters(text)
  ) {
    return undefined;
  }
  return text;
}

export function cleanTruncatedText(value: unknown, maxLength: number): string | undefined {
  const text = str(value)?.trim();
  if (!text || hasControlCharacters(text)) return undefined;
  return text.slice(0, maxLength);
}

export function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 1_000) return undefined;
  const out = value.filter(
    (v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 16_384,
  );
  return out.length > 0 ? out : undefined;
}

// Parse a Response body as JSON, falling back to a default when there is no JSON to parse (an empty
// 204, a non-JSON error page). Never throws. Shared by the resource clients so the
// parse-JSON-or-default idiom is spelled once rather than re-rolled as `.json().catch(...)` per client.
export async function jsonOr<T>(response: Response, fallback: T): Promise<T> {
  try {
    return await readBoundedJson<T>(response);
  } catch {
    return fallback;
  }
}

// Fetch a keyed-resource collection, trying each path in order (v2 then v1) and mapping every
// id/record entry through mapEntry (entries it returns undefined for are skipped). Returns the
// mapped list from the first reachable path, or undefined when every path is unreachable, so a
// caller can keep its current list rather than blank it on a transient failure. A reachable but
// empty server returns []; a 404 on every path (a resource type never created on this server, the
// steady state for a custom collection like tracks before anything is ever saved to it) also
// resolves to [] rather than undefined, since the server plainly responded, it just has nothing
// there. onError fires for a reachable path that answers with a non-OK status other than 404.
export async function fetchKeyedResource<T>(
  base: string,
  paths: readonly string[],
  token: string | undefined,
  mapEntry: (id: string, raw: unknown) => T | undefined,
  onError?: (url: string, status: number) => void,
): Promise<T[] | undefined> {
  let sawNotFound = false;
  for (const path of paths) {
    const out = await tryKeyedResource(`${base}${path}`, token, mapEntry, onError);
    if (out === 'not-found') {
      sawNotFound = true;
      continue;
    }
    if (out) return out;
  }
  return sawNotFound ? [] : undefined;
}

async function tryKeyedResource<T>(
  url: string,
  token: string | undefined,
  mapEntry: (id: string, raw: unknown) => T | undefined,
  onError?: (url: string, status: number) => void,
): Promise<T[] | 'not-found' | undefined> {
  try {
    const response = await fetch(url, withTimeout(authInit(token)));
    if (response.status === 404) return 'not-found';
    if (!response.ok) {
      onError?.(url, response.status);
      return undefined;
    }
    const keyed = asKeyedObject(await readBoundedJson<unknown>(response));
    if (!keyed) return undefined;
    const out: T[] = [];
    for (const [id, raw] of Object.entries(keyed)) {
      const mapped = mapEntry(id, raw);
      if (mapped !== undefined) out.push(mapped);
    }
    return out;
  } catch {
    return undefined;
  }
}

// A single app-wide observer of write outcomes. Every write goes through sendJson, so this is the one
// chokepoint where a read-only token reveals itself: an authenticated session whose write returns
// 401/403 has read-only access. The auth controller registers a listener to flip its writeBlocked flag,
// and a later 2xx write clears it. Kept as a module callback (not a parameter) so the dozens of write
// call sites need no change.
let writeOutcomeListener: WriteOutcomeListener | undefined;
export function setWriteOutcomeListener(listener: WriteOutcomeListener | undefined): void {
  writeOutcomeListener = listener;
}

// Send a JSON body (or no body) to a URL and return the raw Response, or undefined on a network
// failure. Never throws. Shared by putResource and the notifications client so the
// fetch-plus-timeout-plus-auth-plus-try/catch shape lives in one place.
export async function sendJson(
  url: string,
  token: string | undefined,
  method: string,
  body?: unknown,
): Promise<Response | undefined> {
  return new SignalKResourceClient({
    getToken: () => token,
    onWriteOutcome: (ok, status) => writeOutcomeListener?.(ok, status),
  }).sendJson(url, method, body);
}

// What a resource write actually did, for the callers that can recover from the specific cause
// rather than only reporting "it failed". `access-denied` is the one worth separating: a token
// revoked or a session expired mid-passage is recoverable by asking the server for write access
// again, and the caller can keep the navigator's typing on screen while that happens.
export type ResourceMutationResult = 'ok' | 'access-denied' | 'unavailable' | 'failed';

// The one wording for a refused write, so the routes, waypoints, tracks, and notes flows all say
// the same thing about the same server answer. It lives beside the outcome it explains: the point
// of separating `access-denied` is that this sentence is true and "could not save" is not.
export function writeRefusedMessage(noun: string): string {
  return `Signal K refused the write. Your ${noun} is kept while read and write access is requested.`;
}

// The delete counterpart. A delete has no draft to keep, so it says less; it is here for the same
// reason as its sibling, which is that one server answer should read the same everywhere.
export function deleteRefusedMessage(): string {
  return 'Signal K refused the delete. Read and write access is being requested.';
}

// Turn a write outcome into a message and, when the server refused, into a fresh access request.
// Returns whether the write landed, so a caller reads as `if (!accepted(outcome, ...)) return;`.
// Built once per controller against its own reporter and re-request, because the routes, waypoints,
// and tracks controllers each spelled this branch by hand and the refusal arm is what a hand-rolled
// copy forgets: without the re-request, a token revoked mid-passage never recovers.
export function createWriteOutcomeGate(deps: {
  report: (message: string) => void;
  requestWriteAccess: () => Promise<void>;
}) {
  return function accepted(
    outcome: ResourceMutationResult,
    refused: string,
    failed: string,
  ): outcome is 'ok' {
    if (outcome === 'ok') return true;
    if (outcome === 'access-denied') void deps.requestWriteAccess();
    deps.report(outcome === 'access-denied' ? refused : failed);
    return false;
  };
}

// Undefined means the request never completed (a network failure or a timeout), which is transient,
// not a refusal.
export function mutationResultFor(response: Response | undefined): ResourceMutationResult {
  if (response?.ok) return 'ok';
  if (response?.status === 401 || response?.status === 403) return 'access-denied';
  if (response?.status === 404 || response?.status === 405) return 'unavailable';
  return 'failed';
}

// PUT a JSON body to a resource URL, returning whether the write succeeded. Never throws: a network
// failure becomes false so the caller can surface a transient error rather than crash.
export async function putResource(
  url: string,
  token: string | undefined,
  body: unknown,
): Promise<boolean> {
  return (await sendJson(url, token, 'PUT', body))?.ok ?? false;
}

// PUT as above, reporting why it failed. Prefer this wherever the caller has a draft to preserve.
export async function putResourceOutcome(
  url: string,
  token: string | undefined,
  body: unknown,
): Promise<ResourceMutationResult> {
  return mutationResultFor(await sendJson(url, token, 'PUT', body));
}

// DELETE as below, reporting why it failed.
export async function deleteResourceOutcome(
  url: string,
  token: string | undefined,
): Promise<ResourceMutationResult> {
  return mutationResultFor(await sendJson(url, token, 'DELETE'));
}

// POST a JSON body (or no body) to a URL, returning whether it succeeded. Never throws (see
// putResource). Routes through sendJson so the write-outcome listener observes the status, which is
// how a read-only token reveals itself on a write.
export async function postResource(
  url: string,
  token: string | undefined,
  body?: unknown,
): Promise<boolean> {
  return (await sendJson(url, token, 'POST', body))?.ok ?? false;
}

// DELETE a resource URL, returning whether it succeeded. Never throws (see putResource).
export async function deleteResource(url: string, token: string | undefined): Promise<boolean> {
  return (await sendJson(url, token, 'DELETE'))?.ok ?? false;
}
