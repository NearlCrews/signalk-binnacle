<script lang="ts">
import { untrack } from 'svelte';
import {
  type UserChartSource,
  userChartUrlForDisplay,
  userChartUrlHasQuery,
} from '$entities/user-charts';
import ChartSpecList from './ChartSpecList.svelte';
import { chartSpecRows } from './chart-spec';

interface Props {
  source: UserChartSource;
  shareWithServer: boolean;
  writeBlocked?: boolean;
  disabled?: boolean;
  showSource?: boolean;
  showSpecs?: boolean;
  onShareChange: (share: boolean) => void;
}

const {
  source,
  shareWithServer,
  writeBlocked = false,
  disabled = false,
  showSource = false,
  showSpecs = true,
  onShareChange,
}: Props = $props();

const rows = $derived.by(() => {
  const spec = chartSpecRows(source);
  return [
    ...(showSource ? [{ label: 'Source', value: userChartUrlForDisplay(source.origin.url) }] : []),
    spec.type,
    spec.zoom,
    {
      label: 'Stored',
      value: shareWithServer ? 'This device, and shared to the server' : 'This device only',
    },
  ];
});
const hasQuery = $derived(userChartUrlHasQuery(source.origin.url));
// The query-value warning is styled as an alert, so it announces with matching urgency once sharing
// is turned on. It stays polite until the navigator changes the choice: this step can mount with
// sharing already on, where an assertive announcement would interrupt the review as it opens.
const initialShare = untrack(() => shareWithServer);
let shareChanged = $state(false);
$effect(() => {
  if (shareWithServer !== initialShare) shareChanged = true;
});
const queryNoteRole = $derived(shareWithServer && shareChanged ? 'alert' : 'status');
</script>

{#if showSpecs}
  <ChartSpecList {rows} />
{/if}
<label class="share-choice">
  <input
    type="checkbox"
    checked={shareWithServer}
    disabled={writeBlocked || disabled}
    onchange={(event) => onShareChange(event.currentTarget.checked)}
  >
  <span>Share the full chart URL with the Signal K server</span>
</label>
{#if writeBlocked}
  <p class="muted-note muted-note--xs privacy-note" role="status">
    {shareWithServer
      ? 'Read and write Signal K access is needed to change sharing for this server chart.'
      : 'This chart stays on this device. Read and write Signal K access is needed to share it with the server.'}
  </p>
{:else if hasQuery}
  <!-- Exclusive, not layered: .muted-note is defined after .alert-note in text.css, so carrying
       both would repaint the sharing warning in the muted color it is warning against. -->
  <p
    class:alert-note={shareWithServer}
    class:muted-note={!shareWithServer}
    class="muted-note--xs privacy-note"
    role={queryNoteRole}
  >
    {shareWithServer
      ? 'Sharing sends the full URL, including every query value, to the Signal K server.'
      : 'This URL contains query values that may be private. It stays on this device unless you choose to share the full URL.'}
  </p>
{:else}
  <p class="muted-note muted-note--xs privacy-note">
    Sharing lets other Signal K clients discover this chart. Turn it off to keep the full URL on
    this device.
  </p>
{/if}

<style>
.share-choice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
.share-choice input {
  flex: 0 0 auto;
  margin-block-start: 0.15rem;
}
</style>
