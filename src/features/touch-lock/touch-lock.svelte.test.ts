import { describe, expect, it, vi } from 'vitest';
import { createTouchLock } from './touch-lock.svelte';

describe('createTouchLock', () => {
  it('starts unlocked, session-only, with no stored state to come back locked from', () => {
    expect(createTouchLock().locked).toBe(false);
  });

  it('locks, unlocks, and reports completion once per unlock', () => {
    const onUnlocked = vi.fn();
    const lock = createTouchLock(onUnlocked);
    lock.lock();
    expect(lock.locked).toBe(true);
    lock.lock();
    expect(lock.locked).toBe(true);
    lock.unlock();
    expect(lock.locked).toBe(false);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('does not fire the completion callback for an unlock while already unlocked', () => {
    const onUnlocked = vi.fn();
    const lock = createTouchLock(onUnlocked);
    lock.unlock();
    expect(onUnlocked).not.toHaveBeenCalled();
  });
});
