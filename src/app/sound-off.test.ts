import { describe, expect, it } from 'vitest';
import { soundOffState, watchArmed } from './sound-off';

const calm = {
  anchorWatching: false,
  shallowMonitoring: false,
  aisTargets: 0,
  routeActive: false,
  alarmRaised: false,
};

describe('watchArmed', () => {
  it('is false with nothing this display would sound for', () => {
    expect(watchArmed(calm)).toBe(false);
  });

  it('arms on any watch', () => {
    expect(watchArmed({ ...calm, anchorWatching: true })).toBe(true);
    expect(watchArmed({ ...calm, shallowMonitoring: true })).toBe(true);
    expect(watchArmed({ ...calm, aisTargets: 1 })).toBe(true);
    expect(watchArmed({ ...calm, routeActive: true })).toBe(true);
    expect(watchArmed({ ...calm, alarmRaised: true })).toBe(true);
  });
});

describe('soundOffState', () => {
  it('shows only while armed and the gate is not ready', () => {
    expect(soundOffState('ready', true)).toBeUndefined();
    expect(soundOffState('blocked', false)).toBeUndefined();
    expect(soundOffState('blocked', true)).toBe('blocked');
    expect(soundOffState('failed', true)).toBe('failed');
    expect(soundOffState('unsupported', true)).toBe('unsupported');
  });
});
