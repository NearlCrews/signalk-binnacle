import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { NotificationsStore } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import AlarmsPanel from './AlarmsPanel.svelte';
import { ACTION_BUTTON } from './test-helpers';

type ShallowProps = ComponentProps<typeof AlarmsPanel>['shallow'];

function renderPanel(
  capabilities: { canSilence?: boolean; canAcknowledge?: boolean },
  shallow?: ShallowProps,
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
        collisionMuted: false,
        collisionMuteRemainingMin: undefined,
        onToggleCollisionMute: () => {},
        arrivalMuted: false,
        onToggleArrivalMute: () => {},
        onClose: () => {},
      },
    })
      .body // Source line wrapping survives into the rendered text, so copy is asserted against a
      // whitespace-normalized body rather than the exact wrap of the markup.
      .replace(/\s+/g, ' ')
  );
}

const renderAlert = (capabilities: { canSilence?: boolean; canAcknowledge?: boolean }): string =>
  renderPanel(capabilities);

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
});
