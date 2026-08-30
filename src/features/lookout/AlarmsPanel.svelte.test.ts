import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { NotificationsStore } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import { ALARM_AUDIO_BLOCKED_NOTE } from '$shared/audio';
import { formatClockTime } from '$shared/lib';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import AlarmsPanel from './AlarmsPanel.svelte';
import { type AlarmLog, type AlarmLogKind, createAlarmLog } from './alarm-log.svelte';
import { ACTION_BUTTON } from './test-helpers';

type ShallowProps = ComponentProps<typeof AlarmsPanel>['shallow'];

function renderPanel(
  capabilities: {
    acknowledged?: boolean;
    acknowledgedAt?: string;
    canSilence?: boolean;
    canAcknowledge?: boolean;
  },
  shallow?: ShallowProps,
  mute: { collisionMuted?: boolean; collisionMuteRemainingMin?: number } = {},
  extra: Partial<ComponentProps<typeof AlarmsPanel>> = {},
): string {
  const notifications = {
    list: () => [
      {
        path: 'notifications.navigation.depth',
        state: 'alarm' as const,
        message: 'Shallow water',
        method: ['visual' as const, 'sound' as const],
        id: 'notification-id',
        ...capabilities,
      },
    ],
  } as unknown as NotificationsStore;

  return (
    render(AlarmsPanel, {
      props: {
        auth: { writeBlocked: false } as AuthController,
        connectionPhase: 'open',
        notifications,
        onSilence: () => {},
        onAcknowledge: () => {},
        thresholds: {
          value: DEFAULT_THRESHOLDS,
          set: () => {},
        } as unknown as PersistedValue<Thresholds>,
        units: { mode: 'metric' } as UnitsStore,
        shallow,
        collisionMuted: mute.collisionMuted ?? false,
        collisionMuteRemainingMin: mute.collisionMuteRemainingMin,
        onToggleCollisionMute: () => {},
        arrivalMuted: false,
        onToggleArrivalMute: () => {},
        onClose: () => {},
        ...extra,
      },
    })
      .body // Source line wrapping survives into the rendered text, so copy is asserted against a
      // whitespace-normalized body rather than the exact wrap of the markup.
      .replace(/\s+/g, ' ')
  );
}

const renderAlert = (capabilities: {
  acknowledged?: boolean;
  acknowledgedAt?: string;
  canSilence?: boolean;
  canAcknowledge?: boolean;
}): string => renderPanel(capabilities);

// A store of `count` alarms sharing one capability shape, with optional overrides on the last so a
// mixed list (one alert refusing an action) is one call.
const multiAlertStore = (
  count: number,
  capabilities: { canSilence?: boolean; canAcknowledge?: boolean },
  lastOverrides: { canSilence?: boolean; canAcknowledge?: boolean } = {},
): NotificationsStore =>
  ({
    list: () =>
      Array.from({ length: count }, (_, index) => ({
        path: `notifications.test.${index}`,
        state: 'alarm' as const,
        message: `Alert ${index}`,
        method: ['visual' as const, 'sound' as const],
        id: `id-${index}`,
        ...capabilities,
        ...(index === count - 1 ? lastOverrides : {}),
      })),
  }) as unknown as NotificationsStore;

const THRESHOLD_FIELD = 'Shallow water depth threshold';

describe('AlarmsPanel notification actions', () => {
  it('hides actions when the server omits notification management capabilities', () => {
    const body = renderAlert({});
    expect(body).not.toMatch(ACTION_BUTTON('Silence'));
    expect(body).not.toMatch(ACTION_BUTTON('Acknowledge'));
  });

  it('shows actions when the server explicitly enables them', () => {
    const body = renderAlert({ canSilence: true, canAcknowledge: true });
    expect(body).toMatch(ACTION_BUTTON('Silence'));
    expect(body).toMatch(ACTION_BUTTON('Acknowledge'));
  });

  it('shows the local acknowledgment time when the server supplies it', () => {
    const acknowledgedAt = '2026-08-12T07:05:00Z';
    const body = renderAlert({ acknowledged: true, acknowledgedAt });
    expect(body).toContain(`Acknowledged ${formatClockTime(Date.parse(acknowledgedAt))}`);
  });
});

