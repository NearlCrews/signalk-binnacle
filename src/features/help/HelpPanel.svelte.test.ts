import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import HelpPanel from './HelpPanel.svelte';

function renderPanel(overrides: Record<string, unknown> = {}): string {
  return render(HelpPanel, {
    props: {
      firstRun: false,
      onDismissOrientation: () => {},
      writeBlocked: false,
      requestingWrite: false,
      onRequestWrite: () => {},
      audioBlocked: false,
      onEnableSound: () => {},
      onOpenLayers: () => {},
      onOpenProfiles: () => {},
      onOpenAlarms: () => {},
      onResetHints: () => {},
      onClose: () => {},
      ...overrides,
    },
  }).body;
}

describe('HelpPanel degraded-state literacy', () => {
  it('explains the connection states and the stale divergence in always-reachable prose', () => {
    const body = renderPanel();
    expect(body).toContain('aria-label="Connection"');
    expect(body).toContain('Connected, no data');
    expect(body).toContain('aria-label="When something looks wrong"');
    expect(body).toContain('dims the readouts that pause with it');
    expect(body).toContain('Unassessed AIS targets');
  });

  it('defines the depth datums and Signal K itself in the glossary, without the numeral face', () => {
    const body = renderPanel();
    for (const term of ['Keel', 'Surface', 'Xducer', 'Signal K']) {
      expect(body).toMatch(new RegExp(`<dt[^>]*>${term}</dt>`));
      expect(body).not.toMatch(new RegExp(`<dt class="[^"]*num">${term}</dt>`));
    }
    expect(body).toMatch(/<dt class="[^"]*num">SOG<\/dt>/);
    expect(body).toContain('echo-sounder sensor');
    expect(body).toContain('The open marine data server this display connects to');
  });

  it('names where the Data Browser lives and carries the plain-HTTP explanation', () => {
    const body = renderPanel();
    expect(body).toContain('Data Browser of the Signal K server admin UI');
    expect(body).toContain('Enable HTTPS in Signal K');
  });

  it('reports the write-access outcome beside the in-panel request button', () => {
    const body = renderPanel({ writeBlocked: true, writeOutcome: 'declined' });
    expect(body).toContain('Write access was declined');
    expect(body).toContain('Request again');
  });
});
