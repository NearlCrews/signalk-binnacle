import { expect, vi } from 'vitest';

// A minimal JSON Response stub for the REST client tests: ok is derived from the status, and json()
// resolves to the given body. Shared so the client tests do not each hand-roll the same shape.
// Imported by *.test.ts files only.
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Test-only fetch stub shared by the REST client tests: stubs the global fetch with a mock that
// answers { ok, body } or throws on 'reject', returning the mock for call assertions. Set rejectJson
// to make response.json() throw, modeling a 200 with an empty or invalid body (which real Response
// rejects on), so a client's parse-degrade path can be exercised. Callers own the
// vi.unstubAllGlobals() in their afterEach. Imported by *.test.ts files only.
export function stubFetch(
  response: { ok: boolean; status?: number; body?: unknown; rejectJson?: boolean } | 'reject',
) {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response === 'reject') throw new TypeError('network down');
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => {
        if (response.rejectJson) throw new SyntaxError('Unexpected end of JSON input');
        return response.body;
      },
    } as Response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

// Asserts a captured fetch call's Authorization header, shared so client tests do not each
// re-derive the RequestInit.headers cast.
export function expectBearerAuth(init: RequestInit | undefined, token: string) {
  const headers = init?.headers as Record<string, string> | undefined;
  expect(headers?.Authorization).toBe(`Bearer ${token}`);
}
