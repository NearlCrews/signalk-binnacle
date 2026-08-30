import { afterEach, describe, expect, it } from 'vitest';
import { alarmVolume, MIN_ALARM_VOLUME } from '$shared/audio';
import { binnacleStorageKey } from '$shared/persistence';
import { createFakeStorage } from '$shared/testing';
import { createAlarmVolume, DEFAULT_ALARM_VOLUME } from './alarm-volume';

const KEY = binnacleStorageKey('alarmVolume');

afterEach(() => {
  // The master volume is module-global in $shared/audio; put it back so no other suite inherits a
  // turned-down alarm.
  createAlarmVolume(createFakeStorage()).set(DEFAULT_ALARM_VOLUME);
});

describe('createAlarmVolume', () => {
  it('persists a change and applies it to the live master volume in one call', () => {
    const storage = createFakeStorage();
    const setting = createAlarmVolume(storage);
    expect(setting.value).toBe(DEFAULT_ALARM_VOLUME);

    setting.set(0.6);
    expect(setting.value).toBe(0.6);
    expect(alarmVolume()).toBe(0.6);
    expect(storage.data.get(KEY)).toBe('0.6');
  });

  it('applies the stored loudness at construction, so a reload keeps the device volume', () => {
    createAlarmVolume(createFakeStorage({ [KEY]: '0.4' }));
    expect(alarmVolume()).toBe(0.4);
  });

  it('bounds the fraction and drops non-finite input', () => {
    const setting = createAlarmVolume(createFakeStorage());
    setting.set(0);
    expect(setting.value).toBe(MIN_ALARM_VOLUME);
    setting.set(5);
    expect(setting.value).toBe(1);
    setting.set(0.8);
    setting.set(Number.NaN);
    expect(setting.value).toBe(0.8);
    expect(alarmVolume()).toBe(0.8);
  });

  it('replaces a corrupt stored value with the default instead of a silent or blaring alarm', () => {
    const setting = createAlarmVolume(createFakeStorage({ [KEY]: '"loud"' }));
    expect(setting.value).toBe(DEFAULT_ALARM_VOLUME);
    expect(alarmVolume()).toBe(DEFAULT_ALARM_VOLUME);
  });
});
