import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NoteDetailPanel from './NoteDetailPanel.svelte';
import type { NoteDetail } from './notes-detail';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('NoteDetailPanel identity', () => {
  it('mounts section items whose old concatenated keys collided', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      label: index === 1 ? 'Reading1' : index === 11 ? 'Reading' : `Value ${index}`,
      value: index,
    }));
    const detail: NoteDetail = {
      id: 'note-1',
      name: 'Quiet cove',
      sections: [{ id: 'details', title: 'Details', items }],
    };
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(NoteDetailPanel, {
        target,
        props: {
          selection: {
            id: 'note-1',
            name: 'Quiet cove',
            category: 'anchorage',
            position: { latitude: 44, longitude: -86 },
          },
          load: vi.fn().mockResolvedValue(detail),
          onClose: vi.fn(),
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    await vi.waitFor(() => {
      expect(target.querySelectorAll('.detail-list > div')).toHaveLength(items.length);
    });
    expect(target.textContent).toContain('Reading1');
    expect(target.textContent).toContain('Reading');
  });
});

describe('NoteDetailPanel navigation actions', () => {
  function mountCard() {
    const onNavigateHere = vi.fn();
    const onSaveWaypoint = vi.fn();
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(NoteDetailPanel, {
        target,
        props: {
          selection: {
            id: 'note-1',
            name: 'Quiet cove',
            category: 'anchorage',
            position: { latitude: 44, longitude: -86 },
          },
          load: vi.fn().mockResolvedValue(undefined),
          onClose: vi.fn(),
          onNavigateHere,
          onSaveWaypoint,
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });
    const button = (text: string): HTMLButtonElement => {
      const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
      );
      if (!found) throw new Error(`no button labeled ${text}`);
      return found;
    };
    const click = (text: string): void => {
      button(text).click();
      flushSync();
    };
    return { onNavigateHere, onSaveWaypoint, target, click };
  }

  it('starts navigation only through the confirm that names the place', () => {
    const card = mountCard();
    const question = 'Start navigation to Quiet cove? Check the destination before relying on it.';

    card.click('Navigate here');
    expect(card.target.textContent).toContain(question);
    expect(card.onNavigateHere).not.toHaveBeenCalled();

    card.click('Cancel');
    expect(card.target.textContent).not.toContain(question);
    expect(card.onNavigateHere).not.toHaveBeenCalled();

    card.click('Navigate here');
    card.click('Start navigation');
    expect(card.onNavigateHere).toHaveBeenCalledOnce();
    expect(card.target.textContent).not.toContain(question);
  });

  it('saves as waypoint on a single tap', () => {
    const card = mountCard();
    card.click('Save as waypoint');
    expect(card.onSaveWaypoint).toHaveBeenCalledOnce();
  });
});

describe('NoteDetailPanel recovery', () => {
  it('dismisses a mutation error and names what a failed load retries', async () => {
    const onDismissMutationError = vi.fn();
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(NoteDetailPanel, {
        target,
        props: {
          selection: {
            id: 'note-1',
            name: 'Quiet cove',
            category: 'anchorage',
            position: { latitude: 44, longitude: -86 },
            ownedByBinnacle: true,
          },
          load: vi.fn().mockResolvedValue(undefined),
          onClose: vi.fn(),
          onDelete: vi.fn(),
          mutationError: 'Could not delete the note. Check the connection, then try again.',
          onDismissMutationError,
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    await vi.waitFor(() => {
      expect(target.textContent).toContain('Retry place details');
    });

    const dismiss = target.querySelector<HTMLButtonElement>('button[aria-label="Dismiss error"]');
    expect(dismiss).not.toBeNull();
    dismiss?.click();
    flushSync();

    expect(onDismissMutationError).toHaveBeenCalledOnce();
  });
});
