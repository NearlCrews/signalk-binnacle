import { describe, expect, it } from 'vitest';
import { readBoundedJson, readBoundedText } from './bounded-json';

describe('readBoundedJson', () => {
  it('parses a chunked response within the byte limit', async () => {
    const response = new Response(JSON.stringify({ ok: true }));
    await expect(readBoundedJson(response, 64)).resolves.toEqual({ ok: true });
  });

  it('rejects an oversized declared response before reading it', async () => {
    const response = new Response('{}', { headers: { 'Content-Length': '65' } });
    await expect(readBoundedJson(response, 64)).rejects.toThrow('JSON response is too large');
  });

  it('rejects an oversized chunked response', async () => {
    const response = new Response(JSON.stringify({ value: 'x'.repeat(128) }));
    await expect(readBoundedJson(response, 64)).rejects.toThrow('JSON response is too large');
  });

  it('rejects malformed length and UTF-8 data', async () => {
    await expect(
      readBoundedJson(new Response('{}', { headers: { 'Content-Length': '1e3' } })),
    ).rejects.toThrow('invalid JSON response length');
    await expect(
      readBoundedJson(new Response(new Uint8Array([0xc3, 0x28]))),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('readBoundedText', () => {
  it('reads valid UTF-8 text within the limit', async () => {
    await expect(readBoundedText(new Response('radar'), 8)).resolves.toBe('radar');
  });

  it('rejects oversized and invalid UTF-8 text', async () => {
    await expect(readBoundedText(new Response('too large'), 4)).rejects.toThrow('too large');
    await expect(
      readBoundedText(new Response(new Uint8Array([0xc3, 0x28])), 8),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
