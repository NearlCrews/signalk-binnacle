import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandoffSnapshot } from '$entities/handoff';
import { PersistedValue } from '$shared/settings';
import { createFakeStorage } from '$shared/testing';
import type { HandoffClient, HandoffLoadResult } from './handoff-client';
import { createHandoffController } from './handoff-controller.svelte';

function drafts(): PersistedValue<HandoffSnapshot[]> {
  return new PersistedValue<HandoffSnapshot[]>('binnacle:handoff-test', [], createFakeStorage());
}

function fakeClient(overrides: Partial<HandoffClient> = {}): HandoffClient {
  return {
    load: vi.fn(async (): Promise<HandoffLoadResult> => ({ state: 'ok', snapshots: [] })),
    post: vi.fn(async () => true),
    prune: vi.fn(async () => undefined),
    ...overrides,
  };
}

function controllerWith(client: HandoffClient, queue = drafts()) {
  let at = 1_000;
  const controller = createHandoffController({
    client: () => client,
    collectFacts: () => [{ label: 'GPS fix', value: 'live, 2s ago' }],
    drafts: queue,
    now: () => (at += 1_000),
  });
  cleanups.push(() => controller.dispose());
  return { controller, queue };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

describe('handoff controller', () => {
  it('retains an accepted snapshot when an older in-flight server read finishes', async () => {
    let finish!: (result: HandoffLoadResult) => void;
    const load = vi.fn(
      () =>
        new Promise<HandoffLoadResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { controller, queue } = controllerWith(fakeClient({ load }));
    const refreshing = controller.refresh();
    controller.create('Accepted while the old read was pending.');
    await vi.waitFor(() => expect(queue.value).toHaveLength(0));
    finish({
      state: 'ok',
      snapshots: [{ id: 'other-station', createdAt: 1_000, note: 'Earlier report', facts: [] }],
    });
    await refreshing;
    expect(controller.records.map((entry) => entry.note)).toEqual([
      'Accepted while the old read was pending.',
      'Earlier report',
    ]);
    expect(controller.records.every((entry) => entry.sync === 'shared')).toBe(true);
  });
  it('recovers from a long server outage without needing a browser online event', async () => {
    vi.useFakeTimers();
    let available = false;
    const post = vi.fn(async () => available);
    const { controller, queue } = controllerWith(fakeClient({ post }));
    controller.create('Keep retrying this draft.');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(post.mock.calls.length).toBeLessThan(12);
    expect(queue.value).toHaveLength(1);
    available = true;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(queue.value).toHaveLength(0);
  });
  it('backs off failed uploads and stops retries on disposal', async () => {
    vi.useFakeTimers();
    const post = vi.fn(async () => false);
    const { controller } = controllerWith(fakeClient({ post }));
    controller.create('Keep this draft.');
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('drains a draft added while an older upload is in flight', async () => {
    let finish!: (value: boolean) => void;
    const first = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const post = vi.fn<HandoffClient['post']>().mockReturnValueOnce(first).mockResolvedValue(true);
    const { controller, queue } = controllerWith(fakeClient({ post }));
    controller.create('first');
    controller.create('second');
    expect(post).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.waitFor(() => expect(queue.value).toHaveLength(0));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('creates a snapshot offline, keeps it as a device draft, and syncs it on retry', async () => {
    const post = vi
      .fn<HandoffClient['post']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { controller } = controllerWith(fakeClient({ post }));
    controller.create('Wind building.');
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    expect(controller.records).toHaveLength(1);
    expect(controller.records[0]?.sync).toBe('device-only');
    expect(controller.records[0]?.note).toBe('Wind building.');
    expect(controller.records[0]?.facts).toEqual([{ label: 'GPS fix', value: 'live, 2s ago' }]);

    // The reconnect edge: the composition root calls syncDrafts again and the draft is promoted.
    await controller.syncDrafts();
    expect(controller.records[0]?.sync).toBe('shared');
  });

  it('marks drafts device-only when the shared store is unavailable', async () => {
    const { controller } = controllerWith(
      fakeClient({
        load: vi.fn(async (): Promise<HandoffLoadResult> => ({ state: 'unavailable' })),
        post: vi.fn(async () => false),
      }),
    );
    await controller.refresh();
    controller.create('');
    await vi.waitFor(() => expect(controller.records).toHaveLength(1));
    expect(controller.records[0]?.sync).toBe('device-only');
  });

  it('merges snapshots from other stations with local drafts, newest first', async () => {
    const other: HandoffSnapshot = {
      id: 'station-b',
      createdAt: 999_999,
      note: 'From the flybridge.',
      facts: [],
    };
    const { controller } = controllerWith(
      fakeClient({
        load: vi.fn(async (): Promise<HandoffLoadResult> => ({ state: 'ok', snapshots: [other] })),
        post: vi.fn(async () => false),
      }),
    );
    await controller.refresh();
    controller.create('Local note.');
    await vi.waitFor(() => expect(controller.records).toHaveLength(2));
    expect(controller.records.map((record) => record.sync)).toEqual(['shared', 'device-only']);
    expect(controller.records[0]?.id).toBe('station-b');
  });

  it('never re-lists a synced draft twice and preserves queue order on partial failure', async () => {
    const post = vi
      .fn<HandoffClient['post']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(true);
    const { controller, queue } = controllerWith(fakeClient({ post }));
    controller.create('first');
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    controller.create('second');
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(queue.value).toHaveLength(2);

    // The retry posts oldest first; both eventually clear the queue and appear once each.
    await controller.syncDrafts();
    expect(post.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(queue.value).toHaveLength(0);
    expect(controller.records).toHaveLength(2);
    expect(controller.records.map((record) => record.note)).toEqual(['second', 'first']);
    expect(controller.records.every((record) => record.sync === 'shared')).toBe(true);
  });
});
