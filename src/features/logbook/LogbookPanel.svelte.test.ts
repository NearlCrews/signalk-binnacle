import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthController } from '$shared/signalk';
import LogbookPanel from './LogbookPanel.svelte';
import type { LogbookController } from './logbook-controller.svelte';

function renderPanel(
  controllerOverrides: Partial<LogbookController> = {},
  authOverrides: Partial<AuthController> = {},
): string {
  const controller: LogbookController = {
    availability: 'available',
    entries: [],
    loadState: 'ready',
    busy: false,
    checking: false,
    error: undefined,
    suggestion: undefined,
    start: vi.fn(),
    recheck: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    addEntry: vi.fn(async () => true),
    offerEntry: vi.fn(),
    dismissSuggestion: vi.fn(),
    clearError: vi.fn(),
    ...controllerOverrides,
  };
  const auth = {
    writeBlocked: false,
    upgrading: false,
    upgradeOutcome: undefined,
    requestWriteAccess: vi.fn(async () => undefined),
    ...authOverrides,
  } as AuthController;
  return render(LogbookPanel, {
    props: { controller, auth, onClose: vi.fn() },
  }).body.replaceAll(/\s+/g, ' ');
}

describe('LogbookPanel', () => {
  it('teaches what the panel does and offers the empty next step', () => {
    const html = renderPanel();
    expect(html).toContain('Keep a written log of the passage.');
    expect(html).toContain('No entries in the last two days. Add the first one above.');
    expect(html).toContain('Add entry');
  });

  it('explains the absent provider and how to install it, with a recheck', () => {
    const html = renderPanel({ availability: 'absent', loadState: 'idle' });
    expect(html).toContain('Not detected');
    expect(html).toContain('signalk-logbook');
    expect(html).toContain('Signal K App Store');
    expect(html).toContain('Check again');
    expect(html).not.toContain('Add entry');
  });

  it('separates refused access from a transport failure', () => {
    const refused = renderPanel({ availability: 'unauthorized' });
    expect(refused).toContain('Reading the logbook needs read and write access');
    expect(refused).toContain('Request read and write access');

    const failed = renderPanel({ availability: 'error' });
    expect(failed).toContain('Could not reach the logbook. Check the connection.');
    expect(failed).toContain('Retry');
  });

  it('reports the probe while availability is unknown', () => {
    const html = renderPanel({ availability: 'unknown', loadState: 'idle' });
    expect(html).toContain('Checking for the logbook provider…');
  });

  it('groups entries by day with time, text, and a category chip', () => {
    const html = renderPanel({
      entries: [
        {
          datetime: '2026-08-30T09:00:00.000Z',
          timeMs: Date.UTC(2026, 7, 30, 12, 0),
          text: 'Engine on.',
          category: 'engine',
        },
        {
          datetime: '2026-08-30T08:00:00.000Z',
          timeMs: Date.UTC(2026, 7, 30, 11, 0),
          text: '',
          origin: 'auto',
        },
        {
          datetime: '2026-08-28T10:00:00.000Z',
          timeMs: Date.UTC(2026, 7, 28, 12, 0),
          text: 'Departed the anchorage.',
        },
      ],
    });
    expect(html.match(/<h4 class="caps-label">/g)).toHaveLength(2);
    expect(html).toContain('Engine on.');
    expect(html).toContain('engine');
    expect(html).toContain('Automatic entry: position and conditions recorded.');
    expect(html).toContain('Departed the anchorage.');
    expect(html).toContain('The last two logged days are shown.');
  });

  it('renders a pending suggestion as an offer, never as a logged entry', () => {
    const html = renderPanel({
      suggestion: { text: 'Anchor down, watch radius 40 m.', offeredAt: Date.UTC(2026, 7, 30) },
    });
    expect(html).toContain('Nothing is logged until you tap Log it.');
    expect(html).toContain('Anchor down, watch radius 40 m.');
    expect(html).toContain('Use suggestion');
    expect(html).toContain('Dismiss');
  });

  it('keeps retained entries visible under a refresh failure', () => {
    const html = renderPanel({
      loadState: 'error',
      entries: [
        {
          datetime: '2026-08-30T09:00:00.000Z',
          timeMs: Date.UTC(2026, 7, 30, 12, 0),
          text: 'Engine on.',
        },
      ],
    });
    expect(html).toContain('Could not load recent entries.');
    expect(html).toContain('Retry');
    expect(html).toContain('Engine on.');
  });

  it('teaches the write gate through the shared access note', () => {
    const html = renderPanel({}, { writeBlocked: true });
    expect(html).toContain('new entries cannot be logged');
    expect(html).toContain('Request read and write access');
  });

  it('states that the server captures conditions, so no one expects Binnacle to', () => {
    const html = renderPanel();
    expect(html).toContain('Position, heading, speed, wind, and barometer are added by the server');
  });
});
