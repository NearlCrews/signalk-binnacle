import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import AnchorStrip from './AnchorStrip.svelte';

function renderStrip(overrides: Record<string, unknown>): string {
  return render(AnchorStrip, {
    props: {
      anchor: {
        dragging: false,
        acknowledged: false,
        degradedCause: undefined,
        fixLostAcknowledged: false,
        distanceMeters: undefined,
        radiusMeters: 50,
        ...overrides,
      } as unknown as AnchorWatch,
      units: { mode: 'metric' } as UnitsStore,
      onRaise: vi.fn(),
    },
  }).body;
}

describe('AnchorStrip', () => {
  it('renders nothing while the watch is healthy', () => {
    expect(renderStrip({})).not.toContain('bottom-strip');
  });

  it('shows the drag alarm with its actions', () => {
    const body = renderStrip({ dragging: true, distanceMeters: 60 });
    expect(body).toContain('Anchor dragging');
    expect(body).toContain('Acknowledge');
    expect(body).toContain('Raise anchor');
  });

  it('shows a first-class strip for a client fix loss', () => {
    const body = renderStrip({ degradedCause: 'fix-lost' });
    expect(body).toContain('Anchor watch: no GPS');
    expect(body).toContain('Acknowledge');
    expect(body).toContain('Raise anchor');
  });

  it('reflects the per-episode fix-lost acknowledge', () => {
    const body = renderStrip({ degradedCause: 'fix-lost', fixLostAcknowledged: true });
    expect(body).toContain('Anchor watch: no GPS');
    expect(body).toContain('Acknowledged');
    expect(body).not.toContain('>Acknowledge<');
  });

  it('lets a drag outrank the fix loss for the title', () => {
    expect(renderStrip({ dragging: true, degradedCause: 'fix-lost' })).toContain('Anchor dragging');
  });
});
