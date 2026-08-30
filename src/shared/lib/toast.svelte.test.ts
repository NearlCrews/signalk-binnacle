import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './toast.svelte';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('keeps a failure visible until it is explicitly dismissed', () => {
    vi.useFakeTimers();
    const toast = new Toast();

    toast.show('Save failed.');
    vi.advanceTimersByTime(60_000);

    expect(toast.message).toBe('Save failed.');
    toast.clear();
    expect(toast.message).toBeUndefined();
  });

  it('supports an explicit duration for transient guidance', () => {
    vi.useFakeTimers();
    const toast = new Toast();

    toast.show('Try another action.', 5_000);
    vi.advanceTimersByTime(4_999);
    expect(toast.message).toBe('Try another action.');
    vi.advanceTimersByTime(1);
    expect(toast.message).toBeUndefined();
  });

  it('cancels an earlier timer when a persistent failure replaces it', () => {
    vi.useFakeTimers();
    const toast = new Toast();

    toast.show('Transient.', 1_000);
    toast.show('Persistent.');
    vi.advanceTimersByTime(2_000);

    expect(toast.message).toBe('Persistent.');
  });
});
