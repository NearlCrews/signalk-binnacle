import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandoffSnapshot } from '$entities/handoff';
import { PersistedValue } from '$shared/settings';
import { createFakeStorage } from '$shared/testing';
import HandoffPanel from './HandoffPanel.svelte';
import { createHandoffController } from './handoff-controller.svelte';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('handoff composer', () => {
  it('retains an unsaved note across closing, canceling discard, and reopening', async () => {
    const controller = createHandoffController({
      client: () => ({
        load: async () => ({ state: 'ok', snapshots: [] }),
        post: async () => false,
        prune: async () => undefined,
      }),
      collectFacts: () => [],
      drafts: new PersistedValue<HandoffSnapshot[]>('test:handoff-panel', [], createFakeStorage()),
      online: () => false,
    });
    const target = document.createElement('div');
    document.body.append(target);
    const props = { controller, onClose: vi.fn() };
    let component = mount(HandoffPanel, { target, props });
    cleanups.push(() => {
      void unmount(component);
      controller.dispose();
      target.remove();
    });
    flushSync();
    const input = target.querySelector('textarea');
    if (!input) throw new Error('Missing handoff note');
    input.value = 'Traffic approaching from the east';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await unmount(component);
    component = mount(HandoffPanel, { target, props });
    flushSync();
    expect(target.querySelector('textarea')?.value).toBe('Traffic approaching from the east');
    const button = (label: string) =>
      [...target.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    button('Discard note')?.click();
    flushSync();
    expect(target.textContent).toContain('Discard this handoff note?');
    button('Cancel')?.click();
    flushSync();
    await vi.waitFor(() => expect(document.activeElement).toBe(button('Discard note')));
    expect(controller.draft).toBe('Traffic approaching from the east');
    button('Take handoff snapshot')?.click();
    flushSync();
    expect(controller.draft).toBe('');
    expect(controller.records[0]?.note).toBe('Traffic approaching from the east');
  });
});
