<script lang="ts">
import { createMediaQuery, createRetryableLazyUiLoader, type UnitsMode } from '$shared/lib';
import type { Theme } from '$shared/ui';
import { CustomizeToggle, ErrorBoundary, SlideOver } from '$shared/ui';
import TrendsCustomize from './TrendsCustomize.svelte';
import type { TrendsController } from './trends-controller.svelte';

interface Props {
  controller: TrendsController;
  onRetryProvider: () => void;
  mode: UnitsMode;
  theme: Theme;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, onRetryProvider, mode, theme, onClose, onBack }: Props = $props();
let customizing = $state(false);
const loadTrendCharts = createRetryableLazyUiLoader(() => import('./TrendCharts.svelte'));
let chartsAttempt = $state(0);
// The panel fills a phone screen, so it traps focus there and does not on a wider window.
const phone = createMediaQuery('(max-width: 600px)');

function trendChartsForAttempt() {
  void chartsAttempt;
  return loadTrendCharts();
}

const sourceNote = $derived.by(() => {
  const retained = (controller.history?.series.size ?? 0) > 0;
  if (controller.loading) {
    return retained
      ? 'Refreshing the last 24 hours. Accepted history remains visible.'
      : 'Loading the last 24 hours. Session samples remain available.';
  }
  if (controller.providerState === 'checking') {
    return retained
      ? 'Checking for a history provider. Accepted history remains visible.'
      : 'Checking for a history provider. Showing this session meanwhile.';
  }
  if (controller.providerState === 'retrying') {
    return retained
      ? 'Checking again for a history provider. Accepted history remains visible.'
      : 'Checking again for a history provider. Showing this session meanwhile.';
  }
  if (controller.providerState === 'failed') {
    return retained
      ? 'Could not check for a history provider. Accepted history remains visible.'
      : 'Could not check for a history provider. This session remains available.';
  }
  if (controller.providerState === 'absent') {
    return 'This session only. A Signal K history provider unlocks the full 24 hour view.';
  }
  if (controller.historyState === 'partial') {
    return retained
      ? 'Some history providers or columns could not be read. Accepted charts remain available.'
      : 'Some history providers or columns could not be read. Showing session samples where available.';
  }
  if (controller.historyState === 'failed') {
    return retained
      ? 'History refresh failed. Accepted history remains visible.'
      : 'History query failed. Showing session samples where available.';
  }
  if (controller.historyState === 'empty') {
    return 'No history samples were found in the last 24 hours. Showing this session where available.';
  }
  return retained ? 'Last 24 hours, with session fallback per chart.' : 'Session samples.';
});

const focused = $derived(controller.focusedId !== undefined);
</script>

<SlideOver
  title="Data trends"
  subtitle={focused ? controller.charts[0]?.label : undefined}
  closeLabel="Close trends, return to chart"
  {onClose}
  {onBack}
  backLabel={focused ? 'Back to instrument details' : 'Back to menu'}
  bodyFlex
  focusTrap={phone.matches}
>
  {#snippet headerExtra()}
    {#if !focused}
      <CustomizeToggle
        object="trends"
        editing={customizing}
        compact
        onToggle={() => (customizing = !customizing)}
      />
    {/if}
  {/snippet}

  {#if customizing && !focused}
    <p class="muted-note customize-copy">
      Choose up to eight trends. Drag or use the arrow keys on a move handle to reorder.
    </p>
    <TrendsCustomize {controller} />
  {:else}
    <p class="muted-note">
      Recent Signal K instrument data, with values converted only for display.
    </p>
    <p class="muted-note" role="status">{sourceNote}</p>
    {#if controller.providerState === 'failed' || controller.providerState === 'absent'}
      <button type="button" class="btn" onclick={onRetryProvider}>
        {controller.providerState === 'failed'
          ? 'Retry provider check'
          : 'Check for provider again'}
      </button>
    {/if}
    {#if controller.historyState === 'failed' && controller.hasProvider}
      <button
        type="button"
        class="btn"
        disabled={controller.loading}
        onclick={() => controller.refreshHistory()}
      >
        Retry history
      </button>
    {/if}

    {#if !focused && controller.selected.length === 0}
      <div class="empty-state">
        <p>No trends are selected for this profile.</p>
        <button type="button" class="btn btn-primary" onclick={() => (customizing = true)}>
          Customize trends
        </button>
      </div>
    {:else}
      {#await trendChartsForAttempt()}
        <p class="muted-note" role="status">Loading trend charts…</p>
      {:then charts}
        <ErrorBoundary>
          <charts.default {controller} {mode} {theme} />

          {#snippet fallback(_error, reset)}
            <div class="chart-error" role="alert">
              <p class="muted-note">Trend charts stopped unexpectedly.</p>
              <button type="button" class="btn" onclick={reset}>Retry charts</button>
            </div>
          {/snippet}
        </ErrorBoundary>
      {:catch}
        <div class="chart-error" role="alert">
          <p class="muted-note">Could not open the trend charts.</p>
          <button type="button" class="btn" onclick={() => (chartsAttempt += 1)}>
            Retry charts
          </button>
        </div>
      {/await}
    {/if}
  {/if}
</SlideOver>

<style>
.chart-error,
.empty-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.empty-state {
  padding-block: var(--space-3);
}
.empty-state p {
  margin: 0;
}
.customize-copy {
  padding-inline: var(--space-3);
}
</style>
