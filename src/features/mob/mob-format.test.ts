import { describe, expect, it } from 'vitest';
import { formatElapsed, mobAlertText } from './mob-format';

describe('formatElapsed', () => {
  it('formats minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(95)).toBe('1:35');
    expect(formatElapsed(3599)).toBe('59:59');
  });

  it('adds hours past sixty minutes', () => {
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });
});

describe('mobAlertText', () => {
  it('speaks the bearing and range the strip shows', () => {
    expect(mobAlertText(Math.PI / 4, 120, 'metric')).toBe(
      'Man overboard. Mark is 045 degrees, 120 meters. Steer back to the mark.',
    );
    expect(mobAlertText(Math.PI / 4, 120, 'imperial')).toBe(
      'Man overboard. Mark is 045 degrees, 394 feet. Steer back to the mark.',
    );
  });

  it('spells out nautical miles past the hand-off', () => {
    expect(mobAlertText(0, 3704, 'metric')).toContain('2.00 nautical miles');
  });

  it('falls back to the bare call with no fix on both ends', () => {
    expect(mobAlertText(undefined, 120, 'metric')).toBe('Man overboard. Steer back to the mark.');
    expect(mobAlertText(1, undefined, 'metric')).toBe('Man overboard. Steer back to the mark.');
  });
});
