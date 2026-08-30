import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActiveNotification } from '$entities/notifications';
import { PersistedValue } from '$shared/settings';
import { createFakeAlarmControl, createFakeStorage } from '$shared/testing';
import { DEFAULT_XTE_LIMIT_METERS, XTE_TONE } from './xte-alarm';
import { createXteMonitor, XTE_HOLD_MS, XTE_LEG_GRACE_MS } from './xte-monitor.svelte';

const serverAlarm = (state: ActiveNotification['state'] = 'alarm'): ActiveNotification => ({
  path: 'notifications.navigation.course.calcValues.crossTrackError',
  state,
  message: 'Vessel is off track.',
  activation: 1,
});

interface Options {
  courseActive?: boolean;
  xteMeters?: number;
}

function harness(options: Options) {
  const state = $state({
    courseActive: options.courseActive ?? true,
    xteMeters: options.xteMeters as number | undefined,
    xteStale: false,
    legKey: 'route-1:0' as string | undefined,
    notifications: [] as ActiveNotification[],
  });
  const clock = $state({ now: 100_000 });
  const { control, events, lastTone } = createFakeAlarmControl();
  const limit = new PersistedValue<number>(
    'binnacle:xte-limit-test',
    DEFAULT_XTE_LIMIT_METERS,
    createFakeStorage(),
  );
  const muted = new PersistedValue<boolean>('binnacle:xte-muted-test', false, createFakeStorage());
  const monitor = createXteMonitor({
    courseActive: () => state.courseActive,
    xteMeters: () => state.xteMeters,
    xteStale: () => state.xteStale,
    legKey: () => state.legKey,
    limit,
    muted,
    notifications: () => state.notifications,
    clock,
    alarm: control,
  });
  return {
    state,
    clock,
    events,
    lastTone,
    monitor,
    // Flush before advancing too, so a state change made just above this call takes effect at the
    // current instant rather than being backdated to the advanced clock.
    tick(ms: number) {
      flushSync();
      clock.now += ms;
      flushSync();
    },
  };
}

const cleanups: Array<() => void> = [];

function mount(options: Options = {}) {
  let test!: ReturnType<typeof harness>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      test = harness(options);
    });
  });
  cleanups.push(() => {
    test.monitor.stop();
    disposeRoot();
  });
  return test;
}

