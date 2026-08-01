import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { UnitsStore } from '$entities/units';
import AisTargetDetail from './AisTargetDetail.svelte';
import type { AisListRow } from './ais-rows';

function detail(severity: AisListRow['severity']): string {
  const row = {
    id: 'vessels.urn:mrn:imo:mmsi:111111111',
    identifier: '111111111',
    label: 'FAR STAR',
    position: { latitude: 42, longitude: -83 },
    severity,
    rangeMeters: 900,
    bearingRad: 1,
    sogMps: 4,
    cogRad: 2,
    cpaMeters: 400,
    tcpaSeconds: 300,
  } as AisListRow;
  return render(AisTargetDetail, {
    props: { row, units: new UnitsStore(), onBack: vi.fn(), onLocate: vi.fn() },
  }).body;
}

describe('AisTargetDetail', () => {
  // The banner is server-raised safety state, not a response to anything the navigator did in this
  // panel, so an assistive-technology user has to hear it with the urgency a sighted one sees.
  it('announces a collision-risk banner as an alert, matching its alarm styling', () => {
    const html = detail('danger');
    expect(html).toContain('Collision risk.');
    expect(html).toMatch(/class="alert-note[^"]*"[^>]*role="alert"/);
    expect(html).not.toMatch(/class="alert-note[^"]*"[^>]*role="status"/);
  });

  it('announces the getting-close banner as an alert too', () => {
    const html = detail('warning');
    expect(html).toContain('Getting close.');
    expect(html).toMatch(/class="alert-note[^"]*"[^>]*role="alert"/);
  });

  it('shows no risk banner for a target that is not a risk', () => {
    const html = detail(undefined);
    expect(html).not.toContain('Collision risk.');
    expect(html).not.toContain('Getting close.');
  });
});
