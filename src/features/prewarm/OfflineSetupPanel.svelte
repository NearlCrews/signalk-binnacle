<script lang="ts">
import { SlideOver } from '$shared/ui';
import type { OfflineSetupState } from './offline-setup';

interface Props {
  state: OfflineSetupState;
  accessUrl: string;
  onRetry: () => void;
  onClose: () => void;
  onBack?: () => void;
}

const { state, accessUrl, onRetry, onClose, onBack }: Props = $props();
</script>

<SlideOver title="Offline charts" closeLabel="Close offline charts" bodyFlex {onClose} {onBack}>
  <section class="panel-section" aria-label="Offline chart setup">
    <h3 class="caps-label">Offline chart setup</h3>
    <p class="muted-note">
      Save areas and manage the boat's chart cache with the optional Signal K Chart Locker plugin.
      This is separate from the browser cache used for previously viewed charts.
    </p>
    {#if state === 'checking'}
      <p class="muted-note" role="status">Checking whether Chart Locker is available…</p>
    {:else if state === 'chart-loading'}
      <p class="muted-note" role="status">
        Chart Locker is available. Waiting for the chart view before selecting an area.
      </p>
    {:else if state === 'absent'}
      <p class="muted-note" role="status">
        Chart Locker was not found on this server. An administrator can install signalk-chart-locker
        from the Signal K App Store, enable it, and configure its chart storage. Then retry here.
      </p>
    {:else if state === 'access-refused'}
      <p class="alert-note" role="status">
        Chart Locker refused the availability check. Sign in to Signal K as an administrator, then
        retry. A refusal does not prove the plugin is missing, and Binnacle's device write approval
        is separate from the administrator session required for chart management.
      </p>
    {:else}
      <p class="alert-note" role="status">
        Chart Locker could not be reached. Check the connection to the boat's Signal K server, then
        retry. Its installation and saved-chart status are unknown.
      </p>
    {/if}
    <div class="panel-controls">
      <button type="button" class="btn" onclick={onRetry}>Retry offline chart setup</button>
      <a class="btn btn-ghost" href={accessUrl}>Open Signal K administration</a>
    </div>
  </section>
  <p class="muted-note">
    Check saved areas and chart coverage before leaving internet access. Saved charts still require
    a connection to the boat's server, and no cache status certifies safe navigation.
  </p>
</SlideOver>
