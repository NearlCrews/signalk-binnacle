import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldActivation } from './ThemeToggle.svelte';

describe('HoldActivation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cycles once for a short pointer activation', () => {
    const onShort = vi.fn();
    const onLong = vi.fn();
    const hold = new HoldActivation(onShort, onLong);

    hold.start('pointer');
    hold.releasePointer();
    hold.click();

    expect(onShort).toHaveBeenCalledOnce();
    expect(onLong).not.toHaveBeenCalled();
  });

  it('jumps to night once and swallows the click after a pointer hold', () => {
    const onShort = vi.fn();
    const onLong = vi.fn();
    const hold = new HoldActivation(onShort, onLong);

    hold.start('pointer');
    vi.advanceTimersByTime(500);
    hold.releasePointer();
    hold.click();

    expect(onLong).toHaveBeenCalledOnce();
    expect(onShort).not.toHaveBeenCalled();
  });

  it('provides the same short and held behavior for keyboard activation without a second click', () => {
    const onShort = vi.fn();
    const onLong = vi.fn();
    const hold = new HoldActivation(onShort, onLong);

    hold.start('keyboard');
    hold.releaseKeyboard();
    hold.click();
    expect(onShort).toHaveBeenCalledOnce();

    vi.runAllTimers();
    hold.start('keyboard');
    vi.advanceTimersByTime(500);
    hold.releaseKeyboard();
    hold.click();

    expect(onLong).toHaveBeenCalledOnce();
    expect(onShort).toHaveBeenCalledOnce();
  });

  it('cancels a pending hold without activating either action', () => {
    const onShort = vi.fn();
    const onLong = vi.fn();
    const hold = new HoldActivation(onShort, onLong);

    hold.start('keyboard');
    hold.cancel();
    hold.click();
    vi.runAllTimers();

    expect(onShort).not.toHaveBeenCalled();
    expect(onLong).not.toHaveBeenCalled();
  });
});
