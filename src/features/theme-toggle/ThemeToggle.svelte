<script module lang="ts">
export type HoldSource = 'keyboard' | 'pointer';

export class HoldActivation {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #source: HoldSource | undefined;
  #longActivated = false;
  #suppressClick = false;
  #suppressionTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #onShort: () => void;
  readonly #onLong: () => void;
  readonly #delayMs: number;

  constructor(onShort: () => void, onLong: () => void, delayMs = 500) {
    this.#onShort = onShort;
    this.#onLong = onLong;
    this.#delayMs = delayMs;
  }

  start(source: HoldSource): void {
    if (this.#source === source) return;
    this.#clearTimer();
    this.#source = source;
    this.#longActivated = false;
    // Enter activates a native button on keydown in some browsers. Suppress that generated click;
    // keyup owns the short activation so Enter and Space share the same hold behavior.
    if (source === 'keyboard') this.#suppressNextClick();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#longActivated = true;
      this.#onLong();
    }, this.#delayMs);
  }

  releasePointer(): void {
    if (this.#source !== 'pointer') return;
    this.#clearTimer();
    this.#source = undefined;
  }

  releaseKeyboard(): void {
    if (this.#source !== 'keyboard') return;
    this.#clearTimer();
    this.#source = undefined;
    if (!this.#longActivated) this.#onShort();
    this.#longActivated = false;
    this.#suppressNextClick();
  }

  cancel(): void {
    const wasActive = this.#source !== undefined;
    this.#clearTimer();
    this.#source = undefined;
    this.#longActivated = false;
    if (wasActive) this.#suppressNextClick();
  }

  click(): void {
    if (this.#suppressClick) {
      this.#suppressClick = false;
      clearTimeout(this.#suppressionTimer);
      this.#suppressionTimer = undefined;
      return;
    }
    if (this.#longActivated) {
      this.#longActivated = false;
      return;
    }
    this.#onShort();
  }

  dispose(): void {
    this.#clearTimer();
    this.#source = undefined;
    this.#longActivated = false;
    clearTimeout(this.#suppressionTimer);
    this.#suppressionTimer = undefined;
    this.#suppressClick = false;
  }

  #clearTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #suppressNextClick(): void {
    this.#suppressClick = true;
    clearTimeout(this.#suppressionTimer);
    this.#suppressionTimer = setTimeout(() => {
      this.#suppressClick = false;
      this.#suppressionTimer = undefined;
    }, 0);
  }
}
</script>

<script lang="ts">
import { Moon, Sun, Sunset } from '@lucide/svelte';
import type { Component } from 'svelte';
import { onDestroy } from 'svelte';
import { scale } from 'svelte/transition';
import { prefersReducedMotion } from '$shared/lib';
import type { Theme, ThemeController } from '$shared/ui';

interface Props {
  controller: ThemeController;
}

const { controller }: Props = $props();

const ICONS: Record<Theme, Component> = {
  day: Sun,
  dusk: Sunset,
  'night-red': Moon,
};

const LABELS: Record<Theme, string> = {
  day: 'Day theme',
  dusk: 'Dusk theme',
  'night-red': 'Night theme',
};

const Icon = $derived(ICONS[controller.theme]);
const label = $derived(LABELS[controller.theme]);

// A long hold jumps straight to night-red, skipping the day -> dusk leg of the cycle: cycling
// through dusk's brighter palette first would hit dark-adapted eyes with exactly the flash a
// night-red jump exists to avoid.
const hold = new HoldActivation(
  () => controller.cycle(),
  () => controller.set('night-red'),
);
onDestroy(() => hold.dispose());

function onPointerDown(event: PointerEvent): void {
  if (event.button === 0) hold.start('pointer');
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  event.preventDefault();
  if (event.repeat) return;
  hold.start('keyboard');
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  event.preventDefault();
  hold.releaseKeyboard();
}
</script>

<button
  type="button"
  class="icon-pill"
  aria-label={`Switch theme (currently ${label}); hold to jump to night theme`}
  title={`${label} (hold for night)`}
  onpointerdown={onPointerDown}
  onpointerup={() => hold.releasePointer()}
  onpointerleave={() => hold.cancel()}
  onpointercancel={() => hold.cancel()}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  onblur={() => hold.cancel()}
  onclick={() => hold.click()}
>
  <!-- The mode change recolors the whole UI, so the marquee control acknowledges it: the new glyph
       pops in on each cycle. Keyed on the theme so the swap re-mounts, gated on reduced motion. -->
  {#key controller.theme}
    <span class="glyph" in:scale={{ start: 0.5, duration: prefersReducedMotion() ? 0 : 200 }}>
      <Icon size={20} aria-hidden="true" />
    </span>
  {/key}
</button>

<style>
.glyph {
  display: inline-flex;
}
</style>
