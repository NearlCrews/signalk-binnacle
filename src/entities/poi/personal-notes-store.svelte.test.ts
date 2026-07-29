import { describe, expect, it } from 'vitest';
import type { NotePoint } from './note-point';
import { PersonalNotesStore } from './personal-notes-store.svelte';

const note = (id: string, name = id, longitude = 0): NotePoint => ({
  id,
  name,
  position: { latitude: 0, longitude },
  category: 'generic',
  ownedByBinnacle: true,
});

describe('PersonalNotesStore', () => {
  it('overrides stale provider notes and suppresses confirmed deletes', () => {
    const store = new PersonalNotesStore();
    store.upsert(note('edit', 'New'));
    store.remove(note('gone'));
    expect(
      store.merge([note('edit', 'Old'), note('gone'), note('other')], [-1, -1, 1, 1], 10),
    ).toEqual([note('edit', 'New'), note('other')]);
  });

  it('keeps mutations through failure and retires only exact successful refresh outcomes', () => {
    const store = new PersonalNotesStore();
    store.upsert(note('edit', 'New'));
    store.remove(note('gone'));
    store.reconcile([note('edit', 'Old')], [-1, -1, 1, 1], true);
    expect(store.hasUpsert('edit')).toBe(true);
    expect(store.hasDeletion('gone')).toBe(false);

    store.reconcile([note('edit', 'New')], [-1, -1, 1, 1], true);
    expect(store.hasUpsert('edit')).toBe(false);
  });

  it('includes only local notes in the current viewport and honors the result cap', () => {
    const store = new PersonalNotesStore();
    store.upsert(note('inside', 'Inside', 0));
    store.upsert(note('outside', 'Outside', 10));
    expect(store.merge([note('provider')], [-1, -1, 1, 1], 1)).toEqual([
      note('inside', 'Inside', 0),
    ]);
  });

  it('suppresses a stale provider position after a confirmed move leaves the viewport', () => {
    const store = new PersonalNotesStore();
    store.upsert(note('moved', 'Moved', 10));
    expect(store.merge([note('moved', 'Old position', 0)], [-1, -1, 1, 1], 10)).toEqual([]);
  });
});
