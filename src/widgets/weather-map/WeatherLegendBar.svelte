<script lang="ts">
import { WEATHER_LAYER_IDS, type WeatherLegend } from '$features/weather';

interface Props {
  legends: WeatherLegend[];
  // The radar note is live (which frame the loop paints, or why it is hidden), substituted for the
  // radar legend's static note so its frequent beat touches one text node, not every legend.
  radarNote: string;
}

const { legends, radarNote }: Props = $props();
</script>

<div class="legend" role="group" aria-label="Weather legend">
  {#each legends as legend (legend.id)}
    <div class="legend-row">
      <span class="legend-title caps-label">{legend.title}</span>
      {#if legend.gradient}
        <span class="legend-scale">
          <span class="legend-end">{legend.lowLabel}</span>
          <span class="legend-bar" style="background:{legend.gradient}"></span>
          <span class="legend-end">{legend.highLabel}</span>
        </span>
      {:else if legend.swatches}
        <span class="legend-swatches">
          {#each legend.swatches as swatch (swatch.label)}
            <span class="legend-swatch">
              <span class="legend-chip" style="background:{swatch.color}"></span>
              {swatch.label}
            </span>
          {/each}
        </span>
      {/if}
      {#if legend.note}
        <!-- The radar note is live (which frame the loop paints, or why it is hidden),
             substituted here so its 600 ms beat touches one text node, not the legends. -->
        <span class="legend-note">
          {legend.id === WEATHER_LAYER_IDS.radar ? radarNote : legend.note}
        </span>
      {/if}
      {#if legend.coverageNote}
        <!-- The coverage bound stays beside the live note: offshore silence is not no rain. -->
        <span class="legend-note">{legend.coverageNote}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
.legend {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.legend-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.legend-title {
  flex: 0 0 6.5rem;
}
.legend-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.legend-swatch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
/* The chip and bar are element sizes, not spacing, so they stay literals off the --space scale. */
.legend-chip {
  inline-size: 0.85rem;
  block-size: 0.85rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.legend-scale {
  flex: 1;
  min-inline-size: 8rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.legend-end {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.legend-bar {
  flex: 1;
  block-size: 0.55rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
}
.legend-note {
  flex-basis: 100%;
  font-size: var(--text-xs);
  font-style: italic;
  color: var(--text-muted);
}
</style>
