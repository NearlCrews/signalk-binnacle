<script lang="ts">
import Lock from '@lucide/svelte/icons/lock';
import { registerDismiss } from '$shared/ui';
import { DEFAULT_PASS_THROUGH_SELECTORS } from './pass-through';
import SlideToUnlock from './SlideToUnlock.svelte';
import { lockCardBand, type ShieldRect, shieldPanels } from './shield';
import type { TouchLockController } from './touch-lock.svelte';

interface Props {
  lock: TouchLockController;
  // Override only when the safety chrome moves to different hooks; see pass-through.ts.
  passThroughSelectors?: readonly string[];
}

const { lock, passThroughSelectors = DEFAULT_PASS_THROUGH_SELECTORS }: Props = $props();

const STILL_LOCKED_NOTE = 'Screen locked. Drag the unlock handle, or hold Enter on it, to unlock.';

let holes = $state<ShieldRect[]>([]);
let viewport = $state({ width: 0, height: 0 });
let announcement = $state('');
let shieldEl = $state<HTMLDivElement | undefined>();

const panels = $derived(shieldPanels(viewport, holes));
const cardBand = $derived(lockCardBand(viewport.height, holes));
const cardCenterY = $derived((cardBand.top + cardBand.bottom) / 2);

// Lock and unlock are announced on the transition, wherever they were initiated, so a
// programmatic unlock is voiced the same as a completed slide.
let wasLocked = false;
$effect(() => {
  if (lock.locked && !wasLocked) announcement = 'Screen locked. Alarm controls stay active.';
  else if (!lock.locked && wasLocked) announcement = 'Screen unlocked.';
  wasLocked = lock.locked;
});

// Geometry: measure the pass-through surfaces into holes while locked. The emergency rail grows
// and shrinks as alerts mount, so its box is observed rather than snapshotted; each measure
// re-queries the selectors so every current match contributes a hole.
$effect(() => {
  if (!lock.locked) return;
  const measure = (): void => {
    viewport = { width: window.innerWidth, height: window.innerHeight };
    const next: ShieldRect[] = [];
    for (const selector of passThroughSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          next.push({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
        }
      }
    }
    holes = next;
  };
  measure();
  // The observed set is fixed at engage time (re-observing inside the callback would loop): the
  // surfaces themselves for size changes, and the body for layout shifts around them.
  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(document.body);
    for (const selector of passThroughSelectors) {
      for (const element of document.querySelectorAll(selector)) observer.observe(element);
    }
  }
  window.addEventListener('resize', measure);
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', measure);
  };
});

// Interaction gating: pointers are stopped by the shield panels being real hit targets, and keys
// are swallowed here at window capture so a focused background control cannot be activated. Tab
// stays free (the MOB key and the alarm acknowledges must remain keyboard-reachable), modifier
// chords stay free (browser and assistive shortcuts are not wet-screen chaos), and keys inside
// the overlay, a pass-through surface, or an open dialog (the MOB confirm lives in the top
// layer) pass untouched.
$effect(() => {
  if (!lock.locked) return;
  const allowed = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (shieldEl?.contains(target)) return true;
    if (target.closest('dialog[open]') !== null) return true;
    return passThroughSelectors.some((selector) => target.closest(selector) !== null);
  };
  const swallow = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (allowed(event.target)) return;
    if (event.key === 'Escape') announcement = STILL_LOCKED_NOTE;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', swallow, true);
  // A dismiss-stack entry keeps an Escape that a longer-lived stack listener handles first from
  // reaching a panel open beneath the lock; the lock itself never dismisses on Escape.
  const unregister = registerDismiss(() => {
    announcement = STILL_LOCKED_NOTE;
  });
  return () => {
    window.removeEventListener('keydown', swallow, true);
    window.removeEventListener('keyup', swallow, true);
    unregister();
  };
});
</script>

{#if lock.locked}
  <div class="shield" bind:this={shieldEl}>
    {#each panels as panel (`${panel.top}:${panel.left}:${panel.width}:${panel.height}`)}
      <div
        class="shield-panel"
        aria-hidden="true"
        style:top={`${panel.top}px`}
        style:left={`${panel.left}px`}
        style:width={`${panel.width}px`}
        style:height={`${panel.height}px`}
      ></div>
    {/each}
    <div
      class="lock-card surface-elevated"
      role="group"
      aria-labelledby="touch-lock-title"
      style:top={`${cardCenterY}px`}
    >
      <p class="lock-title" id="touch-lock-title">
        <Lock size={20} aria-hidden="true" />
        Screen locked
      </p>
      <p class="muted-note lock-note">
        Alarm controls stay active while locked. Hold Enter on the handle to unlock with the
        keyboard.
      </p>
      <SlideToUnlock onUnlock={() => lock.unlock()} />
    </div>
  </div>
{/if}
<p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>

<style>
/* No pointer-events and no aria-modal on the container, deliberately: the holes are simply where
   no child panel sits, and the safety surfaces underneath stay in both the hit-test order and the
   accessibility tree. */
.shield {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-menu) + 1);
  pointer-events: none;
}
.shield-panel {
  position: fixed;
  pointer-events: auto;
  /* Barely darker, from the theme's own scrim, so the chart stays readable through the lock. */
  background: color-mix(in srgb, var(--scrim) 25%, transparent);
}
/* Night vision: the wash goes near transparent so the lock neither adds light nor hides the dim
   chart, and the black scrim base keeps every pixel in the zero-blue contract. */
:global(:root[data-theme="night-red"]) .shield-panel {
  background: color-mix(in srgb, var(--scrim) 10%, transparent);
}
.lock-card {
  position: fixed;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  inline-size: min(20rem, calc(100vw - var(--space-6)));
  padding: var(--space-4);
}
.lock-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
}
.lock-note {
  margin: 0;
  text-align: center;
}
</style>