describe('AlarmsPanel bulk actions', () => {
  const wired = { onSilenceAll: () => {}, onAcknowledgeAll: () => {} };
  const bothActionable = { canSilence: true, canAcknowledge: true };

  it('offers both bulk actions when wired and two or more alerts can take them', () => {
    const body = renderPanel(
      {},
      undefined,
      {},
      {
        ...wired,
        notifications: multiAlertStore(2, bothActionable),
      },
    );
    expect(body).toMatch(ACTION_BUTTON('Silence all'));
    expect(body).toMatch(ACTION_BUTTON('Acknowledge all'));
  });

  it('keeps bulk actions hidden when the callbacks are not wired', () => {
    const body = renderPanel(
      {},
      undefined,
      {},
      {
        notifications: multiAlertStore(2, bothActionable),
      },
    );
    expect(body).not.toContain('Silence all');
    expect(body).not.toContain('Acknowledge all');
  });

  it('hides a bulk action while only one alert can take it', () => {
    const body = renderPanel(
      {},
      undefined,
      {},
      {
        ...wired,
        notifications: multiAlertStore(2, bothActionable, { canAcknowledge: false }),
      },
    );
    expect(body).toMatch(ACTION_BUTTON('Silence all'));
    expect(body).not.toContain('Acknowledge all');
  });

  it('hides bulk actions beside a single alert, whose own button is the same tap', () => {
    const body = renderPanel(bothActionable, undefined, {}, wired);
    expect(body).not.toContain('Silence all');
    expect(body).not.toContain('Acknowledge all');
  });

  it('disables bulk actions without write access', () => {
    const body = renderPanel(
      {},
      undefined,
      {},
      {
        ...wired,
        auth: { writeBlocked: true } as AuthController,
        notifications: multiAlertStore(2, bothActionable),
      },
    );
    expect(body).toMatch(/title="Stop the sound of every alert at once"[^>]*disabled/);
    expect(body).toMatch(/title="Mark every alert as seen and clear them at once"[^>]*disabled/);
  });
});

describe('AlarmsPanel shallow water section', () => {
  it('offers the editable threshold when no monitor state is supplied', () => {
    const body = renderPanel({});
    expect(body).toContain(THRESHOLD_FIELD);
    expect(body).toContain('Binnacle uses depth below the keel when the server provides it.');
  });

  it('offers the editable threshold while the local threshold is in force', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'monitoring',
        serverLimitMeters: undefined,
        serverZonesActive: false,
      },
    );
    expect(body).toContain(THRESHOLD_FIELD);
    expect(body).not.toContain('depth zones');
  });

  it('keeps the editor and names the server bound when the server publishes zones', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'monitoring',
        serverLimitMeters: 2.5,
        serverZonesActive: true,
      },
    );
    expect(body).toContain(THRESHOLD_FIELD);
    expect(body).toContain("The server's depth zones also alarm at");
    expect(body).toContain('2.5');
    expect(body).toContain('The deeper of that bound and this setting fires the alarm');
  });

  it('says the zones arm the alarm when they name no single bound', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'monitoring',
        serverLimitMeters: undefined,
        serverZonesActive: true,
      },
    );
    expect(body).toContain(THRESHOLD_FIELD);
    expect(body).toContain("The server's depth zones also arm the alarm alongside this setting");
  });

  it('shows only the editor when the server publishes no zones at all', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'monitoring',
        serverLimitMeters: undefined,
        serverZonesActive: false,
      },
    );
    expect(body).toContain(THRESHOLD_FIELD);
    expect(body).not.toContain("The server's depth zones");
  });

  it('says so when no depth source has ever published', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'no-source',
        serverLimitMeters: undefined,
        serverZonesActive: false,
      },
    );
    expect(body).toContain('No depth source is publishing. The shallow alarm cannot monitor.');
  });

  it('says so when the sounder streams no usable reading', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'no-reading',
        serverLimitMeters: undefined,
        serverZonesActive: false,
      },
    );
    expect(body).toContain(
      'The sounder is publishing no usable depth reading. The shallow alarm cannot monitor.',
    );
  });

  // A monitor that cannot see the bottom has to look different from the guidance copy above it, and
  // the threshold has to stay editable: it is configuration that takes effect the moment a source
  // appears, which is exactly the dockside setup case.
  it('marks a degraded monitor as a caution and keeps the threshold editable', () => {
    for (const monitorState of ['no-source', 'no-reading'] as const) {
      const body = renderPanel(
        {},
        { monitorState, serverLimitMeters: undefined, serverZonesActive: false },
      );
      expect(body).toMatch(/class="[^"]*sev-warning[^"]*"[^>]*role="status"/);
      expect(body).toContain(THRESHOLD_FIELD);
      expect(body).not.toMatch(new RegExp(`aria-label="${THRESHOLD_FIELD}"[^>]*disabled`));
    }
  });
});

describe('AlarmsPanel mutes', () => {
  it('announces the collision mute countdown as a status', () => {
    const body = renderPanel({}, undefined, {
      collisionMuted: true,
      collisionMuteRemainingMin: 12,
    });
    expect(body).toMatch(/role="status">Turns back on in 12 min/);
  });
});

