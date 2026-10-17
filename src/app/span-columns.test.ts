import { describe, expect, it } from 'vitest';
import { columnSpan } from './span-columns';

describe('columnSpan', () => {
  it('claims the whole columns a width needs', () => {
    expect(columnSpan(90, 110, 14)).toBe(1);
    expect(columnSpan(110, 110, 14)).toBe(1);
    expect(columnSpan(111, 110, 14)).toBe(2);
    expect(columnSpan(234, 110, 14)).toBe(3);
  });

  it('ignores a rounding hair past a column edge', () => {
    expect(columnSpan(220.5, 110, 14)).toBe(2);
  });

  it('never spans fewer than one column or more than the grid has', () => {
    expect(columnSpan(0, 110, 14)).toBe(1);
    expect(columnSpan(5_000, 110, 3)).toBe(3);
  });

  it('falls back to one column before the grid has laid out', () => {
    expect(columnSpan(200, 0, 14)).toBe(1);
    expect(columnSpan(200, 110, 0)).toBe(1);
  });
});
