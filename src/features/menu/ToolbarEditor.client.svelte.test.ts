import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from './menu-item';
import ToolbarEditor from './ToolbarEditor.svelte';

const mounted: Array<() => void> = [];

const action = (id: string): MenuItem => ({ id, label: id, onSelect: () => {} });

function mountEditor() {
  const onReset = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(ToolbarEditor, {
      target,
      props: { items: [action('center'), action('follow')], onReset },
    });
  });
  mounted.push(() => {
    // Teardown is synchronous without outro transitions; the returned promise only awaits those.
    void unmount(component);
    target.remove();
  });
  const byText = (text: string): HTMLButtonElement | undefined =>
    [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    );
  return {
    onReset,
    click: (text: string) => {
      const button = byText(text);
      if (!button) throw new Error(`no button labeled ${text}`);
      button.click();
      flushSync();
    },
    has: (text: string) => byText(text) !== undefined,
    question: () => target.querySelector('[role="group"] .confirm-text')?.textContent?.trim(),
  };
}

afterEach(() => {
  for (const remove of mounted.splice(0).reverse()) remove();
});

describe('ToolbarEditor reset', () => {
  it('asks before discarding a customized toolbar', () => {
    const editor = mountEditor();

    editor.click('Reset toolbar');

    expect(editor.onReset).not.toHaveBeenCalled();
    expect(editor.question()).toBe('Reset to defaults?');
  });

  it('resets only on the confirming tap', () => {
    const editor = mountEditor();

    editor.click('Reset toolbar');
    editor.click('Reset');

    expect(editor.onReset).toHaveBeenCalledTimes(1);
    expect(editor.question()).toBeUndefined();
    expect(editor.has('Reset toolbar')).toBe(true);
  });

  it('leaves the toolbar alone when the confirm is backed out of', () => {
    const editor = mountEditor();

    editor.click('Reset toolbar');
    editor.click('Cancel');

    expect(editor.onReset).not.toHaveBeenCalled();
    expect(editor.question()).toBeUndefined();
    expect(editor.has('Reset toolbar')).toBe(true);
  });
});
