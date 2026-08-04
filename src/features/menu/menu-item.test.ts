import { describe, expect, it } from 'vitest';
import { blockedReason, countBadge, countSuffix, itemBlocked, type MenuItem } from './menu-item';

const noop = () => {};
const item = (extra: Partial<MenuItem> = {}): MenuItem => ({
  id: 'x',
  label: 'X',
  onSelect: noop,
  ...extra,
});

describe('itemBlocked', () => {
  it('is false for a plain interactive item', () => {
    expect(itemBlocked(item())).toBe(false);
    expect(itemBlocked(item({ available: true }))).toBe(false);
  });

  it('is true when transiently disabled', () => {
    expect(itemBlocked(item({ disabled: true }))).toBe(true);
  });

  it('is true when the provider is absent', () => {
    expect(itemBlocked(item({ available: false }))).toBe(true);
  });
});

describe('blockedReason', () => {
  it('is undefined for an interactive item', () => {
    expect(blockedReason(item())).toBeUndefined();
  });

  it('returns the unavailable hint when the provider is absent', () => {
    expect(blockedReason(item({ available: false, unavailableHint: 'Install mayara' }))).toBe(
      'Install mayara',
    );
  });

  it('returns the disabled reason when transiently disabled', () => {
    expect(blockedReason(item({ disabled: true, disabledLabel: 'Chart loading' }))).toBe(
      'Chart loading',
    );
  });

  it('prefers the provider-absent hint over the disabled reason when both apply', () => {
    expect(
      blockedReason(
        item({
          available: false,
          unavailableHint: 'Install mayara',
          disabled: true,
          disabledLabel: 'Chart loading',
        }),
      ),
    ).toBe('Install mayara');
  });

  it('is undefined when a state is set without its reason text', () => {
    expect(blockedReason(item({ available: false }))).toBeUndefined();
    expect(blockedReason(item({ disabled: true }))).toBeUndefined();
  });
});

describe('countBadge', () => {
  it('is undefined when the item carries no count', () => {
    expect(countBadge(item())).toBeUndefined();
  });

  it('is undefined for an empty count, so a quiet item shows no chip', () => {
    expect(countBadge(item({ count: 0 }))).toBeUndefined();
  });

  it('renders a small count as is', () => {
    expect(countBadge(item({ count: 1 }))).toBe('1');
    expect(countBadge(item({ count: 12 }))).toBe('12');
    expect(countBadge(item({ count: 99 }))).toBe('99');
  });

  it('caps a large count at 99+ so a chip cannot widen its pill', () => {
    expect(countBadge(item({ count: 100 }))).toBe('99+');
    expect(countBadge(item({ count: 4_321 }))).toBe('99+');
  });

  it('floors a fractional count to honor the whole-number contract', () => {
    expect(countBadge(item({ count: 1.5 }))).toBe('1');
  });

  it('ignores a negative or non-finite count', () => {
    expect(countBadge(item({ count: -3 }))).toBeUndefined();
    expect(countBadge(item({ count: Number.NaN }))).toBeUndefined();
    expect(countBadge(item({ count: Number.POSITIVE_INFINITY }))).toBe('99+');
  });
});

describe('countSuffix', () => {
  it('is undefined exactly when there is no chip to explain', () => {
    expect(countSuffix(item())).toBeUndefined();
    expect(countSuffix(item({ count: 0 }))).toBeUndefined();
    expect(countSuffix(item({ count: -1, countNoun: 'alarm' }))).toBeUndefined();
  });

  it('names the counted thing, singular and plural', () => {
    expect(countSuffix(item({ count: 1, countNoun: 'alarm' }))).toBe(', 1 active alarm');
    expect(countSuffix(item({ count: 3, countNoun: 'alarm' }))).toBe(', 3 active alarms');
  });

  it('keeps the exact count past the chip cap', () => {
    expect(countSuffix(item({ count: 240, countNoun: 'alarm' }))).toBe(', 240 active alarms');
  });

  it('falls back to the nounless suffix for an item that names nothing', () => {
    expect(countSuffix(item({ count: 2 }))).toBe(', 2 active');
    expect(countSuffix(item({ count: 2, countNoun: '  ' }))).toBe(', 2 active');
  });
});
