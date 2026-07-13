<script lang="ts">
import type { UnitsMode } from '$shared/lib';
import type { HistoryProviders } from '$shared/signalk';
import type { Theme } from '$shared/ui';
import { SlideOver } from '$shared/ui';
import type { TrendSessionRecorder } from './session-recorder.svelte';
import type { TrendKey, TrendSeries } from './trend-metrics';
import { loadTrendHistory, type TrendHistory } from './trends-history';

interface Props {
  origin: string;
  token: string | undefined;
  // undefined while unknown or unavailable; empty ids means the API exists with no provider.
  providers: HistoryProviders | undefined;
  providerState: 'checking' | 'retrying' | 'available' | 'absent' | 'failed';
  onRetryProvider: () => void;
  recorder: TrendSessionRecorder;
  mode: UnitsMode;
  theme: Theme;
  onClose: () => void;
  onBack?: () => void;
}

const {
  origin,
  token,
  providers,
  providerState,
  onRetryProvider,
  recorder,
  mode,
  theme,
  onClose,
  onBack,
}: Props = $props();

const hasProvider = $derived((providers?.ids.length ?? 0) > 0);

let history = $state<TrendHistory | undefined>(undefined);
let loading = $state(false);
let loadFailed = $state(false);
let chartsPromise = $state(import('./TrendCharts.svelte'));

// The sequence counter keeps a stale in-flight load from clobbering a newer result when
// providers (or the token) change mid-fetch; only the latest load may write state.
let loadSeq = 0;
function refreshHistory(): void {
  if (!providers?.ids.length) {
    loadSeq += 1;
    history = undefined;
    loading = false;
    loadFailed = false;
    return;
  }
  const mine = ++loadSeq;
  loading = true;
  loadFailed = false;
  loadTrendHistory(origin, token, providers)
    .then((got) => {
      if (mine !== loadSeq) return;
      history = got;
      loading = false;
      loadFailed = got === undefined;
    })
    .catch(() => {
      if (mine !== loadSeq) return;
      history = undefined;
      loading = false;
      loadFailed = true;
    });
}

$effect(() => {
  void providers;
  void token;
  refreshHistory();
});

// The session recorder's version is the reactive pulse for the fallback series; reading it here
// makes the charts re-derive on each new sample without polling.
const sessionSeries = $derived.by(() => {
  // Only track the recorder pulse when there is no history series to show. With history present the
  // session fallback is never read, so tracking version would needlessly re-derive every chart on
  // each 30 s sample.
  if (!history?.series) void recorder.version;
  return (key: TrendKey): TrendSeries => recorder.series(key);
});

const sourceNote = $derived.by(() => {
  if (history?.series) {
    return history.provider ? `Last 24 hours, from ${history.provider}` : 'Last 24 hours';
  }
  if (loading) return 'Loading the last 24 hours…';
  if (hasProvider && loadFailed) return 'History query failed; showing this session only.';
  if (providerState === 'checking')
    return 'Checking for a history provider; showing this session meanwhile.';
  if (providerState === 'retrying')
    return 'Checking again for a history provider; showing this session meanwhile.';
  if (providerState === 'failed')
    return 'Could not check for a history provider. This session remains available.';
  return 'This session only. A history provider on the server (for example signalk-questdb or signalk-to-influxdb2) unlocks the full 24 hour view.';
});
</script>

<SlideOver title="Data trends" closeLabel="Close trends panel" {onClose} {onBack} bodyFlex>
  <p class="muted-note">
    Recent trends in the boat's wind, depth, and other data over the last day.
  </p>
  <p class="muted-note" role="status">{sourceNote}</p>
  {#if providerState === 'failed' || providerState === 'absent'}
    <button type="button" class="btn" onclick={onRetryProvider}>
      {providerState === 'failed' ? 'Retry provider check' : 'Check for provider again'}
    </button>
  {/if}
  {#if loadFailed && hasProvider}
    <button type="button" class="btn" disabled={loading} onclick={refreshHistory}>
      Retry history
    </button>
  {/if}
  {#await chartsPromise}
    <p class="muted-note" role="status">Loading trend charts…</p>
  {:then charts}
    <charts.default history={history?.series} {sessionSeries} {mode} {theme} />
  {:catch}
    <div class="chart-error" role="alert">
      <p class="muted-note">Could not open the trend charts.</p>
      <button
        type="button"
        class="btn"
        onclick={() => (chartsPromise = import('./TrendCharts.svelte'))}
      >
        Retry charts
      </button>
    </div>
  {/await}
</SlideOver>

<style>
.chart-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
</style>
