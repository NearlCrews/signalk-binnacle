import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assessment } from '$entities/collision';
import type { ActiveNotification } from '$entities/notifications';
import * as signalk from '$shared/signalk';
import { createNotificationsController } from './notifications-controller.svelte';

vi.mock('$shared/signalk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$shared/signalk')>()),
  acknowledgeNotification: vi.fn(),
  acknowledgeAllNotifications: vi.fn(),
  postNotification: vi.fn(),
  resolveNotification: vi.fn(),
  silenceNotification: vi.fn(),
  silenceAllNotifications: vi.fn(),
  updateNotification: vi.fn(),
}));

const DANGER: Assessment = {
  unassessed: [],
  worst: 'danger',
  contacts: [
    {
      id: 'vessels.123456789',
      name: 'Tug',
      position: { latitude: 42, longitude: -83 },
      cpaMeters: 100,
      tcpaSeconds: 60,
      severity: 'danger',
      source: 'provider',
    },
  ],
};

function setup(
  options: {
    assessment?: Assessment;
    apiAvailable?: boolean;
    writeBlocked?: boolean;
    timeTravelActive?: boolean;
    suppressed?: boolean;
    escalating?: boolean;
    mobActive?: boolean;
    ownedDepthPath?: string;
    notifications?: unknown[];
  } = {},
) {
  const assessment = options.assessment ?? DANGER;
  const collisionMute = {
    active: false,
    remainingMs: 120_000,
    toggle: vi.fn(() => {
      collisionMute.active = !collisionMute.active;
    }),
  };
  const client = { publish: vi.fn(async () => undefined) };
  const lookoutAlarm = { update: vi.fn() };
  const genericAlarm = {
    update: vi.fn(),
    muteActiveHere: vi.fn<() => readonly ActiveNotification[]>(() => []),
    sounding: false,
    locallyMuted: false,
  };
  const timeTravel = { active: options.timeTravelActive ?? false, exit: vi.fn() };
  const mob = { active: options.mobActive ?? false };
  const log = vi.fn();
  const controller = createNotificationsController({
    origin: 'http://sk',
    token: () => 'token',
    notificationsApi: () => options.apiAvailable ?? true,
    writeBlocked: () => options.writeBlocked ?? false,
    selfContext: () => undefined,
    client: client as never,
    collision: {
      assessment,
      suppressed: options.suppressed ?? false,
      escalating: options.escalating ?? false,
    } as never,
    collisionMute: collisionMute as never,
    lookoutAlarm: lookoutAlarm as never,
    anchor: { watching: false } as never,
    notificationsStore: { list: () => options.notifications ?? [] } as never,
    companionStatus: { state: 'ready', down: false } as never,
    timeTravel: timeTravel as never,
    mob: mob as never,
    genericAlarm: genericAlarm as never,
    ownedDepthNotificationPath: () => options.ownedDepthPath,
    anchorNotificationCovered: () => true,
    log,
  });
  return {
    log,
    client,
    collisionMute,
    controller,
    genericAlarm,
    lookoutAlarm,
    timeTravel,
  };
}

const mountedCleanups: Array<() => void> = [];

function mount(options: Parameters<typeof setup>[0] = {}) {
  let test!: ReturnType<typeof setup>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      test = setup(options);
    });
  });
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    test.controller.dispose();
    disposeRoot();
  };
  mountedCleanups.push(cleanup);
  return test;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(signalk.postNotification).mockResolvedValue('alert-1');
  vi.mocked(signalk.resolveNotification).mockResolvedValue(true);
  vi.mocked(signalk.updateNotification).mockResolvedValue('updated');
  vi.mocked(signalk.silenceNotification).mockResolvedValue('completed');
  vi.mocked(signalk.acknowledgeNotification).mockResolvedValue('completed');
  vi.mocked(signalk.acknowledgeAllNotifications).mockResolvedValue('completed');
  vi.mocked(signalk.silenceAllNotifications).mockResolvedValue('completed');
});

afterEach(() => {
  for (const cleanup of mountedCleanups.splice(0).reverse()) cleanup();
});

