import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createReorder, type ReorderItem } from './reorder.svelte';

// requestAnimationFrame is not available in the Node test environment; stub it so the refocus
// call inside handleKeydown does not throw (focus behavior is not asserted here).
beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function makeItems(count: number): ReorderItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, title: `Item ${i}` }));
}

function fakeKey(key: string): KeyboardEvent {
  return { key, preventDefault: () => {} } as unknown as KeyboardEvent;
}

describe('createReorder', () => {
  it('ArrowDown commits id to from + 1 and sets a non-empty announcement', () => {
    const items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: (id, slot) => committed.push({ id, slot }),
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowDown'));

    expect(committed).toEqual([{ id: 'item-0', slot: 1 }]);
    expect(r.reorderAnnouncement).not.toBe('');
  });

  it('ArrowUp at index 0 does not commit', () => {
    const items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: (id, slot) => committed.push({ id, slot }),
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowUp'));

    expect(committed).toHaveLength(0);
  });

  it('clampSlot returning same slot as from suppresses commit', () => {
    const items = makeItems(3);
    const committed: Array<{ id: string; slot: number }> = [];
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: (id, slot) => committed.push({ id, slot }),
      // Always clamp back to index 0, so ArrowDown on item-0 resolves to 0 == from and no-ops.
      clampSlot: (_items, _id, _slot) => 0,
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowDown'));

    expect(committed).toHaveLength(0);
  });
});
