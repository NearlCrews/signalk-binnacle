import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import StatusCell from './StatusCell.svelte';
import type { StatusNotice } from './status-notices';

function notice(overrides: Partial<StatusNotice> & Pick<StatusNotice, 'id'>): StatusNotice {
  return { tone: 'warning', icon: 'alert', word: overrides.id, title: overrides.id, ...overrides };
}

function body(notices: StatusNotice[]): string {
  return render(StatusCell, {
    props: {
      notices,
      connectionLabel: 'Connected',
      connectionTitle: 'Connected to the Signal K server.',
    },
  }).body;
}

// The button's own markup, from its opening tag to its closing tag.
function cell(html: string): string {
  const start = html.indexOf('<button');
  return html.slice(start, html.indexOf('</button>', start) + '</button>'.length);
}

function text(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('StatusCell', () => {
  it('says All clear with the connection dot while nothing is wrong', () => {
    const html = cell(body([]));
    expect(text(html)).toBe('Status All clear');
    expect(html).toContain('status-dot');
    expect(html).not.toMatch(/status-cell--(warning|alarm|info)/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('shows one problem in its own words and grade', () => {
    const html = cell(body([notice({ id: 'alerts', word: '1 alert', title: '1 alert' })]));
    expect(text(html)).toBe('Status 1 alert');
    expect(html).toContain('status-cell--warning');
    expect(html).toContain('data-cell--warning');
    expect(html).not.toContain('status-more');
  });

  it('leads with the worst problem and counts the rest, naming them all', () => {
    const html = cell(
      body([
        notice({ id: 'fix', word: 'GPS lost' }),
        notice({ id: 'collision-mute', word: 'Muted' }),
        notice({ id: 'update', word: 'Update', tone: 'info' }),
      ]),
    );
    // The visible words lead the accessible name, then every other problem by its word.
    expect(text(html)).toBe('Status +2 GPS lost , also Muted, Update');
    expect(html).toContain('badge badge--strong status-more');
  });

  it('turns red when the data itself has stopped', () => {
    const html = cell(body([notice({ id: 'offline', word: 'Offline', tone: 'alarm' })]));
    expect(html).toContain('status-cell--alarm');
    expect(html).toContain('data-cell--alarm');
  });

  it('gives news the accent voice, not a caution', () => {
    const html = cell(body([notice({ id: 'update', word: 'Update', tone: 'info', icon: 'info' })]));
    expect(html).toContain('status-cell--info');
    expect(html).not.toContain('data-cell--');
  });

  it('keeps the connection phase in an always-mounted polite region outside the button', () => {
    const html = body([notice({ id: 'offline', word: 'Offline', tone: 'alarm' })]);
    const region = html.slice(0, html.indexOf('<button'));
    expect(region).toContain('class="visually-hidden conn-live"');
    expect(region).toContain('role="status"');
    expect(text(region)).toContain('Connected');
  });
});
