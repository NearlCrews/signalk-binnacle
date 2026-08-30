import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDismiss } from '$shared/ui';
import { HOLD_TO_UNLOCK_MS, unlockThreshold } from './slide-to-unlock';
import TouchLockOverlay from './TouchLockOverlay.svelte';
import { createTouchLock, type TouchLockController } from './touch-lock.svelte';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
  vi.useRealTimers();
});

function addFixed(className: string, box: Box): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.style.position = 'fixed';
  el.style.top = `${box.top}px`;
  el.style.left = `${box.left}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  document.body.append(el);
  cleanups.push(() => el.remove());
  return el;
}

function mountLocked(): { lock: TouchLockController; onUnlocked: ReturnType<typeof vi.fn> } {
  const onUnlocked = vi.fn();
  const lock = createTouchLock(onUnlocked);
  lock.lock();
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(TouchLockOverlay, { target: document.body, props: { lock } });
  });
  cleanups.push(() => void unmount(component));
  return { lock, onUnlocked };
}

function thumb(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('.slide-thumb');
  if (!el) throw new Error('missing slide thumb');
  return el;
}

function pointer(type: string, target: Element, clientX: number): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId: 7,
    clientX,
  });
  target.dispatchEvent(event);
  return event;
}

function key(type: string, target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function atPoint(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y);
}

describe('TouchLockOverlay pass-through geometry', () => {
  it('shields the viewport but leaves the MOB key and the emergency rail genuinely hittable', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mob = addFixed('mob-btn', { top: 8, left: w - 108, width: 100, height: 44 });
    const rail = addFixed('safety-rail', { top: h - 80, left: 50, width: w - 100, height: 60 });
    const buried = addFixed('buried-btn', { top: 60, left: 10, width: 100, height: 44 });
    mountLocked();

    expect(atPoint(w - 58, 30)).toBe(mob);
    expect(atPoint(w / 2, h - 50)).toBe(rail);
    expect(atPoint(60, 82)?.classList.contains('shield-panel'), 'covers a non-safety control').toBe(
      true,
    );
    expect(atPoint(60, 82)).not.toBe(buried);
    expect(atPoint(4, h / 2)?.classList.contains('shield-panel')).toBe(true);
    const card = document.querySelector('.lock-card');
    const cardRect = card?.getBoundingClientRect();
    if (!card || !cardRect) throw new Error('missing lock card');
    expect(
      atPoint(cardRect.left + cardRect.width / 2, cardRect.top + 4)?.closest('.lock-card'),
    ).toBe(card);
  });

  it('re-measures when the emergency rail grows, so a new alarm strip stays tappable', async () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rail = addFixed('safety-rail', { top: h - 80, left: 50, width: w - 100, height: 60 });
    mountLocked();
    expect(atPoint(w / 2, h - 170)?.classList.contains('shield-panel')).toBe(true);

    rail.style.top = `${h - 200}px`;
    rail.style.height = '180px';
    await expect.poll(() => atPoint(w / 2, h - 170)).toBe(rail);
  });
});

describe('TouchLockOverlay slide to unlock', () => {
  it('focuses the handle, springs back on an early release, and unlocks past the threshold', () => {
    const { lock, onUnlocked } = mountLocked();
    const handle = thumb();
    expect(document.activeElement).toBe(handle);
    const track = document.querySelector<HTMLElement>('.slide-track');
    if (!track) throw new Error('missing slide track');
    const threshold = unlockThreshold(Math.max(0, track.clientWidth - handle.clientWidth));
    expect(threshold).toBeGreaterThan(50);

    pointer('pointerdown', handle, 100);
    pointer('pointermove', handle, 100 + threshold - 20);
    pointer('pointerup', handle, 100 + threshold - 20);
    flushSync();
    expect(lock.locked).toBe(true);
    expect(handle.style.transform).toBe('translateX(0px)');

    pointer('pointerdown', handle, 100);
    pointer('pointermove', handle, 100 + threshold + 20);
    pointer('pointerup', handle, 100 + threshold + 20);
    flushSync();
    expect(lock.locked).toBe(false);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('springs back when the browser cancels the pointer mid-drag', () => {
    const { lock } = mountLocked();
    const handle = thumb();
    pointer('pointerdown', handle, 100);
    pointer('pointermove', handle, 500);
    pointer('pointercancel', handle, 500);
    flushSync();
    expect(lock.locked).toBe(true);
    expect(handle.style.transform).toBe('translateX(0px)');
  });

  it('unlocks on a full hold of Enter, and not on a shorter one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { lock } = mountLocked();
    const handle = thumb();

    key('keydown', handle, { key: 'Enter' });
    vi.advanceTimersByTime(HOLD_TO_UNLOCK_MS - 500);
    key('keyup', handle, { key: 'Enter' });
    vi.advanceTimersByTime(HOLD_TO_UNLOCK_MS * 2);
    flushSync();
    expect(lock.locked).toBe(true);

    key('keydown', handle, { key: ' ' });
    vi.advanceTimersByTime(HOLD_TO_UNLOCK_MS - 1);
    flushSync();
    expect(lock.locked).toBe(true);
    vi.advanceTimersByTime(1);
    flushSync();
    expect(lock.locked).toBe(false);
  });
});

describe('TouchLockOverlay interaction gating', () => {
  it('swallows activation keys outside the safety surfaces, and only there', () => {
    const w = window.innerWidth;
    const mob = addFixed('mob-btn', { top: 8, left: w - 108, width: 100, height: 44 });
    const outside = addFixed('outside-btn', { top: 60, left: 10, width: 100, height: 44 });
    mountLocked();

    expect(key('keydown', outside, { key: 'Enter' }).defaultPrevented).toBe(true);
    expect(key('keydown', outside, { key: 'a' }).defaultPrevented).toBe(true);
    expect(key('keydown', outside, { key: 'Tab' }).defaultPrevented).toBe(false);
    expect(key('keydown', outside, { key: 'r', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key('keydown', mob, { key: 'Enter' }).defaultPrevented).toBe(false);
    expect(key('keydown', thumb(), { key: 'ArrowRight' }).defaultPrevented).toBe(false);
  });

  it('consumes Escape without unlocking or closing a panel open beneath the lock', () => {
    const panelClose = vi.fn();
    const unregisterPanel = registerDismiss(panelClose);
    cleanups.push(unregisterPanel);
    const { lock } = mountLocked();

    const escapeEvent = key('keydown', document.body, { key: 'Escape' });
    flushSync();
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(panelClose).not.toHaveBeenCalled();
    expect(lock.locked).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'Drag the unlock handle',
    );
  });

  it('announces the lock politely and the unlock after it completes', () => {
    const { lock } = mountLocked();
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Screen locked. Alarm controls stay active.');
    lock.unlock();
    flushSync();
    expect(status?.textContent).toBe('Screen unlocked.');
    expect(document.querySelector('.shield')).toBeNull();
  });
});
