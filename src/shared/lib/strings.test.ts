import { describe, expect, it } from 'vitest';
import { hasControlCharacters } from './strings';

describe('hasControlCharacters', () => {
  it('finds C0 and delete characters without rejecting ordinary Unicode', () => {
    expect(hasControlCharacters('safe Harbor 2')).toBe(false);
    expect(hasControlCharacters('Café')).toBe(false);
    expect(hasControlCharacters('bad\u0000id')).toBe(true);
    expect(hasControlCharacters('line\nbreak')).toBe(true);
    expect(hasControlCharacters('delete\u007f')).toBe(true);
  });
});
