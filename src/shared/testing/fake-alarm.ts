import type { AlarmControl, AlarmTone } from '$shared/audio';

// Test-only AlarmControl fake recording the call sequence and the last tone started. Imported by
// *.test.ts files, never by production code.
export function createFakeAlarmControl() {
  const events: string[] = [];
  let tone: AlarmTone | undefined;
  const control: AlarmControl = {
    start: (next) => {
      events.push('start');
      tone = next;
    },
    stop: () => void events.push('stop'),
  };
  return { control, events, lastTone: () => tone };
}
