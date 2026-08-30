import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { UnitsStore } from '$entities/units';
import type { ConnectionPhase } from '$shared/signalk';
import AisTargetDetail from './AisTargetDetail.svelte';
import type { AisListRow } from './ais-rows';

function detail(
  severity: AisListRow['severity'],
  connectionPhase: ConnectionPhase = 'open',
  overrides: Partial<AisListRow> = {},
): string {
  const row = {
    id: 'vessels.urn:mrn:imo:mmsi:111111111',
    identifier: '111111111',
    label: 'FAR STAR',
    kind: 'vessel',
    position: { latitude: 42, longitude: -83 },
    severity,
    rangeMeters: 900,
    bearingRad: 1,
    sogMps: 4,
    cogRad: 2,
    cpaMeters: 400,
    tcpaSeconds: 300,
    ...overrides,
  } as AisListRow;
  return render(AisTargetDetail, {
    props: { row, units: new UnitsStore(), connectionPhase, onBack: vi.fn(), onLocate: vi.fn() },
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

  // A detail view left open through a stream drop keeps rendering the last position, CPA, and TCPA,
  // so it has to say that they stopped updating.
  it('labels a dropped stream over the frozen readouts', () => {
    // Source line wrapping survives into the rendered text, so copy is asserted against a
    // whitespace-normalized body.
    const html = detail(undefined, 'closed').replace(/\s+/g, ' ');
    expect(html).toContain('Signal K is disconnected.');
    expect(html).toContain('frozen at the last update received');
  });

  it('says nothing about the stream while it is open', () => {
    expect(detail(undefined)).not.toContain('Signal K is disconnected.');
  });

  it('shows class, size, destination, and reported ETA when the target broadcast them', () => {
    // Svelte's SSR comment markers land inside the rendered text, so they are stripped before the
    // whitespace normalization.
    const html = detail(undefined, 'open', {
      aisClass: 'A',
      lengthMeters: 294,
      beamMeters: 32,
      destination: 'ROTTERDAM',
      destinationEtaMs: Date.parse('2026-09-02T06:00:00.000Z'),
    })
      .replace(/<!--.*?-->/g, '')
      .replace(/\s+/g, ' ');
    expect(html).toContain('AIS class');
    expect(html).toContain('<dd>A</dd>');
    expect(html).toContain('294 by 32 m');
    expect(html).toContain('ROTTERDAM');
    expect(html).toContain('Reported ETA');
  });

  it('omits the static rows a target never broadcast', () => {
    const html = detail(undefined);
    expect(html).not.toContain('AIS class');
    expect(html).not.toContain('Destination');
    expect(html).not.toContain('Reported ETA');
    expect(html).not.toContain('Size');
  });

  it('labels a navigation aid, names its type, and hides the vessel speed row', () => {
    const html = detail(undefined, 'open', {
      kind: 'aton',
      label: 'PT MONTARA LIGHT',
      atonType: 'Beacon, Cardinal N',
      sogMps: undefined,
      cogRad: undefined,
      cpaMeters: undefined,
      tcpaSeconds: undefined,
    }).replace(/\s+/g, ' ');
    expect(html).toContain('Navigation aid');
    expect(html).toContain('Aid type');
    expect(html).toContain('Beacon, Cardinal N');
    expect(html).not.toContain('<dt>Speed</dt>');
  });

  it('warns about an off-position aid with alert urgency and notes a virtual one quietly', () => {
    const off = detail(undefined, 'open', { kind: 'aton', offPosition: true }).replace(/\s+/g, ' ');
    expect(off).toContain('Off position.');
    expect(off).toMatch(/class="alert-note[^"]*"[^>]*role="alert"/);

    const virtual = detail(undefined, 'open', { kind: 'aton', virtual: true }).replace(/\s+/g, ' ');
    expect(virtual).toContain('Navigation aid (virtual)');
    expect(virtual).toContain('Virtual aid: broadcast only');
    expect(virtual).not.toContain('Off position.');
  });

  it('tags a SAR target', () => {
    const html = detail(undefined, 'open', { kind: 'sar' });
    expect(html).toContain('SAR');
  });
});
