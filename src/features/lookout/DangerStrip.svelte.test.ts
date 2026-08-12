import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { CollisionAssessment, DangerContact } from '$entities/collision';
import DangerStrip from './DangerStrip.svelte';

function strip(contacts: DangerContact[], overrides: Record<string, unknown> = {}): string {
  const collision = {
    assessment: { contacts, worst: contacts[0]?.severity ?? 'clear', unassessed: [] },
    suppressed: false,
    escalating: false,
  } as unknown as CollisionAssessment;
  return render(DangerStrip, {
    props: { collision, muted: false, onToggleMute: vi.fn(), ...overrides },
  }).body;
}

const contact = (severity: DangerContact['severity']): DangerContact =>
  ({
    id: 'vessels.a',
    name: 'FAR STAR',
    severity,
    cpaMeters: 400,
    tcpaSeconds: 300,
    source: 'provider',
  }) as DangerContact;

describe('DangerStrip', () => {
  it('glosses CPA and TCPA, which a navigator new to chartplotting will not know', () => {
    const html = strip([contact('danger')]);
    expect(html).toContain('Closest point of approach');
    expect(html).toContain('Time to the closest point of approach');
  });

  it('renders nothing when no contact is at risk', () => {
    expect(strip([])).not.toContain('CPA');
  });

  it('opens the named contact in Nearby vessels when the host wires the action', () => {
    const html = strip([contact('danger')], { onSelectContact: vi.fn() });
    const name = html.indexOf('FAR STAR');
    expect(html.slice(html.lastIndexOf('<', name), name)).toContain('<button');
    expect(html).toContain('Open this vessel in Nearby vessels');
    // Without the action the row stays a plain label rather than a dead control.
    const plain = strip([contact('danger')]);
    const plainName = plain.indexOf('FAR STAR');
    expect(plain.slice(plain.lastIndexOf('<', plainName), plainName)).toContain('<span');
  });
});
