import { describe, expect, it, vi } from 'vitest';
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
  return { controller, queue };
}

describe('handoff controller', () => {
  it('creates a snapshot offline, keeps it as a device draft, and syncs it on retry', async () => {
    const post = vi
      .fn<HandoffClient['post']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { controller } = controllerWith(fakeClient({ post }));
    controller.create('Wind building.');
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    expect(controller.records).toHaveLength(1);
    expect(controller.records[0]?.sync).toBe('pending');
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
    expect(controller.records.map((record) => record.sync)).toEqual(['shared', 'pending']);
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
