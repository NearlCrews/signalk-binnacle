import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LogbookPanel from './LogbookPanel.svelte';
import type { LogbookController } from './logbook-controller.svelte';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

function composer() {
  const state = $state({ busy: false, draft: '', seededText: '' });
  let finish!: (accepted: boolean) => void;
  const addEntry = vi.fn(async () => {
    state.busy = true;
    const accepted = await new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    state.busy = false;
    return accepted;
  });
  const controller = {
    get draft() {
      return state.draft;
    },
    set draft(value: string) {
      state.draft = value;
    },
    get seededText() {
      return state.seededText;
    },
    set seededText(value: string) {
      state.seededText = value;
    },
    availability: 'available',
    entries: [],
    loadState: 'ready',
    checking: false,
    error: undefined,
    suggestion: undefined,
    get busy() {
      return state.busy;
    },
    start: vi.fn(),
    refresh: vi.fn(),
    recheck: vi.fn(),
    addEntry,
    offerEntry: vi.fn(),
    dismissSuggestion: vi.fn(),
    clearError: vi.fn(),
  } as unknown as LogbookController;
  const target = document.createElement('div');
  document.body.append(target);
  let component = mount(LogbookPanel, {
    target,
    props: { controller, origin: 'https://boat.test', onClose: vi.fn() },
  });
  flushSync();
  cleanup.push(() => {
    void unmount(component);
    target.remove();
  });
  const input = target.querySelector('textarea');
  if (!input) throw new Error('Missing composer');
  function type(value: string) {
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }
  function save() {
    const button = [...target.querySelectorAll('button')].find(
      (el) => el.textContent?.trim() === 'Add entry',
    );
    if (!button) throw new Error('Missing save');
    button.click();
    flushSync();
  }
  return {
    input,
    type,
    save,
    addEntry,
    state,
    target,
    controller,
    finish: (accepted: boolean) => finish(accepted),
    async reopen() {
      await unmount(component);
      component = mount(LogbookPanel, {
        target,
        props: { controller, origin: 'https://boat.test', onClose: vi.fn() },
      });
      flushSync();
    },
  };
}

describe('LogbookPanel pending save', () => {
  it('returns cancellation focus to Discard draft without losing the draft', async () => {
    const test = composer();
    test.type('Retain this log entry');
    const button = (label: string) => {
      const match = [...test.target.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      if (!match) throw new Error(`Missing ${label}`);
      return match;
    };
    button('Discard draft').focus();
    button('Discard draft').click();
    flushSync();
    expect(document.activeElement).toBe(button('Cancel'));
    button('Cancel').click();
    flushSync();
    await vi.waitFor(() => expect(document.activeElement).toBe(button('Discard draft')));
    expect(test.controller.draft).toBe('Retain this log entry');
    expect(test.addEntry).not.toHaveBeenCalled();
  });

  it('retains the composer across panel changes and an administrator sign-in recovery', async () => {
    const test = composer();
    test.type('Keep watch on the western approach');
    await test.reopen();
    expect(test.target.querySelector('textarea')?.value).toBe('Keep watch on the western approach');
    Object.assign(test.controller, { availability: 'unauthorized' });
    await test.reopen();
    const login = test.target.querySelector<HTMLAnchorElement>('a[href*="/admin/"]');
    expect(login?.target).toBe('_blank');
    expect(test.controller.draft).toBe('Keep watch on the western approach');
    Object.assign(test.controller, { availability: 'available' });
    await test.reopen();
    expect(test.target.querySelector('textarea')?.value).toBe('Keep watch on the western approach');
  });

  it('retains a newer draft while saving only the submitted snapshot', async () => {
    const test = composer();
    test.type('First entry');
    test.save();
    test.type('Next entry');
    test.finish(true);
    await vi.waitFor(() => expect(test.state.busy).toBe(false));
    flushSync();
    expect(test.input.value).toBe('Next entry');
    expect(test.addEntry).toHaveBeenCalledWith('First entry');
  });
  it('clears an unchanged accepted draft and retains a rejected draft', async () => {
    const accepted = composer();
    accepted.type('Accepted');
    accepted.save();
    accepted.finish(true);
    await vi.waitFor(() => expect(accepted.input.value).toBe(''));
    const rejected = composer();
    rejected.type('Retry this');
    rejected.save();
    rejected.finish(false);
    await Promise.resolve();
    flushSync();
    expect(rejected.input.value).toBe('Retry this');
  });
});
