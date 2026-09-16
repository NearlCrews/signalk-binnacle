import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StorageView from './StorageView.svelte';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
});

describe('StorageView cancellation focus', () => {
  it('returns focus to Clear recently viewed without clearing storage', async () => {
    const state = $state({ confirming: false });
    const target = document.createElement('div');
    document.body.append(target);
    const onConfirmClear = vi.fn();
    const component = mount(StorageView, {
      target,
      props: {
        stats: null,
        usedPercent: 0,
        used: null,
        cap: null,
        pinned: null,
        scroll: null,
        automatic: null,
        ttlDays: 14,
        writerState: 'idle',
        adminAccess: true,
        get confirmingClear() {
          return state.confirming;
        },
        clearNote: null,
        chartLabel: (id) => id,
        onCommitTtl: vi.fn(),
        onRetryTtl: vi.fn(),
        onRequestClear: () => {
          state.confirming = true;
        },
        onConfirmClear,
        onCancelClear: () => {
          state.confirming = false;
        },
      },
    });
    flushSync();
    cleanups.push(() => {
      void unmount(component);
      target.remove();
    });
    const action = () => {
      const found = [...target.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Clear recently viewed',
      );
      if (!found) throw new Error('Missing clear storage action');
      return found;
    };
    action().focus();
    action().click();
    flushSync();
    const cancel = [...target.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Cancel',
    );
    if (!cancel) throw new Error('Missing clear storage cancellation');
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    flushSync();
    await tick();
    expect(document.activeElement).toBe(action());
    expect(onConfirmClear).not.toHaveBeenCalled();
  });
});
