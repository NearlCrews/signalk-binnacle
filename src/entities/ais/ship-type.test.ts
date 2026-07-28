import { describe, expect, it } from 'vitest';
import { aisShipTypeLabel } from './ship-type';

describe('aisShipTypeLabel', () => {
  it('names exact operational vessel types', () => {
    expect(aisShipTypeLabel(30)).toBe('Fishing vessel');
    expect(aisShipTypeLabel(36)).toBe('Sailing vessel');
    expect(aisShipTypeLabel(52)).toBe('Tug');
  });

  it('names the shared AIS ship classes', () => {
    expect(aisShipTypeLabel(42)).toBe('High-speed craft');
    expect(aisShipTypeLabel(61)).toBe('Passenger ship');
    expect(aisShipTypeLabel(74)).toBe('Cargo ship');
    expect(aisShipTypeLabel(83)).toBe('Tanker');
    expect(aisShipTypeLabel(95)).toBe('Other vessel');
  });

  it('keeps unavailable and unsupported ids honest', () => {
    expect(aisShipTypeLabel(0)).toBe('Not available');
    expect(aisShipTypeLabel(12)).toBe('Unknown ship type');
    expect(aisShipTypeLabel(100)).toBe('Unknown ship type');
    expect(aisShipTypeLabel(Number.NaN)).toBe('Unknown ship type');
  });
});
