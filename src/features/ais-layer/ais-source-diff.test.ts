import { describe, expect, it } from 'vitest';
import type { AisTargetView } from '$entities/ais';
import { CLEAR_RANK, DANGER_RANK } from './ais-severity';
import { createAisSourceDiffer, iconIdFor, targetFeature } from './ais-source-diff';

const clearRank = (): number => CLEAR_RANK;

function view(overrides: Partial<AisTargetView> = {}): AisTargetView {
  return {
    id: 'vessels.a',
    kind: 'vessel',
    position: { latitude: 1, longitude: 2 },
    ...overrides,
  };
}

describe('iconIdFor', () => {
  it('maps each kind to its registered image', () => {
    expect(iconIdFor(view())).toBe('binnacle-ais-icon');
    expect(iconIdFor(view({ kind: 'aton' }))).toBe('binnacle-ais-aton-icon');
    expect(iconIdFor(view({ kind: 'aton', virtual: true }))).toBe('binnacle-ais-aton-virtual-icon');
    expect(iconIdFor(view({ kind: 'sar' }))).toBe('binnacle-ais-sar-icon');
  });
});

describe('targetFeature', () => {
  it('carries the id, name, heading, icon, and severity rank the layers read', () => {
    const feature = targetFeature(view({ name: 'Wanderer', cogRad: Math.PI }), DANGER_RANK);
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
    expect(feature.properties).toEqual({
      id: 'vessels.a',
      name: 'Wanderer',
      heading: 180,
      icon: 'binnacle-ais-icon',
      severityRank: DANGER_RANK,
    });
  });
});

describe('createAisSourceDiffer', () => {
  it('returns none for an empty list and a full paint for the first targets', () => {
    const differ = createAisSourceDiffer();
    expect(differ.next([], clearRank)).toEqual({ kind: 'none' });
    const update = differ.next([view(), view({ id: 'vessels.b' })], clearRank);
    expect(update.kind).toBe('full');
    if (update.kind === 'full') expect(update.features).toHaveLength(2);
  });

  it('returns none while nothing changed', () => {
    const differ = createAisSourceDiffer();
    const views = [view(), view({ id: 'vessels.b' })];
    differ.next(views, clearRank);
    expect(differ.next(views, clearRank)).toEqual({ kind: 'none' });
  });

  it('ships a sparse add, geometry update, and remove for a minority change', () => {
    const differ = createAisSourceDiffer();
    const a = view();
    const rest = ['b', 'c', 'd', 'e', 'f', 'g'].map((suffix) => view({ id: `vessels.${suffix}` }));
    differ.next([a, ...rest], clearRank);

    const moved = view({ position: { latitude: 1.5, longitude: 2 } });
    const update = differ.next([moved, ...rest.slice(0, 5), view({ id: 'vessels.h' })], clearRank);
    expect(update.kind).toBe('diff');
    if (update.kind !== 'diff') return;
    expect(update.diff.remove).toEqual(['vessels.g']);
    expect(update.diff.add).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ id: 'vessels.h' }) }),
    ]);
    expect(update.diff.update).toEqual([
      { id: 'vessels.a', newGeometry: { type: 'Point', coordinates: [2, 1.5] } },
    ]);
  });

  it('ships only the drifted properties for a same-position change', () => {
    const differ = createAisSourceDiffer();
    const before = [view({ name: 'Old' }), view({ id: 'vessels.b' }), view({ id: 'vessels.c' })];
    differ.next(before, clearRank);

    const renamed = view({ name: 'New' });
    const update = differ.next([renamed, before[1], before[2]], clearRank);
    expect(update).toEqual({
      kind: 'diff',
      diff: {
        update: [{ id: 'vessels.a', addOrUpdateProperties: [{ key: 'name', value: 'New' }] }],
      },
    });
  });

  it('ships a rank change even when the view object is unchanged', () => {
    const differ = createAisSourceDiffer();
    const views = [view(), view({ id: 'vessels.b' }), view({ id: 'vessels.c' })];
    differ.next(views, clearRank);

    const update = differ.next(views, (id) => (id === 'vessels.a' ? DANGER_RANK : CLEAR_RANK));
    expect(update).toEqual({
      kind: 'diff',
      diff: {
        update: [
          { id: 'vessels.a', addOrUpdateProperties: [{ key: 'severityRank', value: DANGER_RANK }] },
        ],
      },
    });
  });

  it('returns none for a fresh view whose rendered fields are unchanged', () => {
    const differ = createAisSourceDiffer();
    differ.next([view({ destination: 'OLD PORT' })], clearRank);
    // A revision bump can rebuild the view over detail-panel fields the chart never renders.
    expect(differ.next([view({ destination: 'NEW PORT' })], clearRank)).toEqual({ kind: 'none' });
  });

  it('falls back to a full paint when more than half the list changed', () => {
    const differ = createAisSourceDiffer();
    const views = ['a', 'b', 'c', 'd'].map((suffix) => view({ id: `vessels.${suffix}` }));
    differ.next(views, clearRank);

    const moved = views.map((target, index) =>
      index < 3 ? view({ id: target.id, position: { latitude: 9, longitude: 2 } }) : target,
    );
    const update = differ.next(moved, clearRank);
    expect(update.kind).toBe('full');
    if (update.kind === 'full') expect(update.features).toHaveLength(4);
  });

  it('paints everything as removed when the list empties', () => {
    const differ = createAisSourceDiffer();
    differ.next([view()], clearRank);
    const update = differ.next([], clearRank);
    expect(update.kind).toBe('full');
    if (update.kind === 'full') expect(update.features).toHaveLength(0);
  });

  it('reset forgets the shipped state so the next pass repaints in full', () => {
    const differ = createAisSourceDiffer();
    const views = [view(), view({ id: 'vessels.b' })];
    differ.next(views, clearRank);
    differ.reset();
    expect(differ.next(views, clearRank).kind).toBe('full');
  });
});
