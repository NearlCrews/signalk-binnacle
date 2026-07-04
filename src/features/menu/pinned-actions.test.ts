import { describe, expect, it } from 'vitest';
import type { MenuItem } from './menu-item';
import {
  DEFAULT_PINNED,
  MAX_BAR_PILLS,
  resolvePinned,
  splitBarActions,
  togglePinned,
} from './pinned-actions';

const noop = () => {};
const item = (id: string): MenuItem => ({ id, label: id, onSelect: noop });
const registry: MenuItem[] = ['center', 'follow', 'layers', 'anchor', 'forecast'].map(item);

describe('resolvePinned', () => {
  it('returns matches in registry (canonical) order, not pin order', () => {
    expect(resolvePinned(registry, ['anchor', 'center']).map((i) => i.id)).toEqual([
      'center',
      'anchor',
    ]);
  });

  it('skips ids with no matching action', () => {
    expect(resolvePinned(registry, ['center', 'radar', 'layers']).map((i) => i.id)).toEqual([
      'center',
      'layers',
    ]);
  });

  it('treats a non-array input as empty (a corrupt or cross-version document)', () => {
    expect(resolvePinned(registry, undefined)).toEqual([]);
    expect(resolvePinned(registry, { junk: true } as unknown)).toEqual([]);
    expect(resolvePinned(registry, 'abc' as unknown)).toEqual([]);
  });

  it('drops non-string elements rather than matching on them', () => {
    expect(resolvePinned(registry, [1, 2] as unknown)).toEqual([]);
  });

  it('deduplicates a repeated id (each action renders once)', () => {
    expect(resolvePinned(registry, ['center', 'center']).map((i) => i.id)).toEqual(['center']);
  });

  it('returns the empty array for an empty pin list', () => {
    expect(resolvePinned(registry, [])).toEqual([]);
  });
});

describe('DEFAULT_PINNED', () => {
  it('is Center, Follow, Charts (the layers action), and Instruments', () => {
    expect([...DEFAULT_PINNED]).toEqual(['center', 'follow', 'layers', 'instruments']);
  });
});

describe('splitBarActions', () => {
  const actions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(item);

  it('shows all when under the cap', () => {
    const r = splitBarActions(actions.slice(0, 3), MAX_BAR_PILLS);
    expect(r.visible.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(r.overflow).toEqual([]);
  });

  it('shows all when exactly at the cap', () => {
    const r = splitBarActions(actions.slice(0, MAX_BAR_PILLS), MAX_BAR_PILLS);
    expect(r.visible.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(r.overflow).toEqual([]);
  });

  it('reserves one slot for More when over the cap', () => {
    const r = splitBarActions(actions, MAX_BAR_PILLS);
    expect(r.visible.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.overflow.map((i) => i.id)).toEqual(['f', 'g']);
  });

  it('MAX_BAR_PILLS is 6', () => {
    expect(MAX_BAR_PILLS).toBe(6);
  });
});

describe('togglePinned', () => {
  it('appends an unpinned id', () => {
    expect(togglePinned(['center'], 'anchor')).toEqual(['center', 'anchor']);
  });

  it('removes a pinned id', () => {
    expect(togglePinned(['center', 'anchor'], 'anchor')).toEqual(['center']);
  });

  it('does not mutate the input', () => {
    const ids = ['center'];
    togglePinned(ids, 'anchor');
    expect(ids).toEqual(['center']);
  });
});
