import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { NotificationsStore } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import AlarmsPanel from './AlarmsPanel.svelte';

const ACTION_BUTTON = (label: string): RegExp =>
  new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`);

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
        thresholdSource: 'local',
        effectiveLimitMeters: 3,
      },
    );
    expect(body).toContain(THRESHOLD_FIELD);
    expect(body).not.toContain('depth zones');
  });

  it('shows the server bound read-only when the server zones are in force', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'monitoring',
        thresholdSource: 'server',
        effectiveLimitMeters: 2.5,
      },
    );
    expect(body).not.toContain(THRESHOLD_FIELD);
    expect(body).toContain("The server's depth zones set the shallow alarm at");
    expect(body).toContain('2.5');
    expect(body).toContain('Edit the depth zones on the Signal K server to change it.');
  });

  it('names no bound when the server alarm zone is open at the top', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'monitoring',
        thresholdSource: 'server',
        effectiveLimitMeters: undefined,
      },
    );
    expect(body).toContain("The server's depth zones set the shallow alarm.");
  });

  it('says so when no depth source has ever published', () => {
    const body = renderPanel(
      {},
      {
        monitorState: 'no-source',
        thresholdSource: 'local',
        effectiveLimitMeters: 3,
      },
    );
    expect(body).toContain('No depth source is publishing. The shallow alarm cannot monitor.');
  });
});
