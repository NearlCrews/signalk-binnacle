<script lang="ts">
import { Moon, Sun, Sunset } from '@lucide/svelte';
import type { Component } from 'svelte';
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
const LONG_PRESS_MS = 500;
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let longPressed = false;

function onPointerDown(): void {
  longPressed = false;
  longPressTimer = setTimeout(() => {
    longPressed = true;
    controller.set('night-red');
  }, LONG_PRESS_MS);
}

function cancelLongPress(): void {
  clearTimeout(longPressTimer);
}

function onClick(): void {
  // The long-press timer already applied the theme; swallow the trailing click so a held press
  // does not also cycle past night-red.
  if (longPressed) {
    longPressed = false;
    return;
  }
  controller.cycle();
}
</script>

<button
  type="button"
  class="icon-pill"
  aria-label={`Switch theme (currently ${label}); hold to jump to night theme`}
  title={`${label} (hold for night)`}
  onpointerdown={onPointerDown}
  onpointerup={cancelLongPress}
  onpointerleave={cancelLongPress}
  onpointercancel={cancelLongPress}
  onclick={onClick}
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
