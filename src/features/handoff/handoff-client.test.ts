import { describe, expect, it, vi } from 'vitest';
import type { HandoffSnapshot } from '$entities/handoff';
import { jsonResponse } from '$shared/testing';
import { createHandoffClient } from './handoff-client';

const snapshot: HandoffSnapshot = {
  id: 'abc-123',
  createdAt: 5_000,
  note: 'All quiet.',
  facts: [{ label: 'GPS fix', value: 'live' }],
};

function client(fetchFn: typeof fetch) {
  return createHandoffClient('http://sk', () => 'tok', fetchFn);
}

describe('handoff client', () => {
  it('loads only valid handoff-keyed snapshots from the global document', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        'handoff-abc-123': snapshot,
        'handoff-bad': { id: 'x' },
        unrelated: { keep: 'out' },
      }),
    );
    const result = await client(fetchFn as typeof fetch).load();
    expect(result).toEqual({ state: 'ok', snapshots: [snapshot] });
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://sk/signalk/v1/applicationData/global/signalk-binnacle/1.0.0');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('reports unavailable on a failed or unreachable read', async () => {
    expect(await client((async () => jsonResponse(404, {})) as typeof fetch).load()).toEqual({
      state: 'unavailable',
    });
    expect(
      await client((async () => {
        throw new Error('offline');
      }) as typeof fetch).load(),
    ).toEqual({ state: 'unavailable' });
  });

  it('posts one snapshot as a single id-keyed add, so stations cannot collide', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const accepted = await client(fetchFn as typeof fetch).post(snapshot);
    expect(accepted).toBe(true);
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual([
      { op: 'add', path: '/handoff-abc-123', value: snapshot },
    ]);
  });

  it('prunes only when the stored count exceeds the retention bound, oldest first', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const many = Array.from({ length: 32 }, (_, index) => ({
      ...snapshot,
      id: `s${index}`,
      createdAt: 1_000 + index,
    }));
    await client(fetchFn as typeof fetch).prune(many.slice(0, 20));
    expect(fetchFn).not.toHaveBeenCalled();
    await client(fetchFn as typeof fetch).prune(many);
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const patch = JSON.parse(init.body as string) as Array<{ op: string; path: string }>;
    expect(patch).toEqual([
      { op: 'remove', path: '/handoff-s0' },
      { op: 'remove', path: '/handoff-s1' },
    ]);
  });
});
