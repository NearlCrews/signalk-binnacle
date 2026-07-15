<script lang="ts">
import { Eye, PencilRuler, RefreshCw, Trash2 } from '@lucide/svelte';
import { formatBounds } from '$shared/geo';
import { formatBytes } from '$shared/lib';
import { type ArmedRow, Disclosure, InlineConfirm, SavedList } from '$shared/ui';
import type { SavedRegionDto, WarmStatus } from './regions-client.js';

interface Props {
  regions: SavedRegionDto[] | null;
  loadError: string | null;
  regionStatus: Record<string, WarmStatus>;
  pendingRegion: Record<string, boolean>;
  submitting: boolean;
  adminAccess: boolean;
  armedDelete: ArmedRow;
  chartLabel: (id: string) => string;
  onShow: (region: SavedRegionDto) => void;
  onUseTemplate: (region: SavedRegionDto) => void;
  onRedownload: (id: string) => void;
}

const {
  regions,
  loadError,
  regionStatus,
  pendingRegion,
  submitting,
  adminAccess,
  armedDelete,
  chartLabel,
  onShow,
  onUseTemplate,
  onRedownload,
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
        {#if region.status === 'downloading' && live && live.total > 0}
          {@const percent = Math.round((live.done / live.total) * 100)}
          <div
            class="warm-track"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin="0"
            aria-valuemax={live.total}
            aria-valuenow={live.done}
            aria-valuetext={progressText(live, percent)}
          >
            <div class="warm-fill" style:inline-size="{percent}%"></div>
          </div>
          <p class="progress-note muted-note" role="status">{progressText(live, percent)}</p>
        {:else if region.status === 'downloading'}
          <p class="progress-note muted-note" role="status">Starting download…</p>
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
              <dd>{region.sourceIds.map(chartLabel).join(', ')}</dd>
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
                region.status === 'downloading'}
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
.progress-note {
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
.warm-track {
  block-size: var(--range-track-h);
  border-radius: var(--radius-pill);
  background: var(--border);
  overflow: hidden;
}
.warm-fill {
  block-size: 100%;
  background: var(--accent);
  transition: inline-size var(--transition-fast);
}
</style>
