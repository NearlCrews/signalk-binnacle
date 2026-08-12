import { describe, expect, it } from 'vitest';
import type { MenuItem } from './menu-item';
import {
  DEFAULT_PINNED,
  MAX_BAR_PILLS,
  MAX_COMPACT_BAR_PILLS,
  reorderPinned,
  resolvePinned,
  splitBarActions,
  togglePinned,
} from './pinned-actions';

const noop = () => {};
const item = (id: string): MenuItem => ({ id, label: id, onSelect: noop });
const registry: MenuItem[] = ['center', 'follow', 'layers', 'anchor', 'forecast'].map(item);

describe('resolvePinned', () => {
  it('returns matches in pinned order', () => {
    expect(resolvePinned(registry, ['anchor', 'center']).map((i) => i.id)).toEqual([
      'anchor',
      'center',
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
    expect(resolvePinned(registry, ['anchor', 'center', 'anchor']).map((i) => i.id)).toEqual([
      'anchor',
      'center',
    ]);
  });

  it('returns the empty array for an empty pin list', () => {
    expect(resolvePinned(registry, [])).toEqual([]);
  });
});

describe('DEFAULT_PINNED', () => {
  it('leads with the Menu opener and keeps one Safety action thumb-reachable', () => {
    expect([...DEFAULT_PINNED]).toEqual(['menu', 'center', 'follow', 'ais']);
    // The phone cap is the default set's own length, so no default is pushed behind More.
    expect(DEFAULT_PINNED).toHaveLength(MAX_COMPACT_BAR_PILLS);
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

  // The phone bar is where hiding an action costs the most, and at a lower cap the reserved More
  // slot buried three of the four defaults behind a second tap.
  it('shows every default pinned action on a phone-width bar', () => {
    const defaults = [...DEFAULT_PINNED].map(item);
    const r = splitBarActions(defaults, MAX_COMPACT_BAR_PILLS);
    expect(r.visible.map((i) => i.id)).toEqual([...DEFAULT_PINNED]);
    expect(r.overflow).toEqual([]);
  });

  it('MAX_COMPACT_BAR_PILLS covers the whole default set', () => {
    expect(MAX_COMPACT_BAR_PILLS).toBe(DEFAULT_PINNED.length);
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

describe('reorderPinned', () => {
  it('moves an id to the requested slot', () => {
    expect(reorderPinned(['center', 'follow', 'layers'], 'layers', 0)).toEqual([
      'layers',
      'center',
      'follow',
    ]);
  });

  it('bounds the requested slot', () => {
    expect(reorderPinned(['center', 'follow', 'layers'], 'center', 99)).toEqual([
      'follow',
      'layers',
      'center',
    ]);
  });

  it('returns the same array when the id is not pinned', () => {
    const ids = ['center', 'follow'];
    expect(reorderPinned(ids, 'layers', 0)).toBe(ids);
  });
});
