import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import RadarAreaControl from './RadarAreaControl.svelte';
import type { ControlDefinition, RadarControlEntry } from './radar-types';

const zone: ControlDefinition = {
  id: 'guardZone1',
  name: 'Guard zone 1',
  dialect: 'native',
  type: 'zone',
  range: { min: -Math.PI, max: Math.PI, step: Math.PI / 180, unit: 'rad' },
  hasEnabled: true,
  maxDistance: 100_000,
};
const entry: RadarControlEntry = {
  value: -Math.PI / 2,
  endValue: Math.PI / 2,
  startDistance: 200,
  endDistance: 500,
  enabled: false,
  allowed: true,
};

function body(
  definition: ControlDefinition = zone,
  value: RadarControlEntry | undefined = entry,
): string {
  return render(RadarAreaControl, {
    props: {
      definition,
      entry: value,
      radarId: 'halo',
      unitsMode: 'metric',
      controlsForbidden: false,
      pending: false,
      anotherEditorActive: false,
      onSave: vi.fn(),
      onEditStateChange: vi.fn(),
    },
  }).body;
}

describe('RadarAreaControl', () => {
  it('identifies disabled configuration without calling it an alarm', () => {
    const html = body();
    expect(html).toContain('Zone disabled');
    expect(html).toContain('Edit guard zone');
    expect(html).not.toContain('Alarm active');
  });

  it('keeps an unknown compound shape readable and unsupported', () => {
    const html = body(
      {
        id: 'providerShape',
        name: 'Provider shape',
        dialect: 'v5',
        type: 'compound',
      },
      { value: 2, enabled: true },
    );
    expect(html).toContain('value: 2');
    expect(html).toContain('provider-defined control is not supported for editing');
    expect(html).not.toContain('Edit guard zone');
  });

  it('disables editing when the live allowed flag is false', () => {
    const html = body(zone, { ...entry, allowed: false });
    expect(html).toContain('disabled');
    expect(html).toContain('not allowing changes');
  });

  it('keeps sectors read-only and explains their transmission effect', () => {
    const html = body(
      { ...zone, id: 'noTransmit', name: 'No transmit', type: 'sector' },
      { value: -1, endValue: 1, enabled: true },
    );
    expect(html).toContain('can control radar transmission');
    expect(html).not.toContain('Edit guard zone');
  });
});
