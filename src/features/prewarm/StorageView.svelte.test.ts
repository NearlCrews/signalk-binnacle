import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { tag } from '$shared/testing';
import StorageView from './StorageView.svelte';

const noop = (): void => {};

function body(adminAccess: boolean, overrides: Record<string, unknown> = {}): string {
  return render(StorageView, {
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
      adminAccess,
      confirmingClear: false,
      clearNote: null,
      chartLabel: (id: string) => id,
      onCommitTtl: noop,
      onRetryTtl: noop,
      onRequestClear: noop,
      onConfirmClear: noop,
      onCancelClear: noop,
      ...overrides,
    },
  }).body;
}

const autoClearInput = (html: string): string =>
  tag(html, /<input[^>]*aria-label="Auto-clear after in days"[^>]*>/, 'auto-clear input');

describe('StorageView auto-clear field', () => {
  it('shows a failed read with a retry instead of an indefinite loading label', () => {
    const html = body(true, { loadError: 'Could not load the cache stats.', onRetryLoad: noop });
    expect(html).toContain('Could not load the cache stats.');
    expect(html).toContain('Retry storage');
    expect(html).not.toContain('Loading storage');
  });
  // The controller drops a TTL commit without administrator access, so the field must look
  // blocked like the Clear button beside it rather than silently reverting the entry.
  it('disables the field without administrator access', () => {
    expect(autoClearInput(body(false))).toContain('disabled');
  });

  it('keeps the field editable with administrator access', () => {
    expect(autoClearInput(body(true))).not.toContain('disabled');
  });
});
