<script lang="ts">
import ChevronsRight from '@lucide/svelte/icons/chevrons-right';
import { clamp } from '$shared/lib';
import { focusOnMount } from '$shared/ui';
import { HOLD_TO_UNLOCK_MS, UNLOCK_DRAG_PX, unlockThreshold } from './slide-to-unlock';

interface Props {
  onUnlock: () => void;
}

const { onUnlock }: Props = $props();

let trackWidth = $state(0);
let thumbWidth = $state(0);
let offset = $state(0);
let dragging = $state(false);
let holding = $state(false);
let thumbEl: HTMLButtonElement | undefined;
let activePointer: number | undefined;
let dragOriginX = 0;
let holdTimer: ReturnType<typeof setTimeout> | undefined;

const maxTravel = $derived(Math.max(0, trackWidth - thumbWidth));
// The visual clamp mirrors the threshold's zero-travel fallback, so an unmeasured track still
// lets the drag accumulate distance instead of pinning the thumb at zero.
const travelCap = $derived(maxTravel > 0 ? maxTravel : UNLOCK_DRAG_PX);

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary || dragging) return;
  dragging = true;
  activePointer = event.pointerId;
  dragOriginX = event.clientX - offset;
  try {
    thumbEl?.setPointerCapture(event.pointerId);
  } catch (_) {
    // Synthetic test pointers have no active pointer to capture; the drag still tracks through
    // the move events delivered to the thumb itself.
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== activePointer) return;
  offset = clamp(event.clientX - dragOriginX, 0, travelCap);
}

function onPointerEnd(event: PointerEvent): void {
  if (!dragging || event.pointerId !== activePointer) return;
  dragging = false;
  activePointer = undefined;
  // A canceled pointer (the browser claimed the gesture) always springs back; only a completed
  // release past the deliberate-travel threshold unlocks.
  if (event.type === 'pointerup' && offset >= unlockThreshold(maxTravel)) {
    offset = travelCap;
    onUnlock();
    return;
  }
  offset = 0;
}

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

function onKeyDown(event: KeyboardEvent): void {
  if (!isActivationKey(event)) return;
  // Swallow the native button activation: a single press must never unlock, only the timed hold.
  event.preventDefault();
  if (event.repeat || holdTimer !== undefined) return;
  holding = true;
  holdTimer = setTimeout(() => {
    holdTimer = undefined;
    holding = false;
    onUnlock();
  }, HOLD_TO_UNLOCK_MS);
}

function cancelHold(): void {
  if (holdTimer !== undefined) clearTimeout(holdTimer);
  holdTimer = undefined;
  holding = false;
}

function onKeyUp(event: KeyboardEvent): void {
  if (!isActivationKey(event)) return;
  cancelHold();
}

$effect(() => cancelHold);
</script>

<div class="slide-track" bind:clientWidth={trackWidth}>
  <div
    class="hold-fill"
    class:holding
    style:transition={holding ? `transform ${HOLD_TO_UNLOCK_MS}ms linear` : 'none'}
    aria-hidden="true"
  ></div>
  <span class="slide-label" aria-hidden="true">Slide to unlock</span>
  <button
    type="button"
    class="slide-thumb"
    class:dragging
    style:transform={`translateX(${offset}px)`}
    aria-label="Unlock the screen. Drag to the far end, or hold Enter or Space for one and a half seconds."
    bind:this={thumbEl}
    bind:clientWidth={thumbWidth}
    use:focusOnMount
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
    onkeydown={onKeyDown}
    onkeyup={onKeyUp}
    onblur={cancelHold}
  >
    <ChevronsRight size={18} aria-hidden="true" />
  </button>
</div>

<style>
.slide-track {
  position: relative;
  inline-size: 100%;
  block-size: var(--control-size);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  overflow: hidden;
}
/* The keyboard hold's progress: sweeps the track over the hold window. The global reduced-motion
   clamp collapses the sweep to an instant fill, which still honestly signals "hold registered";
   release before the timer still cancels. */
.hold-fill {
  position: absolute;
  inset: 0;
  background: var(--accent-tint);
  transform: scaleX(0);
  transform-origin: 0 50%;
}
.hold-fill.holding {
  transform: scaleX(1);
}
.slide-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
  position: relative;
}
.slide-thumb {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: var(--control-size);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--accent);
  border-radius: var(--radius-pill);
  /* The quiet lit treatment, not a solid accent fill: at night the thumb stays a dim red tint so
     the lock never competes with alarm brightness. */
  background: var(--accent-tint-strong);
  color: var(--accent-tint-text);
  cursor: grab;
  touch-action: none;
  transition: transform var(--transition-fast);
}
.slide-thumb.dragging {
  transition: none;
  cursor: grabbing;
}
</style>
