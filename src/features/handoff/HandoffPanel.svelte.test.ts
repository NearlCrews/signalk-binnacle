import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import HandoffPanel from './HandoffPanel.svelte';
import type { HandoffController } from './handoff-controller.svelte';

function renderPanel(overrides: Partial<HandoffController> = {}): string {
  const controller: HandoffController = {
    draft: '',
    error: undefined,
    pendingCount: 0,
    queueFull: false,
    memoryOnly: false,
    records: [],
    loadState: 'ready',
    syncing: false,
    create: vi.fn(() => true),
    refresh: vi.fn(async () => undefined),
    syncDrafts: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides,
  };
  return render(HandoffPanel, { props: { controller, onClose: vi.fn() } }).body.replaceAll(
    /\s+/g,
    ' ',
  );
}

describe('HandoffPanel', () => {
  it('frames the surface as review, never as safe to take watch', () => {
    const html = renderPanel();
    expect(html).toContain('Review status with the oncoming watch');
    expect(html).toContain('It is never a statement that it is safe to take watch.');
    // The affirmative claim must not appear anywhere; the sentence above is the only mention,
    // and only inside its negation.
    expect(html).not.toContain('Safe to take watch');
    expect(html.match(/safe to take watch/g)).toHaveLength(1);
    expect(html).toContain('no alarms are acknowledged and no navigation is altered');
  });

  it('labels each snapshot with its sync state and facts', () => {
    const html = renderPanel({
      records: [
        {
          id: 'a',
          createdAt: Date.UTC(2026, 7, 10, 12, 0),
          note: 'Traffic light, wind building.',
          facts: [{ label: 'GPS fix', value: 'live, 2s ago' }],
          sync: 'pending',
        },
        {
          id: 'b',
          createdAt: Date.UTC(2026, 7, 10, 11, 0),
          note: '',
          facts: [],
          sync: 'shared',
        },
      ],
    });
    expect(html).toContain('Waiting to sync');
    expect(html).toContain('Shared with other stations');
    expect(html).toContain('GPS fix');
    expect(html).toContain('Traffic light, wind building.');
  });

  it('explains the device-only degrade instead of hiding it', () => {
    const html = renderPanel({ loadState: 'unavailable' });
    expect(html).toContain('snapshots stay on this device and sync when it returns');
  });

  it('shows queue capacity and a recoverable full state without silently removing records', () => {
    const html = renderPanel({ pendingCount: 10, queueFull: true, draft: 'Hold this note.' });
    expect(html).toContain('10 of 10 offline queue slots used');
    expect(html).toContain('No queued records have been removed');
    expect(html).toContain('Retry syncing');
    expect(html).toContain('Discard note');
    expect(html).toMatch(/<button\b[^>]*\bdisabled[^>]*>\s*Take handoff snapshot\s*<\/button>/);
  });

  it('does not imply a failed device write is durable', () => {
    expect(renderPanel({ memoryOnly: true })).toContain('Changes are in memory only');
  });
});