// Clear the activation grace and reach a held, sounding breach. Two ticks, not one jump: the hold
// window starts counting on the first evaluation after the grace ends, so the windows never overlap.
function mountSounding(xteMeters = 150) {
  const test = mount({ xteMeters });
  test.tick(XTE_LEG_GRACE_MS);
  test.tick(XTE_HOLD_MS);
  expect(test.events).toEqual(['start']);
  return test;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('createXteMonitor', () => {
  it('lets a momentary swing pass and sounds only when the breach holds past the window', () => {
    const test = mount({ xteMeters: 0 });
    test.tick(XTE_LEG_GRACE_MS);

    // A swing past the limit that recovers inside the hold window never sounds.
    test.state.xteMeters = 150;
    test.tick(10_000);
    test.state.xteMeters = 10;
    test.tick(10_000);
    expect(test.events).toEqual([]);
    expect(test.monitor.alarming).toBe(false);

    // A breach that holds sounds exactly at the window edge.
    test.state.xteMeters = 150;
    test.tick(XTE_HOLD_MS - 1);
    expect(test.events).toEqual([]);
    test.tick(1);
    expect(test.events).toEqual(['start']);
    expect(test.lastTone()).toBe(XTE_TONE);
    expect(test.monitor.alarming).toBe(true);
    expect(test.monitor.standing).toBe('client');
  });

  it('holds through the activation grace, then the hold window, before the first sound', () => {
    // The boat starts past the limit the moment the course activates: the crew's own action, so
    // the grace and then the hold must both pass before the tone.
    const test = mount({ xteMeters: 500 });
    test.tick(XTE_LEG_GRACE_MS - 1);
    expect(test.events).toEqual([]);
    test.tick(1);
    expect(test.events).toEqual([]);
    test.tick(XTE_HOLD_MS - 1);
    expect(test.events).toEqual([]);
    test.tick(1);
    expect(test.events).toEqual(['start']);
  });

  it('quiets a sounding alarm on a leg switch and re-arms the grace against the new leg', () => {
    const test = mountSounding();
    test.state.legKey = 'route-1:1';
    flushSync();
    expect(test.events).toEqual(['start', 'stop']);
    expect(test.monitor.alarming).toBe(false);

    // Still past the limit against the new leg: one grace plus one hold later it sounds again.
    test.tick(XTE_LEG_GRACE_MS);
    test.tick(XTE_HOLD_MS);
    expect(test.events).toEqual(['start', 'stop', 'start']);
  });

  it('never alarms without an active course, and reactivation re-arms the grace', () => {
    const test = mount({ courseActive: false, xteMeters: 5_000 });
    test.tick(60_000);
    expect(test.events).toEqual([]);
    expect(test.monitor.alarming).toBe(false);

    test.state.courseActive = true;
    test.tick(XTE_LEG_GRACE_MS);
    test.tick(XTE_HOLD_MS - 1);
    expect(test.events).toEqual([]);
    test.tick(1);
    expect(test.events).toEqual(['start']);
  });

  it('suppresses a stale reading and requires a fresh hold after data returns', () => {
    const test = mountSounding();
    test.state.xteStale = true;
    flushSync();
    expect(test.events).toEqual(['start', 'stop']);
    expect(test.monitor.alarming).toBe(false);

    test.state.xteStale = false;
    test.tick(XTE_HOLD_MS - 1);
    expect(test.events).toEqual(['start', 'stop']);
    test.tick(1);
    expect(test.events).toEqual(['start', 'stop', 'start']);
  });

  it('stands down while a server-raised cross-track alarm covers the concern', () => {
    const test = mountSounding();
    test.state.notifications = [serverAlarm()];
    flushSync();
    expect(test.monitor.standing).toBe('server');
    expect(test.monitor.sounding).toBe(false);
    expect(test.events).toEqual(['start', 'stop']);
    // The judgment stays up for the strip; only the audible channel yields.
    expect(test.monitor.alarming).toBe(true);
    expect(test.monitor.alert).toBe('');

    test.state.notifications = [];
    flushSync();
    expect(test.monitor.standing).toBe('client');
    expect(test.events).toEqual(['start', 'stop', 'start']);
  });

  it('keeps sounding over a warn-grade server notification, which the generic surface leaves visual', () => {
    const test = mountSounding();
    test.state.notifications = [serverAlarm('warn')];
    flushSync();
    expect(test.monitor.standing).toBe('client');
    expect(test.monitor.sounding).toBe(true);
    expect(test.events).toEqual(['start']);
  });

  it('mutes the tone and the announcement while the visual judgment stays up', () => {
    const test = mountSounding();
    test.monitor.setMuted(true);
    flushSync();
    expect(test.monitor.muted).toBe(true);
    expect(test.monitor.alarming).toBe(true);
    expect(test.monitor.alert).toBe('');
    expect(test.events).toEqual(['start', 'stop']);

    test.monitor.setMuted(false);
    flushSync();
    expect(test.events).toEqual(['start', 'stop', 'start']);
  });

  it('announces the distance, the limit, and the side to steer', () => {
    const starboardOfTrack = mountSounding(150);
    expect(starboardOfTrack.monitor.alert).toBe(
      'Off course: 150 m from the leg, past the 90 m limit. Steer left to return.',
    );

    const portOfTrack = mountSounding(-150);
    expect(portOfTrack.monitor.alert).toBe(
      'Off course: 150 m from the leg, past the 90 m limit. Steer right to return.',
    );
  });

  it('applies a raised limit immediately and clamps settings into the documented range', () => {
    const test = mountSounding(150);
    test.monitor.setLimitMeters(200);
    flushSync();
    expect(test.monitor.limitMeters).toBe(200);
    expect(test.events).toEqual(['start', 'stop']);

    test.monitor.setLimitMeters(5);
    expect(test.monitor.limitMeters).toBe(20);
    test.monitor.setLimitMeters(10_000);
    expect(test.monitor.limitMeters).toBe(2_000);
    test.monitor.setLimitMeters(250.4);
    expect(test.monitor.limitMeters).toBe(250);
    // Garbage from a form field is dropped rather than persisted or thrown on.
    test.monitor.setLimitMeters(Number.NaN);
    expect(test.monitor.limitMeters).toBe(250);
  });

  it('silences the tone outright on stop', () => {
    const test = mountSounding();
    test.monitor.stop();
    expect(test.events).toEqual(['start', 'stop']);
  });
});