describe('AlarmsPanel alarm sound section', () => {
  it('offers the self-test, and the volume slider when the setting is wired', () => {
    const body = renderPanel({}, undefined, {}, { alarmVolume: { value: 0.6, set: () => {} } });
    expect(body).toMatch(ACTION_BUTTON('Test alarm sound'));
    expect(body).toContain('Volume on this display');
    expect(body).toContain('60%');
  });

  it('keeps the blocked-audio note beside the test button and only there', () => {
    const body = renderPanel({}, undefined, {}, { audioState: 'blocked' });
    const section = body.indexOf('aria-label="Alarm sound"');
    const note = body.indexOf(ALARM_AUDIO_BLOCKED_NOTE);
    expect(section).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(section);
    expect(body.indexOf(ALARM_AUDIO_BLOCKED_NOTE, note + 1)).toBe(-1);
  });

  it('disables the test where no Web Audio exists, with the terminal note', () => {
    const body = renderPanel({}, undefined, {}, { audioState: 'unsupported' });
    expect(body).toMatch(/title="Play a short test burst at the set volume"[^>]*disabled/);
    expect(body).toContain('Audible alarms are unavailable on this display.');
  });

  it('hides the slider for a caller without the setting', () => {
    const body = renderPanel({});
    expect(body).toMatch(ACTION_BUTTON('Test alarm sound'));
    expect(body).not.toContain('Volume on this display');
  });
});

describe('AlarmsPanel session chronology', () => {
  const logWith = (entries: Array<{ at: number; kind: AlarmLogKind; label: string }>): AlarmLog => {
    const clock = { now: 0 };
    const log = createAlarmLog(clock);
    for (const entry of entries) {
      clock.now = entry.at;
      log.record({ kind: entry.kind, label: entry.label });
    }
    return log;
  };

  it('is absent entirely for a caller without a log', () => {
    expect(renderPanel({})).not.toContain('Session chronology');
  });

  it('shows the empty state for a quiet session', () => {
    const body = renderPanel({}, undefined, {}, { alarmLog: logWith([]) });
    expect(body).toContain('Session chronology');
    expect(body).toContain('No alarm events this session yet.');
  });

  it('lists entries newest first with clock times', () => {
    const earlier = Date.parse('2026-08-28T21:00:00');
    const later = Date.parse('2026-08-28T23:30:00');
    const body = renderPanel(
      {},
      undefined,
      {},
      {
        alarmLog: logWith([
          { at: earlier, kind: 'raised', label: 'Shallow water' },
          { at: later, kind: 'silenced', label: 'Shallow water' },
        ]),
      },
    );
    // The clock time is normalized the same way the body is: some ICU builds put a narrow
    // no-break space before the day period, and the body normalization already flattened it.
    const clockTime = (ms: number): string => formatClockTime(ms).replace(/\s+/g, ' ');
    const newest = body.indexOf('Silenced: Shallow water');
    const oldest = body.indexOf('Raised: Shallow water');
    expect(newest).toBeGreaterThan(-1);
    expect(oldest).toBeGreaterThan(newest);
    expect(body).toContain(`${clockTime(later)}</span>`);
    expect(body).toContain(`${clockTime(earlier)}</span>`);
  });
});

describe('AlarmsPanel wake lock note', () => {
  it('explains an unsupported wake lock and a refused one, and stays quiet otherwise', () => {
    expect(renderPanel({}, undefined, {}, { wakeLockState: 'unsupported' })).toContain(
      'Serve Signal K over HTTPS to enable screen wake.',
    );
    expect(renderPanel({}, undefined, {}, { wakeLockState: 'failed' })).toContain(
      'The browser refused the screen wake lock, often battery saver.',
    );
    for (const state of ['idle', 'held'] as const) {
      const body = renderPanel({}, undefined, {}, { wakeLockState: state });
      expect(body).not.toContain('screen wake');
      expect(body).not.toContain('wake lock');
    }
  });
});

describe('AlarmsPanel off-course alarm section', () => {
  const xteControls = (
    overrides: Partial<NonNullable<ComponentProps<typeof AlarmsPanel>['xte']>> = {},
  ) => ({
    muted: false,
    setMuted: () => {},
    limitMeters: 150,
    setLimitMeters: () => {},
    standing: 'client' as const,
    alarming: false,
    ...overrides,
  });

  it('is absent entirely without the controls', () => {
    expect(renderPanel({})).not.toContain('Off-course alarm');
  });

  it('renders the mute toggle and the meters limit field', () => {
    const body = renderPanel({}, undefined, {}, { xte: xteControls() });
    expect(body).toContain('Mute off-course alarm');
    expect(body).toContain('Off-course limit');
    expect(body).toContain('150');
    expect(body).not.toContain('A server plugin raises the off-course alarm');
  });

  it('notes server standing when a plugin owns the alarm', () => {
    const body = renderPanel({}, undefined, {}, { xte: xteControls({ standing: 'server' }) });
    expect(body).toContain('A server plugin raises the off-course alarm; this display follows it.');
  });
});
