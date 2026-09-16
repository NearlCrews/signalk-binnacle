import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import LogbookPanel from './LogbookPanel.svelte';
import type { LogbookController } from './logbook-controller.svelte';

function renderPanel(controllerOverrides: Partial<LogbookController> = {}): string {
  const controller: LogbookController = {
    draft: '',
    seededText: '',
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
  return render(LogbookPanel, {
    props: { controller, origin: 'https://boat.test', onClose: vi.fn() },
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
    expect(refused).toContain('requires a Signal K administrator browser session');
    expect(refused).toContain('Sign in to Signal K');
    expect(refused).toContain('(new tab)');
    expect(refused).toContain('target="_blank"');
    expect(refused).toContain('/admin/#/login?redirect=');
    expect(refused).not.toContain('Request read and write access');

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

  it('does not imply device-token approval grants administrator access', () => {
    const html = renderPanel();
    expect(html).not.toContain('Request read and write access');
    expect(html).toContain('Add entry');
  });

  it('states that the server captures conditions, so no one expects Binnacle to', () => {
    const html = renderPanel();
    expect(html).toContain('Position, heading, speed, wind, and barometer are added by the server');
  });

  it('makes session draft retention and manual refresh visible', () => {
    const html = renderPanel({
      draft: 'Keep this note.',
      lastCheckedMs: Date.UTC(2026, 8, 16, 12),
    });
    expect(html).toContain('Keep this note.');
    expect(html).toContain('including when you change panels');
    expect(html).toContain('Discard draft');
    expect(html).toContain('Refresh entries');
    expect(html).toContain('Last checked');
  });
});
