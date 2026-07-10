import { describe, expect, it } from 'vitest';
import type { AisTargetView } from '$entities/ais';
import type { DangerContact } from '$entities/collision';
import { buildAisRows } from './ais-rows';

const OWN = { latitude: 0, longitude: 0 };

function target(partial: Partial<AisTargetView> & { id: string }): AisTargetView {
  return { position: { latitude: 0.001, longitude: 0 }, ...partial };
}

describe('buildAisRows', () => {
  it('labels by name when reported, otherwise by MMSI', () => {
    const rows = buildAisRows(
      [
        target({ id: 'vessels.urn:mrn:imo:mmsi:111111111', name: 'WANDERER' }),
        target({ id: 'vessels.urn:mrn:imo:mmsi:222222222' }),
      ],
      OWN,
      [],
      'name',
    );
    expect(rows.map((r) => r.label)).toEqual(['222222222', 'WANDERER']);
  });

  it('computes range and bearing from own position, absent without a fix', () => {
    const [row] = buildAisRows([target({ id: 'a' })], OWN, [], 'range');
    expect(row.rangeMeters).toBeCloseTo(111.19, 0);
    expect(((row.bearingRad ?? -1) * 180) / Math.PI).toBeCloseTo(0, 5);
    const [noFix] = buildAisRows([target({ id: 'a' })], undefined, [], 'range');
    expect(noFix.rangeMeters).toBeUndefined();
    expect(noFix.bearingRad).toBeUndefined();
  });

  it('sorts by range with unknowns last', () => {
    const rows = buildAisRows(
      [
        target({ id: 'far', position: { latitude: 0.01, longitude: 0 } }),
        target({ id: 'near', position: { latitude: 0.001, longitude: 0 } }),
      ],
      OWN,
      [],
      'range',
    );
    expect(rows.map((r) => r.id)).toEqual(['near', 'far']);
    const noFix = buildAisRows([target({ id: 'a' }), target({ id: 'b' })], undefined, [], 'range');
    expect(noFix).toHaveLength(2);
  });

  it('sorts by CPA with no-CPA targets last', () => {
    const rows = buildAisRows(
      [
        target({ id: 'none' }),
        target({ id: 'wide', cpaMeters: 1800 }),
        target({ id: 'close', cpaMeters: 200 }),
      ],
      OWN,
      [],
      'cpa',
    );
    expect(rows.map((r) => r.id)).toEqual(['close', 'wide', 'none']);
  });

  it('carries the lookout severity for the row accent', () => {
    const contact = { id: 'a', severity: 'danger' } as DangerContact;
    const [row] = buildAisRows([target({ id: 'a' })], OWN, [contact], 'range');
    expect(row.severity).toBe('danger');
  });

  it('fills CPA and TCPA from the lookout contact when the provider publishes none', () => {
    const contact = {
      id: 'a',
      severity: 'danger',
      cpaMeters: 250,
      tcpaSeconds: 90,
    } as DangerContact;
    const [row] = buildAisRows([target({ id: 'a' })], OWN, [contact], 'range');
    expect(row.cpaMeters).toBe(250);
    expect(row.tcpaSeconds).toBe(90);
  });

  it('prefers the provider CPA and TCPA over the lookout values', () => {
    const contact = {
      id: 'a',
      severity: 'danger',
      cpaMeters: 250,
      tcpaSeconds: 90,
    } as DangerContact;
    const [row] = buildAisRows(
      [target({ id: 'a', cpaMeters: 300, tcpaSeconds: 120 })],
      OWN,
      [contact],
      'range',
    );
    expect(row.cpaMeters).toBe(300);
    expect(row.tcpaSeconds).toBe(120);
  });

  it('carries heading and navigation state through from the target', () => {
    const [row] = buildAisRows(
      [target({ id: 'a', headingRad: 1.2, navigationState: 'anchored' })],
      OWN,
      [],
      'range',
    );
    expect(row.headingRad).toBe(1.2);
    expect(row.navigationState).toBe('anchored');
  });
});
