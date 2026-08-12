import { describe, expect, it } from 'vitest';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { NotificationsStore } from './notifications.svelte';

function frame(self: Record<string, unknown>): SKFrame {
  return {
    self: new Map(Object.entries(self)) as SKFrame['self'],
    connection: { phase: 'open', attempt: 0 },
    epoch: 1000,
  };
}

function setup(self: Record<string, unknown>) {
  const store = new SignalKStore();
  store.applyFrame(frame(self));
  return { store, notifications: new NotificationsStore(store) };
}

describe('NotificationsStore', () => {
  it('lists only raised notifications, sorted by severity then path', () => {
    const { notifications } = setup({
      'notifications.b.warned': { state: 'warn', method: [], message: 'Warned' },
      'notifications.quiet': { state: 'normal', method: [], message: 'All clear' },
      'notifications.a.alarmed': { state: 'alarm', method: ['sound'], message: 'Alarmed' },
      'notifications.mob': { state: 'emergency', method: ['visual', 'sound'], message: 'MOB' },
      'notifications.advisory': { state: 'alert', method: ['visual'], message: 'Heads up' },
    });
    expect(notifications.list().map((n) => n.path)).toEqual([
      'notifications.mob',
      'notifications.a.alarmed',
      'notifications.b.warned',
      'notifications.advisory',
    ]);
  });

  it('carries the v2 id, status fields, and timestamps when present', () => {
    const { notifications } = setup({
      'notifications.navigation.anchor': {
        state: 'alarm',
        method: ['visual', 'sound'],
        message: 'Anchor drag',
        id: 'abc-123',
        createdAt: '2026-06-12T08:00:00Z',
        status: {
          silenced: true,
          acknowledged: true,
          acknowledgedAt: '2026-06-12T08:05:00Z',
          canSilence: true,
          canAcknowledge: true,
        },
      },
    });
    const [n] = notifications.list();
    expect(n).toMatchObject({
      id: 'abc-123',
      timestamp: '2026-06-12T08:00:00Z',
      silenced: true,
      acknowledged: true,
      acknowledgedAt: '2026-06-12T08:05:00Z',
      canSilence: true,
      canAcknowledge: true,
    });
  });

  it('leaves the optional fields undefined for a bare v1 notification', () => {
    const { notifications } = setup({
      'notifications.x': { state: 'warn', method: ['visual'], message: 'Bare' },
    });
    const [n] = notifications.list();
    expect(n.id).toBeUndefined();
    expect(n.timestamp).toBeUndefined();
    expect(n.silenced).toBeUndefined();
    expect(n.acknowledged).toBeUndefined();
    expect(n.acknowledgedAt).toBeUndefined();
  });

  it('distinguishes an absent or malformed method from an explicitly empty one', () => {
    // Only an explicitly empty array asks for no delivery method. Every malformed shape parses to
    // undefined, which the audible-alarm predicate reads as the safe default: sound it. An array
    // of only unrecognized entries is the trap, since filtering it to [] would mute a real alarm.
    const { notifications } = setup({
      'notifications.absent': { state: 'alarm', message: 'No method field' },
      'notifications.empty': { state: 'alarm', method: [], message: 'Explicitly empty' },
      'notifications.junk': { state: 'alarm', method: 'sound', message: 'Not an array' },
      'notifications.unknown': { state: 'alarm', method: ['audio'], message: 'Unrecognized entry' },
      'notifications.partial': {
        state: 'alarm',
        method: ['audio', 'sound'],
        message: 'One recognized entry',
      },
    });
    const byPath = new Map(notifications.list().map((n) => [n.path, n.method]));
    expect(byPath.get('notifications.absent')).toBeUndefined();
    expect(byPath.get('notifications.empty')).toEqual([]);
    expect(byPath.get('notifications.junk')).toBeUndefined();
    expect(byPath.get('notifications.unknown')).toBeUndefined();
    expect(byPath.get('notifications.partial')).toEqual(['sound']);
  });

  it('carries the store activation counter, which only a sounding grade advances', () => {
    const { notifications } = setup({
      'notifications.loud': { state: 'alarm', method: ['sound'], message: 'Alarmed' },
      'notifications.quiet': { state: 'warn', method: ['visual'], message: 'Warned' },
    });
    const byPath = new Map(notifications.list().map((n) => [n.path, n.activation]));
    expect(byPath.get('notifications.loud')).toBe(1);
    expect(byPath.get('notifications.quiet')).toBe(0);
  });

  it('cannot advance an activation without moving the list version', () => {
    // The generic alarm re-articulates on the activation sum, and list() is memoized on the store
    // version, so an activation that could move without the version moving would silently strand
    // the memoized list one raise behind. This pins that invariant against a store refactor.
    const store = new SignalKStore();
    const notifications = new NotificationsStore(store);
    const raised = { state: 'alarm', method: ['sound'], message: 'Shoal ahead' };
    store.applyFrame(frame({ 'notifications.x': { ...raised } }));
    const afterFirstRaise = store.notificationsVersion;
    expect(notifications.list()[0].activation).toBe(1);
    // An identical republish neither re-articulates nor rebuilds the list.
    store.applyFrame(frame({ 'notifications.x': { ...raised } }));
    expect(store.cell('notifications.x').activation).toBe(1);
    expect(store.notificationsVersion).toBe(afterFirstRaise);
    // A clear and a re-raise advance the activation, and the version moves with it.
    store.applyFrame(frame({ 'notifications.x': { state: 'normal', method: [] } }));
    store.applyFrame(frame({ 'notifications.x': { ...raised } }));
    expect(store.cell('notifications.x').activation).toBe(2);
    expect(store.notificationsVersion).toBeGreaterThan(afterFirstRaise);
    expect(notifications.list()[0].activation).toBe(2);
  });

  it('skips malformed values without throwing', () => {
    const { notifications } = setup({
      'notifications.bogus': { state: 42, method: 'sound' },
      'notifications.junk-method': { state: 'alarm', method: ['visual', 7], message: 3 },
    });
    const list = notifications.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ path: 'notifications.junk-method', method: ['visual'] });
    expect(list[0].message).toBe('');
  });

  it('memoizes the list until the store version moves', () => {
    const { store, notifications } = setup({
      'notifications.x': { state: 'warn', method: [], message: 'W' },
    });
    const first = notifications.list();
    expect(notifications.list()).toBe(first);
    store.applyFrame(frame({ 'notifications.x': null }));
    expect(notifications.list()).toHaveLength(0);
    expect(notifications.version).toBe(store.notificationsVersion);
  });

  it('removes the MOB notification when the clear value is published', () => {
    // Publish an emergency MOB notification into the store, then clear it with a normal state.
    // The clear matches what mobClearNotification() returns: state 'normal', which the store
    // deletes from the notifications mirror (the mirror holds only raised states).
    const mobPath = 'notifications.mob';
    const store = new SignalKStore();
    store.applyFrame(
      frame({ [mobPath]: { state: 'emergency', method: ['visual', 'sound'], message: 'MOB' } }),
    );
    const notifications = new NotificationsStore(store);
    expect(notifications.list().some((n) => n.path === mobPath)).toBe(true);
    // Publish the clear value: state 'normal' is not a raised grade, so the store removes it.
    store.applyFrame(
      frame({ [mobPath]: { state: 'normal', method: [], message: 'Man overboard cleared' } }),
    );
    expect(notifications.list().some((n) => n.path === mobPath)).toBe(false);
  });
});
