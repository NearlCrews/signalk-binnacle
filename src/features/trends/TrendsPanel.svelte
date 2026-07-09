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
  recorder: TrendSessionRecorder;
  mode: UnitsMode;
  theme: Theme;
  onClose: () => void;
  onBack?: () => void;
}

const { origin, token, providers, recorder, mode, theme, onClose, onBack }: Props = $props();

const hasProvider = $derived((providers?.ids.length ?? 0) > 0);

let history = $state<TrendHistory | undefined>(undefined);
let loading = $state(false);
let loadFailed = $state(false);

// The sequence counter keeps a stale in-flight load from clobbering a newer result when
// providers (or the token) change mid-fetch; only the latest load may write state.
let loadSeq = 0;
$effect(() => {
  if (!providers?.ids.length) return;
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
  if (loading) return 'Loading the last 24 hours...';
  if (hasProvider && loadFailed) return 'History query failed; showing this session only.';
  return 'This session only. A history provider on the server (for example signalk-questdb or signalk-to-influxdb2) unlocks the full 24 hour view.';
});
</script>

<SlideOver title="Data trends" closeLabel="Close trends panel" {onClose} {onBack} bodyFlex>
  <p class="muted-note">
    Recent trends in the boat's wind, depth, and other data over the last day.
  </p>
  <p class="muted-note" role="status">{sourceNote}</p>
  {#await import('./TrendCharts.svelte') then charts}
    <charts.default history={history?.series} {sessionSeries} {mode} {theme} />
  {/await}
</SlideOver>
