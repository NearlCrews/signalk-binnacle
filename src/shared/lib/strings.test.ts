import { describe, expect, it } from 'vitest';
import { capitalize, cleanBoundedText, hasControlCharacters, isUnsafeProviderKey } from './strings';

describe('hasControlCharacters', () => {
  it('finds C0 and delete characters without rejecting ordinary Unicode', () => {
    expect(hasControlCharacters('safe Harbor 2')).toBe(false);
    expect(hasControlCharacters('Café')).toBe(false);
    expect(hasControlCharacters('bad\u0000id')).toBe(true);
    expect(hasControlCharacters('line\nbreak')).toBe(true);
    expect(hasControlCharacters('delete\u007f')).toBe(true);
  });
});

describe('cleanBoundedText', () => {
  it('trims surrounding whitespace', () => {
    expect(cleanBoundedText('  Safe Harbor  ', 20)).toBe('Safe Harbor');
  });

  it('rejects a non-string value', () => {
    expect(cleanBoundedText(5, 20)).toBeUndefined();
  });

  it('rejects a string that is empty after trimming', () => {
    expect(cleanBoundedText('   ', 20)).toBeUndefined();
  });

  it('rejects a string over the bound', () => {
    expect(cleanBoundedText('123456', 5)).toBeUndefined();
  });

  it('rejects a string carrying control characters', () => {
    expect(cleanBoundedText('bad\u0000id', 20)).toBeUndefined();
  });

  it('accepts a clean bounded string', () => {
    expect(cleanBoundedText('Safe Harbor', 20)).toBe('Safe Harbor');
  });
});

describe('isUnsafeProviderKey', () => {
  it('rejects an empty key', () => {
    expect(isUnsafeProviderKey('')).toBe(true);
  });

  it('rejects a key over 512 characters', () => {
    expect(isUnsafeProviderKey('a'.repeat(513))).toBe(true);
  });

  it('rejects a key carrying control characters', () => {
    expect(isUnsafeProviderKey('bad\u0000id')).toBe(true);
  });

  it('rejects prototype-polluting keys', () => {
    expect(isUnsafeProviderKey('__proto__')).toBe(true);
    expect(isUnsafeProviderKey('prototype')).toBe(true);
    expect(isUnsafeProviderKey('constructor')).toBe(true);
  });

  it('accepts a plain id', () => {
    expect(isUnsafeProviderKey('route-1')).toBe(false);
  });
});

describe('capitalize', () => {
  it('upper-cases the first character and leaves the rest', () => {
    expect(capitalize('anchor')).toBe('Anchor');
  });

  it('leaves an already-capitalized word unchanged', () => {
    expect(capitalize('Anchor')).toBe('Anchor');
  });

  it('returns an empty string unchanged', () => {
    expect(capitalize('')).toBe('');
  });
});
