import { flushSync, mount, tick, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import UnitField from './UnitField.svelte';

describe('UnitField numeric commits', () => {
  it.each(['', '1e', '-1', '100.5', '0.3'])(
    'rejects incomplete or invalid input %j',
    async (entry) => {
      const target = document.createElement('div');
      document.body.append(target);
      const onCommit = vi.fn();
      const component = mount(UnitField, {
        target,
        props: { label: 'Threshold', value: 25, min: 0, max: 100, step: 0.5, onCommit },
      });
      flushSync();
      const input = target.querySelector('input');
      if (!input) throw new Error('Missing numeric field');
      input.value = entry;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await tick();
      expect(onCommit).not.toHaveBeenCalled();
      expect(input.value).toBe('25');
      await unmount(component);
      target.remove();
    },
  );

  it.each([0, 12.5])('preserves a valid intentional value %s', async (entry) => {
    const target = document.createElement('div');
    const onCommit = vi.fn();
    const component = mount(UnitField, {
      target,
      props: { label: 'Threshold', value: 25, min: 0, max: 100, step: 0.5, onCommit },
    });
    flushSync();
    const input = target.querySelector('input');
    if (!input) throw new Error('Missing numeric field');
    input.value = String(entry);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(onCommit).toHaveBeenCalledWith(entry);
    await unmount(component);
  });
});
