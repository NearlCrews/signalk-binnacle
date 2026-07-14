import { fetchJsonOrUndefined, withTimeout } from '$shared/lib';

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

// Best-effort authenticated GET returning parsed JSON, or undefined on any non-OK status, network
// failure, timeout, or parse error. The bearer-auth GET-then-degrade shape recurs across the
// applicationData, trails, notes-detail, and tides clients; this is its single home.
export function fetchAuthedJson<T>(url: string, token: string | undefined): Promise<T | undefined> {
  return fetchJsonOrUndefined<T>(url, authInit(token));
}

// Best-effort authenticated GET returning the response text, or undefined on any non-OK status,
// network failure, or timeout. The text sibling of fetchAuthedJson, for SVG symbol bodies.
export async function fetchAuthedText(
  url: string,
  token: string | undefined,
): Promise<string | undefined> {
  try {
    const response = await fetch(url, withTimeout(authInit(token)));
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

// The Signal K resources API returns a keyed object (id to record). An error envelope
// ({state, statusCode, message}) or an array arriving with a 200 is not that shape, so reject it:
// every resource client shares this guard so a malformed body never flows on as bogus records.
export function asKeyedObject(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return body as Record<string, unknown>;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return out.length > 0 ? out : undefined;
}

// Parse a Response body as JSON, falling back to a default when there is no JSON to parse (an empty
// 204, a non-JSON error page). Never throws. Shared by the resource clients so the
// parse-JSON-or-default idiom is spelled once rather than re-rolled as `.json().catch(...)` per client.
export async function jsonOr<T>(response: Response, fallback: T): Promise<T> {
  try {
    return (await response.json()) as T;
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
    const keyed = asKeyedObject(await response.json());
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
type WriteOutcomeListener = (ok: boolean, status: number) => void;
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
  try {
    const response = await fetch(
      url,
      withTimeout(
        authInit(token, {
          method,
          ...(body !== undefined
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
        }),
      ),
    );
    writeOutcomeListener?.(response.ok, response.status);
    return response;
  } catch {
    return undefined;
  }
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
