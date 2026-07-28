import { describe, expect, it } from 'vitest';
import type { ActiveNotification } from '$entities/notifications';
import {
  canAcknowledgeNotification,
  canSilenceNotification,
  notificationLabel,
} from './notification-actions';

function notification(overrides: Partial<ActiveNotification> = {}): ActiveNotification {
  return {
    path: 'notifications.environment.fire',
    state: 'alarm',
    message: 'Smoke detected',
    activation: 1,
    id: 'abc-123',
    canSilence: true,
    canAcknowledge: true,
    ...overrides,
  };
}

describe('canSilenceNotification', () => {
  it('accepts a raised alarm the server says can be silenced', () => {
    expect(canSilenceNotification(notification())).toBe(true);
  });

  it('refuses without a server id, without the capability flag, or once silenced', () => {
    expect(canSilenceNotification(notification({ id: undefined }))).toBe(false);
    expect(canSilenceNotification(notification({ canSilence: undefined }))).toBe(false);
    expect(canSilenceNotification(notification({ canSilence: false }))).toBe(false);
    expect(canSilenceNotification(notification({ silenced: true }))).toBe(false);
    expect(canSilenceNotification(notification({ acknowledged: true }))).toBe(false);
  });

  it('refuses an emergency, which must not be silenceable', () => {
    expect(canSilenceNotification(notification({ state: 'emergency' }))).toBe(false);
  });
});

describe('notificationLabel', () => {
  it('prefers the message the producer wrote', () => {
    expect(notificationLabel(notification({ message: 'Bilge pump running' }))).toBe(
      'Bilge pump running',
    );
  });

  it('falls back to the path tail so a message-less alert is still identifiable', () => {
    expect(
      notificationLabel(
        notification({ message: '', path: 'notifications.electrical.batteries.house' }),
      ),
    ).toBe('electrical.batteries.house');
  });

  it('strips only a leading notifications prefix', () => {
    expect(notificationLabel(notification({ message: '', path: 'custom.notifications.x' }))).toBe(
      'custom.notifications.x',
    );
  });
});

describe('canAcknowledgeNotification', () => {
  it('accepts a raised alert the server says can be acknowledged, emergencies included', () => {
    expect(canAcknowledgeNotification(notification())).toBe(true);
    expect(canAcknowledgeNotification(notification({ state: 'emergency' }))).toBe(true);
    expect(canAcknowledgeNotification(notification({ silenced: true }))).toBe(true);
  });

  it('refuses without a server id, without the capability flag, or once acknowledged', () => {
    expect(canAcknowledgeNotification(notification({ id: undefined }))).toBe(false);
    expect(canAcknowledgeNotification(notification({ canAcknowledge: undefined }))).toBe(false);
    expect(canAcknowledgeNotification(notification({ canAcknowledge: false }))).toBe(false);
    expect(canAcknowledgeNotification(notification({ acknowledged: true }))).toBe(false);
  });
});
