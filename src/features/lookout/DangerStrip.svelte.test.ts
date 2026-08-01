import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { CollisionAssessment, DangerContact } from '$entities/collision';
import DangerStrip from './DangerStrip.svelte';

function strip(contacts: DangerContact[]): string {
  const collision = {
    assessment: { contacts, worst: contacts[0]?.severity ?? 'clear' },
    suppressed: false,
    escalating: false,
  } as unknown as CollisionAssessment;
  return render(DangerStrip, {
    props: { collision, muted: false, onToggleMute: vi.fn() },
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
});
