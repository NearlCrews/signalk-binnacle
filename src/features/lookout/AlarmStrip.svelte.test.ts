import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ActiveNotification } from '$entities/notifications';
import AlarmStrip from './AlarmStrip.svelte';
import { ACTION_BUTTON } from './test-helpers';

function alert(overrides: Partial<ActiveNotification> = {}): ActiveNotification {
  return {
    path: 'notifications.propulsion.port.temperature',
    state: 'alarm',
    message: 'Engine overheating',
    activation: 1,
    id: 'alert-1',
    ...overrides,
  };
}

function renderStrip(overrides: Partial<ComponentProps<typeof AlarmStrip>> = {}): string {
  return render(AlarmStrip, {
    props: {
      notifications: [alert()],
      sounding: true,
      locallyMuted: false,
      writeBlocked: false,
      onMuteHere: () => {},
      onOpenAlarms: () => {},
      ...overrides,
    },
  }).body;
}

describe('AlarmStrip render gate', () => {
  it('renders nothing with no active notifications', () => {
    expect(renderStrip({ notifications: [] })).not.toContain('bottom-strip');
  });

  it('renders nothing for warn and alert grades, which stay panel and badge only', () => {
    const body = renderStrip({
      notifications: [alert({ state: 'warn' }), alert({ state: 'alert', path: 'notifications.b' })],
    });

    expect(body).not.toContain('bottom-strip');
  });

  it('raises the alarm strip for an alarm', () => {
    const body = renderStrip();

    expect(body).toContain('bottom-strip bottom-strip--alarm');
    expect(body).toContain('Engine overheating');
  });

  it('raises the alarm strip for an emergency', () => {
    const body = renderStrip({ notifications: [alert({ state: 'emergency' })] });

    expect(body).toContain('bottom-strip--alarm');
    expect(body).toContain('Emergency');
  });

  // App owns the single assertive channel for these notifications, so a second live region here
  // would double-speak every alarm.
  it('carries no live region of its own', () => {
    expect(renderStrip()).not.toContain('aria-live');
  });
});

describe('AlarmStrip worst item', () => {
  it('shows the emergency ahead of a raised alarm regardless of list order', () => {
    const body = renderStrip({
      notifications: [
        alert({ message: 'Engine overheating' }),
        alert({ state: 'emergency', path: 'notifications.mob', message: 'Man overboard' }),
      ],
    });

    expect(body).toContain('Man overboard');
    expect(body).not.toContain('Engine overheating');
  });

  it('notes how many other alarms are raised', () => {
    const body = renderStrip({
      notifications: [
        alert(),
        alert({ path: 'notifications.b' }),
        alert({ path: 'notifications.c' }),
      ],
    });

    expect(body).toContain('+2 more');
  });

  it('leaves warn and alert grades out of the count, since they never raise the strip', () => {
    const body = renderStrip({
      notifications: [alert(), alert({ state: 'warn', path: 'notifications.b' })],
    });

    expect(body).not.toContain('more');
  });

  it('falls back to the path tail when the alarm carried no message', () => {
    const body = renderStrip({ notifications: [alert({ message: '' })] });

    expect(body).toContain('propulsion.port.temperature');
    expect(body).not.toContain('notifications.propulsion');
  });
});

describe('AlarmStrip quieted state', () => {
  // Every raised alarm silenced means nothing is audible, so the controller reports sounding false
  // alongside it. Pairing the two here keeps the fixture to a state the controller can actually
  // produce.
  it('dims once every raised alarm is silenced', () => {
    const body = renderStrip({
      notifications: [
        alert({ silenced: true }),
        alert({ path: 'notifications.b', silenced: true }),
      ],
      sounding: false,
    });

    expect(body).toContain('is-ack');
    expect(body).toContain('Silenced');
  });

  it('stays lit while one raised alarm is still unsilenced', () => {
    // sounding must be false here or the quieted derivation short-circuits on it and the
    // every-silenced check is never exercised; the assertion could then not fail.
    const body = renderStrip({
      notifications: [alert({ silenced: true }), alert({ path: 'notifications.b' })],
      sounding: false,
    });

    expect(body).not.toContain('is-ack');
  });

  it('dims when the alarm is muted on this device', () => {
    const body = renderStrip({ locallyMuted: true, sounding: false });

    expect(body).toContain('is-ack');
    expect(body).toContain('Muted here');
  });

  // A local mute covers the alarms audible when it was tapped, not the ones that raise afterward,
  // so a later alarm leaves the strip both muted and sounding. A dimmed strip claiming "Muted here"
  // over a tone the crew can hear is the wrong report, so the noise decides.
  it('stays lit while another alarm sounds through a local mute', () => {
    const body = renderStrip({ locallyMuted: true, sounding: true });

    expect(body).not.toContain('is-ack');
    expect(body).not.toContain('Muted here');
  });
});

