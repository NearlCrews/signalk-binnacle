import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArmedRow } from '$shared/ui';
import type { SavedRegionDto } from './regions-client';
import SavedRegionsView from './SavedRegionsView.svelte';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
});

function mountAreas() {
  const target = document.createElement('div');
  document.body.append(target);
  const onDelete = vi.fn();
  const armedDelete = new ArmedRow(onDelete);
  const regions: SavedRegionDto[] = ['Harbor', 'Approach'].map((name, index) => ({
    id: `area-${index}`,
    name,
    bbox: [-1, -1, 1, 1],
    sourceIds: ['seamark'],
    minzoom: 1,
    maxzoom: 2,
    createdAt: 1,
    lastDownloadedAt: null,
    bytes: 0,
    status: 'ready',
    cachedBytes: 0,
    unavailableSourceIds: [],
  }));
  const component = mount(SavedRegionsView, {
    target,
    props: {
      regions,
      loadError: null,
      regionStatus: {},
      regionPollError: {},
      pendingRegion: {},
      submitting: false,
      adminAccess: true,
      armedDelete,
      chartLabel: (id) => id,
      onShow: vi.fn(),
      onUseTemplate: vi.fn(),
      onRedownload: vi.fn(),
      onRetryStatus: vi.fn(),
    },
  });
  flushSync();
  cleanups.push(() => {
    void unmount(component);
    target.remove();
  });
  const row = target.querySelectorAll('li')[1];
  if (!row) throw new Error('Missing second saved area');
  const deleteButton = () => {
    const control = row.querySelector<HTMLButtonElement>('button[aria-label="Delete this area"]');
    if (!control) throw new Error('Missing area delete action');
    return control;
  };
  return { target, row, deleteButton, onDelete };
}

describe('SavedRegionsView cancellation focus', () => {
  it('returns focus to the same saved area after canceling deletion', async () => {
    const { row, deleteButton, onDelete } = mountAreas();
    deleteButton().focus();
    deleteButton().click();
    flushSync();
    const cancel = [...row.querySelectorAll('button')].find(
      (control) => control.textContent?.trim() === 'Cancel',
    );
    if (!cancel) throw new Error('Missing delete cancellation');
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    flushSync();
    await tick();
    expect(document.activeElement).toBe(deleteButton());
    expect(onDelete).not.toHaveBeenCalled();
  });
});
