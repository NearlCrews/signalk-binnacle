import { flushSync } from 'svelte';
import { expect, it } from 'vitest';
import { createAlarmLog } from '$features/lookout';
import { createSafetyController } from './safety-controller.svelte';

it('records reactive hazard edges without subscribing its effect to the log or timestamp clock', () => {
  const state = $state({ active: false, text: '' });
  const clock = $state({ now: 1_000 });
  const log = createAlarmLog(clock);
  let controller!: ReturnType<typeof createSafetyController>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      controller = createSafetyController({
        record: (event) => log.record(event),
        channels: () => [
          {
            id: 'mob',
            rank: 0,
            text: state.text,
            history: { label: 'Man overboard', active: state.active },
          },
        ],
      });
    });
  });
  try {
    flushSync(() => {
      clock.now = 2_000;
      state.active = true;
      state.text = 'Man overboard.';
    });
    expect(log.entries).toEqual([
      { kind: 'raised', label: 'Man overboard', source: 'mob', timeMs: 2_000 },
    ]);
    expect(controller.assertive).toBe('Man overboard.');
    flushSync(() => {
      clock.now = 3_000;
      state.text = 'Man overboard. Range updated.';
    });
    log.record({ kind: 'status', label: 'Other concern' });
    flushSync();
    expect(log.entries).toHaveLength(2);
    flushSync(() => {
      state.active = false;
      state.text = '';
    });
    expect(log.entries.at(-1)).toMatchObject({ kind: 'cleared', source: 'mob', timeMs: 3_000 });
    expect(controller.assertive).toBe('');
  } finally {
    controller.dispose();
    disposeRoot();
  }
});
