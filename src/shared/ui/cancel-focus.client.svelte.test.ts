import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreFocusAfterCancel } from './cancel-focus';

const mounted: HTMLElement[] = [];

function button(): HTMLButtonElement {
  const control = document.createElement('button');
  document.body.append(control);
  mounted.push(control);
  return control;
}

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
});

describe('restoreFocusAfterCancel', () => {
  it('resolves the replacement trigger after the closing control is removed', async () => {
    const cancel = button();
    cancel.focus();
    let trigger: HTMLButtonElement | undefined;
    const getTrigger = vi.fn(() => trigger);
    const restoring = restoreFocusAfterCancel(getTrigger);
    expect(getTrigger).not.toHaveBeenCalled();
    cancel.remove();
    trigger = button();
    await restoring;

    expect(document.activeElement).toBe(trigger);
    expect(getTrigger).toHaveBeenCalledOnce();
  });

  it('does not steal focus from another control reached before the update finishes', async () => {
    const cancel = button();
    const trigger = button();
    const elsewhere = button();
    cancel.focus();
    const restoring = restoreFocusAfterCancel(() => trigger);
    cancel.remove();
    elsewhere.focus();
    await restoring;

    expect(document.activeElement).toBe(elsewhere);
  });

  it('honors an explicit closing surface without reclaiming focus already outside it', async () => {
    const prompt = document.createElement('div');
    document.body.append(prompt);
    mounted.push(prompt);
    const trigger = button();
    const elsewhere = button();
    elsewhere.focus();
    await restoreFocusAfterCancel(() => trigger, prompt);

    expect(document.activeElement).toBe(elsewhere);
  });

  it('ignores a trigger removed with its panel before the update finishes', async () => {
    const cancel = button();
    const trigger = button();
    const focus = vi.spyOn(trigger, 'focus');
    cancel.focus();
    const restoring = restoreFocusAfterCancel(() => trigger);
    cancel.remove();
    trigger.remove();
    await restoring;

    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('tolerates a trigger that no longer exists', async () => {
    const cancel = button();
    cancel.focus();
    await restoreFocusAfterCancel(() => undefined);
    expect(document.activeElement).toBe(cancel);
  });
});
