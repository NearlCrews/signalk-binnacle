import { expect, vi } from 'vitest';

// A minimal JSON Response stub for the REST client tests: ok is derived from the status, and json()
// and text() expose the same body. Shared so clients can test bounded text parsing as well as direct
// JSON reads without each hand-rolling the same shape.
// Imported by *.test.ts files only.
export function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'Content-Length': String(text.length) }),
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

interface StubResponse {
  ok: boolean;
  status?: number;
  body?: unknown;
  rejectJson?: boolean;
}

// Test-only fetch stub shared by the REST client tests: stubs the global fetch with a mock that
// answers { ok, body } or throws on 'reject', returning the mock for call assertions. Set rejectJson
// to make response.json() throw, modeling a 200 with an empty or invalid body (which real Response
// rejects on), so a client's parse-degrade path can be exercised. Pass a function instead to answer
// per URL, which is what a client that probes several routes to pick one needs. Callers own the
// vi.unstubAllGlobals() in their afterEach. Imported by *.test.ts files only.
export function stubFetch(response: StubResponse | 'reject' | ((url: string) => StubResponse)) {
  const mock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (response === 'reject') throw new TypeError('network down');
    const answer = typeof response === 'function' ? response(url) : response;
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 500),
      json: async () => {
        if (answer.rejectJson) throw new SyntaxError('Unexpected end of JSON input');
        return answer.body;
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
