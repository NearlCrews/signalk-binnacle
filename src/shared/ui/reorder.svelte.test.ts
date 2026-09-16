import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReorder, type ReorderItem } from './reorder.svelte';

// The animation-frame pair is not available in the Node test environment; stub both so the refocus
// scheduling inside handleKeydown does not throw, recording the handles rather than running the
// callback (focus behavior is not asserted here).
const scheduled: number[] = [];
const cancelled: number[] = [];
let nextFrame = 0;

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => {
    nextFrame += 1;
    scheduled.push(nextFrame);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    cancelled.push(handle);
  });
});

beforeEach(() => {
  scheduled.length = 0;
  cancelled.length = 0;
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
  it('offers the same bounded and announced movement to individual pointer taps', () => {
    const commit = vi.fn();
    const r = createReorder({
      getItems: () => makeItems(3),
      getListEl: () => undefined,
      commit,
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
      clampSlot: (_items, _id, slot) => Math.max(1, slot),
    });
    expect(r.canMove('item-1', -1)).toBe(false);
    expect(r.canMove('item-1', 1)).toBe(true);
    r.moveBy('item-1', -1);
    expect(commit).not.toHaveBeenCalled();
    r.moveBy('item-1', 1);
    expect(commit).toHaveBeenCalledExactlyOnceWith('item-1', 2);
    expect(r.reorderAnnouncement).toBe('Moved Item 1 to position 3 of 3.');
    expect(r.canMove('missing', 1)).toBe(false);
    expect(r.canMove('item-2', 1)).toBe(false);
  });
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

  it('cancels the pending refocus frame when a second move supersedes it', () => {
    const items = makeItems(3);
    const r = createReorder({
      getItems: () => items,
      getListEl: () => undefined,
      commit: () => {},
      rowAttribute: 'data-row',
      handleSelector: '.handle',
      itemNoun: 'Item',
    });

    r.handleKeydown('item-0', fakeKey('ArrowDown'));
    r.handleKeydown('item-1', fakeKey('ArrowDown'));

    expect(scheduled).toHaveLength(2);
    expect(cancelled).toEqual([scheduled[0]]);
  });
});
