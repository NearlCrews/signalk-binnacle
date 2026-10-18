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
  <div class="sunset-host">
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
  </div>
{/if}

<style>
/* Bottom center inside the chrome gutter. The host spans the gutter so it can be the offer's banner
   container; the offer itself is sized to its content and never wider than the host, so on a phone
   the prompt wraps above its actions instead of squeezing them. */
.sunset-host {
  container: banner / inline-size;
  position: fixed;
  /* Above the status bar, never over it: the bar holds MOB. */
  inset-block-end: calc(var(--bar-block-size, 0px) + var(--space-3));
  inset-inline: var(--chrome-inset-start) var(--chrome-inset-end);
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: var(--z-menu);
}
.sunset-offer {
  max-inline-size: 100%;
  justify-content: center;
  padding: var(--space-2) var(--space-3);
  box-shadow: var(--shadow-overlay);
  pointer-events: auto;
}
</style>
