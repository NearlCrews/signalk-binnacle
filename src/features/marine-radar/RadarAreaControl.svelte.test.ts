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
      areaDraft: undefined,
      onSave: vi.fn(),
      onDraftChange: vi.fn(),
      onStartChartEdit: vi.fn(),
      onStopChartEdit: vi.fn(),
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

  it('offers native sector editing with an explicit no-transmit label', () => {
    const html = body(
      { ...zone, id: 'noTransmit', name: 'No transmit', type: 'sector' },
      { value: -1, endValue: 1, enabled: true },
    );
    expect(html).toContain('No-transmit sector enabled');
    expect(html).toContain('Edit no-transmit sector');
    expect(html).not.toContain('Edit guard zone');
  });

  it('offers a complete native rectangle editor', () => {
    const html = body(
      {
        id: 'exclusionRect1',
        name: 'Exclusion rectangle 1',
        dialect: 'native',
        type: 'rect',
        range: { min: 0, max: 100_000, unit: 'm' },
        hasEnabled: true,
        maxDistance: 100_000,
      },
      { x1: -100, y1: 50, x2: 100, y2: 50, width: 20, enabled: true },
    );
    expect(html).toContain('Rectangle enabled');
    expect(html).toContain('Edit exclusion rectangle');
  });

  it('treats a fresh native rectangle with omitted enabled state as disabled and editable', () => {
    const html = body(
      {
        id: 'exclusionRect1',
        name: 'Exclusion rectangle 1',
        dialect: 'native',
        type: 'rect',
        range: { min: 0, max: 100_000, unit: 'm' },
        hasEnabled: true,
        maxDistance: 100_000,
      },
      { value: 0, x1: 0, y1: 0, x2: 0, y2: 0, width: 0 },
    );
    expect(html).toContain('Rectangle disabled');
    expect(html).toContain('Edit exclusion rectangle');
  });
});
