import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { NotificationsStore } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import AlarmsPanel from './AlarmsPanel.svelte';

const ACTION_BUTTON = (label: string): RegExp =>
  new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`);

function renderAlert(capabilities: { canSilence?: boolean; canAcknowledge?: boolean }): string {
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

  return render(AlarmsPanel, {
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
      collisionMuted: false,
      collisionMuteRemainingMin: undefined,
      onToggleCollisionMute: () => {},
      arrivalMuted: false,
      onToggleArrivalMute: () => {},
      onClose: () => {},
    },
  }).body;
}

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
