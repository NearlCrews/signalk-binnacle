import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeController } from '$shared/ui';
import ThemeToggle, { HoldActivation } from './ThemeToggle.svelte';

function renderToggle(theme: string): string {
  return render(ThemeToggle, {
    props: { controller: new ThemeController(theme, () => {}) },
  }).body;
}

describe('ThemeToggle labels', () => {
  it('promises the night jump only while there is somewhere to jump to', () => {
    const day = renderToggle('day');

    expect(day).toContain('aria-label="Switch theme (currently Day theme); hold to jump to night');
    expect(day).toContain('title="Day theme (hold for night)"');
  });

  it('drops the hold promise once night-red is already showing', () => {
    const night = renderToggle('night-red');

    expect(night).toContain('aria-label="Switch theme (currently Night theme)"');
    expect(night).toContain('title="Night theme"');
    expect(night).not.toContain('hold');
  });
});

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
