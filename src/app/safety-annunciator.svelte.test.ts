import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafetyAnnunciator, type SafetyAnnouncement } from './safety-annunciator.svelte';

function item(id: string, rank: number, text: string): SafetyAnnouncement {
  return { id, rank, text };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSafetyAnnunciator', () => {
  it('announces the worst changed message first and queues the rest politely', () => {
    const annunciator = createSafetyAnnunciator();
    annunciator.update([
      item('collision', 1, 'Collision danger: Vessel A.'),
      item('mob', 0, 'Man overboard.'),
      item('shallow', 3, 'Shallow water.'),
    ]);
    expect(annunciator.assertive).toBe('Man overboard.');
    expect(annunciator.polite).toBe('');
    vi.advanceTimersByTime(4_100);
    expect(annunciator.polite).toBe('Collision danger: Vessel A.');
    vi.advanceTimersByTime(4_100);
    expect(annunciator.polite).toBe('Shallow water.');
    annunciator.dispose();
  });

  it('never lets a later worse-ranked message interrupt the urgent holder', () => {
    const annunciator = createSafetyAnnunciator();
    annunciator.update([item('mob', 0, 'Man overboard.')]);
    annunciator.update([
      item('mob', 0, 'Man overboard.'),
      item('notification', 4, 'Alarm: engine over temperature.'),
    ]);
    expect(annunciator.assertive).toBe('Man overboard.');
    vi.advanceTimersByTime(4_100);
    expect(annunciator.polite).toBe('Alarm: engine over temperature.');
    annunciator.dispose();
  });

  it('lets a more urgent later message take the assertive region', () => {
    const annunciator = createSafetyAnnunciator();
    annunciator.update([item('notification', 4, 'Alarm: bilge.')]);
    annunciator.update([
      item('notification', 4, 'Alarm: bilge.'),
      item('mob', 0, 'Man overboard.'),
    ]);
    expect(annunciator.assertive).toBe('Man overboard.');
    annunciator.dispose();
  });

  it('does not re-speak an unchanged message', () => {
    const annunciator = createSafetyAnnunciator();
    annunciator.update([item('collision', 1, 'Collision danger: Vessel A.')]);
    const before = annunciator.assertive;
    annunciator.update([item('collision', 1, 'Collision danger: Vessel A.')]);
    expect(annunciator.assertive).toBe(before);
    annunciator.dispose();
  });

  it('releases the region when the holder resolves and the next change claims it', () => {
    const annunciator = createSafetyAnnunciator();
    annunciator.update([item('mob', 0, 'Man overboard.')]);
    annunciator.update([item('mob', 0, '')]);
    annunciator.update([item('shallow', 3, 'Shallow water.')]);
    expect(annunciator.assertive).toBe('Shallow water.');
    annunciator.dispose();
  });

  it('updates the assertive text when the holder itself changes message', () => {
    const annunciator = createSafetyAnnunciator();
    annunciator.update([item('collision', 1, 'Collision warning: Vessel A.')]);
    annunciator.update([item('collision', 1, 'Collision danger: Vessel A.')]);
    expect(annunciator.assertive).toBe('Collision danger: Vessel A.');
    annunciator.dispose();
  });

  it('does not queue a duplicate polite message', () => {
    const annunciator = createSafetyAnnunciator();
    annunciator.update([item('mob', 0, 'Man overboard.'), item('shallow', 3, 'Shallow water.')]);
    annunciator.update([
      item('mob', 0, 'Man overboard. Range updated.'),
      item('shallow', 3, 'Shallow water.'),
    ]);
    vi.advanceTimersByTime(4_100);
    expect(annunciator.polite).toBe('Shallow water.');
    vi.advanceTimersByTime(8_200);
    expect(annunciator.polite).toBe('Shallow water.');
    annunciator.dispose();
  });
});
