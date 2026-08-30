import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TouchLockOverlay from './TouchLockOverlay.svelte';
import { createTouchLock } from './touch-lock.svelte';

function renderOverlay(locked: boolean): string {
  const lock = createTouchLock();
  if (locked) lock.lock();
  return render(TouchLockOverlay, { props: { lock } }).body;
}

describe('TouchLockOverlay markup', () => {
  it('renders the shield, the lock card, and the honest safety copy while locked', () => {
    const body = renderOverlay(true);
    expect(body).toContain('class="shield-panel');
    expect(body).toContain('Screen locked');
    expect(body).toContain('Alarm controls stay active while locked.');
    expect(body).toContain('Hold Enter on the handle to unlock with the');
    expect(body).toContain('Slide to unlock');
    expect(body).toContain(
      'aria-label="Unlock the screen. Drag to the far end, or hold Enter or Space for one and a half seconds."',
    );
    expect(body).toContain('aria-labelledby="touch-lock-title"');
  });

  it('keeps only the polite live region while unlocked', () => {
    const body = renderOverlay(false);
    expect(body).not.toContain('class="shield');
    expect(body).not.toContain('Screen locked');
    expect(body).toContain('role="status"');
    expect(body).toContain('aria-live="polite"');
  });
});