describe('AlarmStrip actions', () => {
  it('offers Silence and Acknowledge when the server allows both', () => {
    const body = renderStrip({
      notifications: [alert({ canSilence: true, canAcknowledge: true })],
      onSilence: () => {},
      onAcknowledge: () => {},
    });

    expect(body).toMatch(ACTION_BUTTON('Silence'));
    expect(body).toMatch(ACTION_BUTTON('Acknowledge'));
  });

  it('hides both actions when the server withholds the capabilities', () => {
    const body = renderStrip({ onSilence: () => {}, onAcknowledge: () => {} });

    expect(body).not.toMatch(ACTION_BUTTON('Silence'));
    expect(body).not.toMatch(ACTION_BUTTON('Acknowledge'));
  });

  // A server that can silence does not help a device that cannot ask it to, so the local mute has
  // to step in whenever the server action is unavailable for any reason, not only when the alert
  // itself refuses silencing. Otherwise a sounding alarm has no control at all on this device.
  it('falls back to Mute here without a write token', () => {
    const body = renderStrip({
      notifications: [alert({ canSilence: true, canAcknowledge: true })],
      writeBlocked: true,
      onSilence: () => {},
      onAcknowledge: () => {},
    });

    expect(body).not.toMatch(ACTION_BUTTON('Silence'));
    expect(body).not.toMatch(ACTION_BUTTON('Acknowledge'));
    expect(body).toMatch(ACTION_BUTTON('Mute here'));
  });

  it('falls back to Mute here when no handler is wired', () => {
    const body = renderStrip({
      notifications: [alert({ canSilence: true, canAcknowledge: true })],
    });

    expect(body).not.toMatch(ACTION_BUTTON('Silence'));
    expect(body).not.toMatch(ACTION_BUTTON('Acknowledge'));
    expect(body).toMatch(ACTION_BUTTON('Mute here'));
  });

  it('offers Mute here while sounding with no server silence available', () => {
    expect(renderStrip()).toMatch(ACTION_BUTTON('Mute here'));
  });

  it('hides Mute here when the server can silence the alarm instead', () => {
    const body = renderStrip({
      notifications: [alert({ canSilence: true })],
      onSilence: () => {},
    });

    expect(body).not.toMatch(ACTION_BUTTON('Mute here'));
  });

  // Silence acts on the worst alert only, so a second unsilenced alarm would be left sounding
  // with no control at all if the two were strict complements.
  it('offers both Silence and Mute here when a second alarm is beyond the silence', () => {
    const body = renderStrip({
      notifications: [alert({ canSilence: true }), alert({ path: 'notifications.b' })],
      onSilence: () => {},
    });

    expect(body).toMatch(ACTION_BUTTON('Silence'));
    expect(body).toMatch(ACTION_BUTTON('Mute here'));
  });

  it('hides Mute here when nothing is sounding to mute', () => {
    expect(renderStrip({ sounding: false })).not.toMatch(ACTION_BUTTON('Mute here'));
  });

  it('always offers Open Alarms, even quieted and without a write token', () => {
    expect(renderStrip()).toMatch(ACTION_BUTTON('Open Alarms'));
    expect(renderStrip({ writeBlocked: true, locallyMuted: true, sounding: false })).toMatch(
      ACTION_BUTTON('Open Alarms'),
    );
  });
});
