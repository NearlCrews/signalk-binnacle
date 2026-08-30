import { MAX_ALARM_VOLUME, MIN_ALARM_VOLUME, setAlarmVolume } from '$shared/audio';
import { clamp } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import { boundedNumberPersistedCodec, PersistedValue, type StorageLike } from '$shared/settings';

export const DEFAULT_ALARM_VOLUME = MAX_ALARM_VOLUME;

// The device alarm loudness the panel's slider reads and writes. One object owns both halves of a
// change (the persisted value and the live master volume), so they can never drift apart the way
// two calls at a call site would.
export interface AlarmVolumeSetting {
  // The persisted loudness fraction, reactive for the slider.
  readonly value: number;
  set(fraction: number): void;
}

// Per-device on purpose (localStorage, never a profile bundle): a cockpit tablet over an engine
// and a berth display beside a sleeping off-watch need different loudness for the same profile.
// Constructing it applies the stored loudness, so a reload keeps the device's set volume without
// waiting for the Alarms panel to open.
export function createAlarmVolume(storage?: StorageLike): AlarmVolumeSetting {
  const persisted = new PersistedValue(
    binnacleStorageKey('alarmVolume'),
    DEFAULT_ALARM_VOLUME,
    storage,
    boundedNumberPersistedCodec(MIN_ALARM_VOLUME, MAX_ALARM_VOLUME),
  );
  setAlarmVolume(persisted.value);
  return {
    get value() {
      return persisted.value;
    },
    set(fraction: number) {
      if (!Number.isFinite(fraction)) return;
      const bounded = clamp(fraction, MIN_ALARM_VOLUME, MAX_ALARM_VOLUME);
      persisted.set(bounded);
      setAlarmVolume(bounded);
    },
  };
}
