import { describe, expect, it } from 'vitest';
import { sameJsonValue } from './object';

describe('sameJsonValue', () => {
  it('compares nested JSON values without depending on object key order', () => {
    expect(
      sameJsonValue(
        { layers: { radar: { visible: true, opacity: 0.5 } }, order: ['radar'] },
        { order: ['radar'], layers: { radar: { opacity: 0.5, visible: true } } },
      ),
    ).toBe(true);
  });

  it('detects array order, missing keys, and changed values', () => {
    expect(sameJsonValue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameJsonValue({ enabled: true }, {})).toBe(false);
    expect(sameJsonValue({ enabled: true }, { enabled: false })).toBe(false);
  });
});
