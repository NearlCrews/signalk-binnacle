export const DEFAULT_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;

function declaredLength(response: Response, kind: 'JSON' | 'text'): number | undefined {
  const header = response.headers?.get?.('Content-Length') ?? null;
  if (header === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(header)) throw new TypeError(`invalid ${kind} response length`);
  const length = Number(header);
  if (!Number.isSafeInteger(length)) throw new TypeError(`invalid ${kind} response length`);
  return length;
}

function validateLimit(maxBytes: number, kind: 'JSON' | 'text'): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError(`invalid ${kind} response byte limit`);
  }
}

async function rejectDeclaredOverflow(
  response: Response,
  maxBytes: number,
  kind: 'JSON' | 'text',
): Promise<void> {
  let length: number | undefined;
  try {
    length = declaredLength(response, kind);
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
  if (length !== undefined && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new TypeError(`${kind} response is too large`);
  }
}

async function readStreamText(
  response: Response,
  maxBytes: number,
  kind: 'JSON' | 'text',
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError(`${kind} response has no stream`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new TypeError(`${kind} response is too large`);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  validateLimit(maxBytes, 'text');
  await rejectDeclaredOverflow(response, maxBytes, 'text');
  if (response.body) return readStreamText(response, maxBytes, 'text');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new TypeError('text response is too large');
  }
  return text;
}

// Parse an external JSON response without allowing response.json() to buffer an unbounded body first.
// The Content-Length check rejects oversized declared bodies early, while the streaming count covers
// chunked responses and dishonest or absent length headers. A body-less Response-like test double
// keeps using json(), after the same declared-length check.
//
// T is a caller assertion, NOT a validation: this helper bounds the number of bytes it reads and
// nothing else. Prefer readBoundedJson<unknown> and a type guard at the call site. A concrete T is
// only justified where the caller validates every field it goes on to read.
export async function readBoundedJson<T>(
  response: Response,
  maxBytes: number = DEFAULT_JSON_RESPONSE_BYTES,
): Promise<T> {
  validateLimit(maxBytes, 'JSON');
  await rejectDeclaredOverflow(response, maxBytes, 'JSON');
  if (!response.body) return (await response.json()) as T;
  return JSON.parse(await readStreamText(response, maxBytes, 'JSON')) as T;
}
