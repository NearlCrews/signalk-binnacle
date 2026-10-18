<script lang="ts">
import type { DisplaySettingsController } from './display-settings.svelte';

interface Props {
  controller: DisplaySettingsController;
}

const { controller }: Props = $props();
</script>

{#if controller.sunsetOffer}
  <!-- The chart's offer form, like the NOAA ENC and welcome offers: an info note whose actions are
       one equal group that wraps whole under the prompt. role=status, not alert: a theme suggestion
       must never interrupt like a safety call. -->
  <div class="sunset-offer info-note action-note action-note--wrap" role="status">
    <p>Sunset. Switch to the night theme?</p>
    <div class="action-group">
      <button type="button" class="btn" onclick={() => controller.acceptSunsetOffer()}>
        Switch
      </button>
      <button type="button" class="btn btn-ghost" onclick={() => controller.dismissSunsetOffer()}>
        Not now
      </button>
    </div>
  </div>
{/if}

<style>
/* Bottom center inside the chrome gutter, sized to its content and never wider than the gutter
   allows, so on a phone the prompt wraps above its actions instead of squeezing them. */
.sunset-offer {
  position: fixed;
  inset-block-end: calc(var(--space-6) + var(--system-bar-clearance, 0px));
  inset-inline: var(--chrome-inset-start) var(--chrome-inset-end);
  inline-size: fit-content;
  max-inline-size: calc(100% - var(--chrome-inset-start) - var(--chrome-inset-end));
  margin-inline: auto;
  justify-content: center;
  padding: var(--space-2) var(--space-3);
  box-shadow: var(--shadow-overlay);
  z-index: var(--z-menu);
}
</style>
