<script lang="ts">
import Eye from '@lucide/svelte/icons/eye';
import PencilRuler from '@lucide/svelte/icons/pencil-ruler';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Trash2 from '@lucide/svelte/icons/trash-2';
import { formatBounds } from '$shared/geo';
import { formatBytes } from '$shared/lib';
import { type ArmedRow, Disclosure, InlineConfirm, SavedList } from '$shared/ui';
import { areaSummary } from './area-summary';
import type { SavedRegionDto, WarmStatus } from './regions-client.js';

interface Props {
  regions: SavedRegionDto[] | null;
  loadError: string | null;
  regionStatus: Record<string, WarmStatus>;
  regionPollError: Record<string, boolean>;
  pendingRegion: Record<string, boolean>;
  submitting: boolean;
  adminAccess: boolean;
  armedDelete: ArmedRow;
  chartLabel: (id: string) => string;
  onShow: (region: SavedRegionDto) => void;
  onUseTemplate: (region: SavedRegionDto) => void;
  onRedownload: (id: string) => void;
  onRetryStatus: (id: string) => void;
}

const {
  regions,
  loadError,
  regionStatus,
  regionPollError,
  pendingRegion,
  submitting,
  adminAccess,
  armedDelete,
  chartLabel,
  onShow,
  onUseTemplate,
  onRedownload,
  onRetryStatus,
}: Props = $props();

const STATUS_META: Record<SavedRegionDto['status'], { label: string; severity: string }> = {
  downloading: { label: 'Saving…', severity: '' },
  ready: { label: 'Saved, works offline', severity: '' },
  capped: { label: 'Storage full, some left out', severity: 'sev-warning' },
  error: { label: 'Could not finish', severity: 'sev-danger' },
  'needs-redownload': { label: 'Out of date, download again', severity: 'sev-warning' },
};

function progressText(status: WarmStatus, percent: number): string {
  const saved = formatBytes(status.bytes);
  const skipped = status.skipped > 0 ? `, ${status.skipped} empty tiles skipped` : '';
  const errors = status.errors > 0 ? `, ${status.errors} errors` : '';
  return `${percent}% saved, ${saved.value} ${saved.unit}, ${status.done} of ${status.total} tiles${skipped}${errors}`;
}

function chartList(region: SavedRegionDto): string {
  const unavailable = new Set(region.unavailableSourceIds);
  return region.sourceIds
    .map((id) => `${chartLabel(id)}${unavailable.has(id) ? ' (unavailable)' : ''}`)
    .join(', ');
}
</script>

