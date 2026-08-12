import { describe, expect, it } from 'vitest';
import {
  controlWriteBlockReason,
  isPowerControl,
  isPrimaryControl,
  widgetKind,
} from './radar-controls-model';
import type { ControlDefinition } from './radar-types';

const definition = (value: Omit<ControlDefinition, 'dialect'>): ControlDefinition => ({
  ...value,
  dialect: 'native',
});

describe('controlWriteBlockReason', () => {
  const writable = definition({ id: 'gain', name: 'Gain', type: 'number' });

  it('combines capability, live, and access state', () => {
    expect(controlWriteBlockReason(writable, { value: 10 }, false)).toBeUndefined();
    expect(
      controlWriteBlockReason({ ...writable, readOnly: true }, { value: 10 }, false),
    ).toContain('read-only');
    expect(controlWriteBlockReason(writable, { value: 10, allowed: false }, false)).toContain(
      'not allowing',
    );
    expect(controlWriteBlockReason(writable, { value: 10 }, true)).toContain(
      'Read and write access',
    );
  });

  it('does not attribute a Binnacle-built fallback definition to the radar', () => {
    const fallback: ControlDefinition = {
      id: 'gain',
      name: 'gain',
      dialect: 'fallback',
      type: 'number',
      readOnly: true,
    };
    const reason = controlWriteBlockReason(fallback, { value: 10 }, false);
    expect(reason).toBe('Control type information is not available for this provider.');
    expect(reason).not.toContain('The radar reports');
  });
});

describe('widgetKind', () => {
  it('returns "toggle" for a boolean control', () => {
    const def = definition({ id: 'power', name: 'Power', type: 'boolean' });
    expect(widgetKind(def)).toBe('toggle');
  });

  it('returns "list" for an enum control', () => {
    const def = definition({
      id: 'mode',
      name: 'Mode',
      type: 'enum',
      values: [
        { value: 0, label: 'Off' },
        { value: 1, label: 'Bird' },
        { value: 2, label: 'Harbor' },
      ],
    });
    expect(widgetKind(def)).toBe('list');
  });

  it('returns "slider" for a number control', () => {
    const def = definition({
      id: 'gain',
      name: 'Gain',
      type: 'number',
      range: { min: 0, max: 100 },
    });
    expect(widgetKind(def)).toBe('slider');
  });

  it('returns "structured" for an unknown compound control', () => {
    const def = definition({
      id: 'sea',
      name: 'Sea Clutter',
      type: 'compound',
      range: { min: 0, max: 100 },
      modes: ['auto', 'manual'],
    });
    expect(widgetKind(def)).toBe('structured');
  });

  it('returns "slider" for a number control with no range specified', () => {
    const def = definition({ id: 'rain', name: 'Rain Clutter', type: 'number' });
    expect(widgetKind(def)).toBe('slider');
  });

  it('returns "toggle" for a read-only boolean flag', () => {
    const def = definition({
      id: 'transmit',
      name: 'Transmitting',
      type: 'boolean',
      readOnly: true,
    });
    expect(widgetKind(def)).toBe('toggle');
  });
});

describe('isPowerControl and isPrimaryControl', () => {
  it('identifies the power and status controls so they leave the generic lists', () => {
    expect(isPowerControl(definition({ id: 'power', name: 'Power', type: 'enum' }))).toBe(true);
    expect(isPowerControl(definition({ id: 'status', name: 'Status', type: 'enum' }))).toBe(true);
    expect(isPowerControl(definition({ id: 'gain', name: 'Gain', type: 'number' }))).toBe(false);
  });

  it('treats gain, sea, rain, and range as primary controls', () => {
    for (const id of ['gain', 'sea', 'rain', 'range']) {
      expect(isPrimaryControl(definition({ id, name: id, type: 'number' }))).toBe(true);
    }
    expect(isPrimaryControl(definition({ id: 'doppler', name: 'Doppler', type: 'enum' }))).toBe(
      false,
    );
  });
});
