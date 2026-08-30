<script lang="ts">
import { formatPercent } from '$shared/lib';
import type { DisplaySettingsController } from './display-settings.svelte';
import { MAX_DISPLAY_DIM, TEXT_SCALES } from './display-settings.svelte';

interface Props {
  controller: DisplaySettingsController;
}

const { controller }: Props = $props();

const dimPercent = $derived(`${formatPercent(controller.dim)}%`);
</script>

<section class="panel-section" aria-label="Screen dim">
  <h3 class="caps-label">Screen dim</h3>
  <div class="slider-field">
    <div class="slider-head">
      <label class="slider-name" for="display-dim">Dim level</label>
      <span class="num">{dimPercent}</span>
    </div>
    <input
      id="display-dim"
      class="range"
      type="range"
      min="0"
      max={MAX_DISPLAY_DIM}
      step="0.05"
      value={controller.dim}
      aria-valuetext={dimPercent}
      oninput={(e) => controller.setDim(Number(e.currentTarget.value))}
    >
  </div>
  <p class="muted-note muted-note--xs">
    Darkens the screen below the display's lowest backlight for a night watch. It never reaches full
    black, so alarms stay visible.
  </p>
</section>

<section class="panel-section" aria-label="Automatic theme">
  <h3 class="caps-label">Automatic theme</h3>
  <div class="segmented" role="group" aria-label="Automatic theme">
    <button
      type="button"
      class="btn"
      class:is-on={!controller.autoTheme}
      aria-pressed={!controller.autoTheme}
      onclick={() => controller.setAutoTheme(false)}
    >
      Off
    </button>
    <button
      type="button"
      class="btn"
      class:is-on={controller.autoTheme}
      aria-pressed={controller.autoTheme}
      onclick={() => controller.setAutoTheme(true)}
    >
      On
    </button>
  </div>
  <p class="muted-note muted-note--xs">
    Switches between the day and night themes from the boat's day and night signal, or from the
    sun's position when there is none. Picking a theme yourself pauses auto until the next day-night
    change.
  </p>
  {#if controller.autoThemeSuspended}
    <p class="muted-note" role="status">
      Paused for your theme choice. Auto resumes at the next day-night change.
    </p>
  {/if}
</section>

<section class="panel-section" aria-label="Bright sun chart">
  <h3 class="caps-label">Bright sun chart</h3>
  <div class="segmented" role="group" aria-label="Bright sun chart">
    <button
      type="button"
      class="btn"
      class:is-on={!controller.sunMode}
      aria-pressed={!controller.sunMode}
      onclick={() => controller.setSunMode(false)}
    >
      Off
    </button>
    <button
      type="button"
      class="btn"
      class:is-on={controller.sunMode}
      aria-pressed={controller.sunMode}
      onclick={() => controller.setSunMode(true)}
    >
      On
    </button>
  </div>
  <p class="muted-note muted-note--xs">
    Pushes the day chart to maximum contrast for direct sunlight. It applies only while the day
    theme is active; dusk and night are unchanged.
  </p>
</section>

<section class="panel-section" aria-label="Text size">
  <h3 class="caps-label">Text size</h3>
  <div class="segmented" role="group" aria-label="Text size">
    {#each TEXT_SCALES as scale (scale)}
      <button
        type="button"
        class="btn"
        class:is-on={controller.textScale === scale}
        aria-pressed={controller.textScale === scale}
        onclick={() => controller.setTextScale(scale)}
      >
        {scale}%
      </button>
    {/each}
  </div>
  <p class="muted-note muted-note--xs">
    Scales the whole interface, touch targets included, so nothing shrinks below the gloved-hand
    size.
  </p>
</section>

<style>
/* The mixed-controls field layout: label row with the live value, full-width slider beneath. */
.slider-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.slider-name {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