describe('createNotificationsController', () => {
  it('falls back to a Signal K delta and updates the audible alarm when the API is absent', async () => {
    const test = mount({ apiAvailable: false });
    await Promise.resolve();

    expect(test.client.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        updates: [
          expect.objectContaining({
            values: [
              expect.objectContaining({
                path: 'notifications.navigation.collision',
                value: expect.objectContaining({ state: 'alarm' }),
              }),
            ],
          }),
        ],
      }),
    );
    expect(test.lookoutAlarm.update).toHaveBeenCalledWith('danger', false, false, false, false);
  });

  it('exits time travel immediately for MOB or unsuppressed collision danger', () => {
    const test = mount({ timeTravelActive: true, mobActive: true });
    expect(test.timeTravel.exit).toHaveBeenCalledOnce();
  });

  it('exits playback for an escalating danger despite an existing acknowledgment', () => {
    const test = mount({ timeTravelActive: true, suppressed: true, escalating: true });
    expect(test.timeTravel.exit).toHaveBeenCalledOnce();
    const quiet = mount({ timeTravelActive: true, suppressed: true, escalating: false });
    expect(quiet.timeTravel.exit).not.toHaveBeenCalled();
  });

  it('records only the newly muted notification activations returned by the local alarm', () => {
    const test = mount();
    test.genericAlarm.muteActiveHere.mockReturnValueOnce([
      {
        path: 'notifications.bilge',
        message: 'Bilge high',
        state: 'alarm',
        activation: 1,
      } as ActiveNotification,
    ]);
    test.controller.muteGenericHere();
    test.controller.muteGenericHere();
    expect(test.log.mock.calls.filter(([event]) => event.kind === 'muted')).toEqual([
      [
        {
          kind: 'muted',
          label: 'Bilge high',
          source: 'notifications.bilge',
          detail: 'On this device only.',
        },
      ],
    ]);
  });

  it('records bulk actions only after the server confirms them', async () => {
    const test = mount();
    vi.mocked(signalk.silenceAllNotifications).mockResolvedValueOnce('failed');
    test.controller.onSilenceAllNotifications();
    await vi.waitFor(() => expect(test.controller.alarmActionError).toContain('Could not silence'));
    expect(test.log.mock.calls.filter(([event]) => event.kind === 'silenced')).toHaveLength(0);
    test.controller.onAcknowledgeAllNotifications();
    await vi.waitFor(() =>
      expect(test.log).toHaveBeenCalledWith({ kind: 'acknowledged', label: 'All active alarms' }),
    );
  });

  it('keeps a device mute but explains when boat-wide silence is write-blocked', async () => {
    const test = mount({ writeBlocked: true });
    await vi.waitFor(() => expect(signalk.postNotification).toHaveBeenCalledOnce());

    test.controller.toggleCollisionMute();

    expect(test.collisionMute.active).toBe(true);
    expect(test.controller.alarmActionError).toContain('Server write access is needed');
    expect(signalk.silenceNotification).not.toHaveBeenCalled();
  });

  it('surfaces unsupported and failed notification actions', async () => {
    const test = mount();
    vi.mocked(signalk.silenceNotification).mockResolvedValueOnce('unsupported');
    test.controller.onSilenceNotification({ id: 'n1' } as never);
    await vi.waitFor(() => expect(test.controller.alarmActionError).toContain('unavailable'));

    vi.mocked(signalk.acknowledgeNotification).mockResolvedValueOnce('failed');
    test.controller.onAcknowledgeNotification({ id: 'n1' } as never);
    await vi.waitFor(() =>
      expect(test.controller.alarmActionError).toContain('Could not acknowledge'),
    );
    expect(
      test.log.mock.calls.filter(([event]) => ['silenced', 'acknowledged'].includes(event.kind)),
    ).toHaveLength(0);
    test.controller.onAcknowledgeNotification({
      id: 'n1',
      path: 'notifications.test',
      value: { state: 'alarm', message: 'Engine hot' },
    } as never);
    await vi.waitFor(() =>
      expect(test.log).toHaveBeenCalledWith(expect.objectContaining({ kind: 'acknowledged' })),
    );
  });

  it('keeps a non-audible warning out of the assertive live region', () => {
    const test = mount({
      notifications: [
        { path: 'notifications.environment.wind', state: 'warn', message: 'Gust', activation: 1 },
      ],
    });
    expect(test.controller.genericAlarms).toHaveLength(1);
    expect(test.controller.notificationAlert).toBe('');
  });

  it('announces a raised alarm in helm voice, worst grade first', () => {
    const test = mount({
      notifications: [
        { path: 'notifications.environment.wind', state: 'warn', message: 'Gust', activation: 1 },
        { path: 'notifications.propulsion.oil', state: 'alarm', message: 'Oil pressure' },
        { path: 'notifications.electrical.fire', state: 'emergency', message: 'Engine room fire' },
      ],
    });
    expect(test.controller.notificationAlert).toBe(
      'Emergency: Engine room fire. Open Alarms for details.',
    );

    const alarmOnly = mount({
      notifications: [
        { path: 'notifications.propulsion.oil', state: 'alarm', message: 'Oil pressure' },
      ],
    });
    expect(alarmOnly.controller.notificationAlert).toBe(
      'Alarm: Oil pressure. Open Alarms for details.',
    );
  });

  it('drives the generic alarm from the store list and exposes its state and mute', () => {
    const test = mount();
    expect(test.genericAlarm.update).toHaveBeenCalledWith([]);
    expect(test.controller.genericAlarms).toEqual([]);
    expect(test.controller.genericSounding).toBe(false);
    expect(test.controller.genericLocallyMuted).toBe(false);
    test.controller.muteGenericHere();
    expect(test.genericAlarm.muteActiveHere).toHaveBeenCalledOnce();
  });
});
