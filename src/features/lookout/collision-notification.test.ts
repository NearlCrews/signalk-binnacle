import { describe, expect, it } from 'vitest';
import type { Assessment, DangerContact } from '$entities/collision';
import { buildNotification, CollisionNotifier, NOTIFICATION_PATH } from './collision-notification';

function contact(over: Partial<DangerContact> = {}): DangerContact {
  return {
    id: 'urn:mrn:imo:mmsi:123',
    name: 'Tug',
    position: { latitude: 36.8, longitude: -121.7 },
    cpaMeters: 463, // 0.25 nm
    tcpaSeconds: 300, // 5 min
    severity: 'danger',
    source: 'computed',
    ...over,
  };
}

describe('buildNotification', () => {
  it('raises an alarm with sound for a danger', () => {
    const a: Assessment = { contacts: [contact()], worst: 'danger', unassessed: [] };
    const n = buildNotification(a);
    expect(n.state).toBe('alarm');
    expect(n.method).toEqual(['visual', 'sound']);
    expect(n.message).toContain('CPA 0.25 nm');
    expect(n.message).toContain('TCPA 5 min');
  });

  it('warns visually for a warning', () => {
    const a: Assessment = {
      contacts: [contact({ severity: 'warning' })],
      worst: 'warning',
      unassessed: [],
    };
    const n = buildNotification(a);
    expect(n.state).toBe('warn');
    expect(n.method).toEqual(['visual']);
  });

  it('returns normal when clear', () => {
    expect(buildNotification({ contacts: [], worst: 'clear', unassessed: [] }).state).toBe(
      'normal',
    );
  });

  it('names an unnamed contact by its MMSI, not the raw context urn', () => {
    const a: Assessment = {
      contacts: [contact({ name: undefined })],
      worst: 'danger',
      unassessed: [],
    };
    const n = buildNotification(a);
    expect(n.message).toContain('123');
    expect(n.message).not.toContain('urn:mrn');
  });
});

describe('CollisionNotifier', () => {
  it('publishes on state change but not on every tick', () => {
    const sent: Array<{ path: string; value: unknown }> = [];
    const notifier = new CollisionNotifier({
      publish: (path, value) => {
        sent.push({ path, value });
      },
    });
    const danger: Assessment = { contacts: [contact()], worst: 'danger', unassessed: [] };

    notifier.update(danger);
    // Same state, id, and coarse CPA/TCPA buckets: a per-tick wobble, not a republish.
    notifier.update({
      contacts: [contact({ cpaMeters: 470, tcpaSeconds: 320 })],
      worst: 'danger',
      unassessed: [],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      path: NOTIFICATION_PATH,
      value: expect.objectContaining({ state: 'alarm' }),
    });
  });

  it('republishes with fresh numbers as the contact closes a coarse bucket', () => {
    const sent: Array<{ value: { message: string } }> = [];
    const notifier = new CollisionNotifier({
      publish: (_path, value) => {
        sent.push({ value: value as { message: string } });
      },
    });
    notifier.update({ contacts: [contact()], worst: 'danger', unassessed: [] }); // CPA 463 m, TCPA 300 s
    notifier.update({
      contacts: [contact({ cpaMeters: 200, tcpaSeconds: 120 })],
      worst: 'danger',
      unassessed: [],
    });
    expect(sent).toHaveLength(2);
    expect(sent[1].value.message).toContain('TCPA 2 min');
    expect(sent[0].value.message).not.toBe(sent[1].value.message);
  });

  it('accepts an async strategy object as the publish transport', () => {
    const sent: Array<{ path: string; value: { state: string } }> = [];
    const notifier = new CollisionNotifier({
      publish: async (path, value) => {
        sent.push({ path, value });
        return true;
      },
    });
    notifier.update({ contacts: [contact()], worst: 'danger', unassessed: [] });
    expect(sent).toEqual([
      { path: NOTIFICATION_PATH, value: expect.objectContaining({ state: 'alarm' }) },
    ]);
  });

  it('does not publish a clear before any active alert, but does after one', () => {
    const sent: Array<{ value: unknown }> = [];
    const notifier = new CollisionNotifier({
      publish: (_path, value) => {
        sent.push({ value });
      },
    });
    const clear: Assessment = { contacts: [], worst: 'clear', unassessed: [] };

    notifier.update(clear); // initial clear: nothing to clear, no publish
    expect(sent).toHaveLength(0);

    notifier.update({ contacts: [contact()], worst: 'danger', unassessed: [] }); // alarm
    notifier.update(clear); // now a real clear
    expect(sent).toHaveLength(2);
    expect(sent[1].value).toMatchObject({ state: 'normal' });
  });
});