<section class="panel-section" aria-label="My areas">
  <h3 class="caps-label">My areas</h3>
  {#if loadError !== null}
    <p class="alert-note" role="alert">{loadError}</p>
  {:else if regions === null}
    <p class="muted-note" role="status">Loading areas…</p>
  {:else}
    <SavedList
      items={regions}
      empty="No saved areas yet. Save a chart area before leaving internet coverage."
      key={(region) => region.id}
    >
      {#snippet card(region)}
        {@const live = regionStatus[region.id]}
        {@const savedBytes =
          region.status === 'downloading' && live ? live.bytes : region.cachedBytes}
        {@const cached = formatBytes(savedBytes)}
        <div class="card-head">
          <span class="name" title={region.name}>{region.name}</span>
          <span class="area-status caps-label {STATUS_META[region.status].severity}">
            {STATUS_META[region.status].label}
          </span>
        </div>
        <!-- The at-a-glance facts that tell several areas apart without opening each card. It states
             what was requested, never that the area is passage-ready; verifying coverage against a
             passage stays a navigator judgment. -->
        <p class="area-summary muted-note">{areaSummary(region)}</p>
        <dl class="card-stats">
          <dt class="caps-label">Saved</dt>
          <dd><span class="num">{cached.value}</span> {cached.unit}</dd>
          {#if region.lastDownloadedAt !== null}
            <dt class="caps-label">Updated</dt>
            <dd>
              <span class="num"
                >{new Date(region.lastDownloadedAt * 1000).toLocaleDateString()}</span
              >
            </dd>
          {/if}
        </dl>
        {#if region.status === 'downloading' && regionPollError[region.id]}
          <div class="download-retry">
            <p class="muted-note sev-warning" role="status">
              Download status is unavailable. The server may still be saving this area.
            </p>
            <button
              type="button"
              class="btn btn-ghost"
              disabled={!adminAccess || submitting || pendingRegion[region.id]}
              onclick={() => onRetryStatus(region.id)}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Retry status
            </button>
          </div>
        {:else if region.status === 'downloading' && live && live.total > 0}
          {@const percent = Math.round((live.done / live.total) * 100)}
          <div
            class="progress-track"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin="0"
            aria-valuemax={live.total}
            aria-valuenow={live.done}
            aria-valuetext={progressText(live, percent)}
          >
            <div class="progress-fill" style:inline-size="{percent}%"></div>
          </div>
          <p class="progress-note muted-note" role="status">{progressText(live, percent)}</p>
        {:else if region.status === 'downloading'}
          <p class="progress-note muted-note" role="status">Starting download…</p>
        {/if}
        {#if region.unavailableSourceIds.length > 0}
          <p class="muted-note sev-warning" role="status">
            {region.unavailableSourceIds.length === 1
              ? 'One included chart is no longer available from Chart Locker.'
              : `${region.unavailableSourceIds.length} included charts are no longer available from Chart Locker.`}
            Existing cached coverage is unchanged. Adjust a copy to choose replacements before
            downloading again.
          </p>
        {/if}
        <Disclosure label="Area details">
          <dl class="detail-list area-details">
            <div class="item">
              <dt>Coverage</dt>
              <dd>{formatBounds(region.bbox)}</dd>
            </div>
            <div class="item">
              <dt>Detail</dt>
              <dd>Zoom {region.minzoom} to {region.maxzoom}</dd>
            </div>
            <div class="item">
              <dt>Charts</dt>
              <dd>{chartList(region)}</dd>
            </div>
          </dl>
          <div class="area-detail-actions">
            <button type="button" class="btn btn-ghost" onclick={() => onShow(region)}>
              <Eye size={16} aria-hidden="true" />
              Show on chart
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              disabled={!adminAccess || region.status === 'downloading'}
              onclick={() => onUseTemplate(region)}
            >
              <PencilRuler size={16} aria-hidden="true" />
              Adjust a copy
            </button>
          </div>
          <p class="muted-note">
            Adjusting keeps this known-good area until the replacement finishes and you delete the
            old copy.
          </p>
        </Disclosure>
        {#if armedDelete.isArmed(region.id)}
          <InlineConfirm
            question="Delete this offline area?"
            onConfirm={() => armedDelete.confirm(region.id)}
            onCancel={() => armedDelete.cancel()}
          />
        {:else}
          <div class="actions">
            <button
              type="button"
              class="icon-btn"
              aria-label="Download this area again"
              title="Download again"
              disabled={!adminAccess ||
                submitting ||
                pendingRegion[region.id] ||
                region.status === 'downloading' ||
                region.unavailableSourceIds.length > 0}
              onclick={() => onRedownload(region.id)}
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              aria-label="Delete this area"
              title="Delete"
              disabled={!adminAccess || submitting || pendingRegion[region.id]}
              onclick={() => armedDelete.arm(region.id)}
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </div>
        {/if}
      {/snippet}
    </SavedList>
  {/if}
</section>

<style>
.card-head {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
}
.area-status {
  min-block-size: 1.25rem;
}
/* The one-line glance summary wraps at its separators on a 320px phone rather than overflowing. */
.area-summary {
  margin: 0;
  overflow-wrap: anywhere;
}
.progress-note {
  margin: 0;
}
.download-retry {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
}
.download-retry .muted-note {
  margin: 0;
}
.area-details dd {
  max-inline-size: 62%;
  overflow-wrap: anywhere;
  text-align: end;
}
.area-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.area-detail-actions .btn {
  flex: 1 1 auto;
}
</style>
