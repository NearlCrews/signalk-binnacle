<script lang="ts">
import {
  ChevronRight,
  Download,
  DownloadCloud,
  Files,
  RefreshCw,
  SquareDashed,
  Trash2,
} from '@lucide/svelte';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { chartSourceById } from 'signalk-chart-sources';
import { onDestroy } from 'svelte';
import type { UnitsStore } from '$entities/units';
import {
  AccessRecoveryNote,
  type AccessRecoveryState,
  Disclosure,
  LayerToggle,
  SlideOver,
  TextField,
  UnitField,
} from '$shared/ui';
import AutoCacheView from './AutoCacheView.svelte';
import { DETAIL_PRESETS } from './detail-level.js';
import type { SavedRegionDto } from './regions-client.js';
import { createRegionsClient } from './regions-client.js';
import { createRegionsController } from './regions-controller.svelte.js';
import SavedRegionsView from './SavedRegionsView.svelte';
import StorageView from './StorageView.svelte';
import { sourceDescription } from './source-summary.js';

interface Props {
  adminAccess: boolean;
  accessUrl: string;
  accessState: AccessRecoveryState;
  companionBase: string;
  map: MapLibreMap;
  units: UnitsStore;
  onClose: () => void;
  onBack?: () => void;
  onOpenCharts: () => void;
  onRetryAccess: () => void;
}

const {
  adminAccess,
  accessUrl,
  accessState,
  companionBase,
  map,
  units,
  onClose,
  onBack,
  onOpenCharts,
  onRetryAccess,
}: Props = $props();

// Chart Locker management uses the browser's Signal K administrator session, not Binnacle's device
// token. The browser supplies the current Signal K cookie whenever the companion base changes.
const client = $derived(createRegionsClient(companionBase));
const controller = createRegionsController({
  getAdminAccess: () => adminAccess,
  getClient: () => client,
  getMap: () => map,
  getUnitsMode: () => units.mode,
});
controller.start();
$effect(() => controller.syncClient());
$effect(() => controller.syncRectangle());
onDestroy(() => controller.destroy());

const stats = $derived(controller.stats);
const statsError = $derived(controller.statsError);
const regions = $derived(controller.regions);
const loadError = $derived(controller.loadError);
const bbox = $derived(controller.bbox);
const minzoom = $derived(controller.minzoom);
const maxzoom = $derived(controller.maxzoom);
const subView = $derived(controller.subView);
const subViewTitle = $derived(controller.subViewTitle);
const panelCollapsed = $derived(controller.panelCollapsed);
const drawing = $derived(controller.drawing);
const namePrep = $derived(controller.namePrep);
const regionName = $derived(controller.regionName);
const submitting = $derived(controller.submitting);
const error = $derived(controller.error);
const regionStatus = $derived(controller.regionStatus);
const armedDelete = controller.armedDelete;
const pendingRegion = $derived(controller.pendingRegion);
const ttlDays = $derived(controller.ttlDays);
const confirmingClear = $derived(controller.confirmingClear);
const clearNote = $derived(controller.clearNote);
const positionEnabled = $derived(controller.positionEnabled);
const positionLoadError = $derived(controller.positionLoadError);
const positionIntervalSecs = $derived(controller.positionIntervalSecs);
const positionBaseZoom = $derived(controller.positionBaseZoom);
const positionWarmSourceList = controller.positionWarmSourceList;
const providerError = $derived(controller.providerError);

const unit = $derived(controller.unit);
const positionRadiusDisplay = $derived(controller.positionRadiusDisplay);
const positionMoveDisplay = $derived(controller.positionMoveDisplay);
const selectedSet = $derived(controller.selectedSet);
const positionSet = $derived(controller.positionSet);
const includedText = $derived(controller.includedText);
const sourceGroups = $derived(controller.sourceGroups);
const detailPreset = $derived(controller.detailPreset);
const selectedDetail = $derived(controller.selectedDetail);
const estimateError = $derived(controller.estimateError);
const estimateFmt = $derived(controller.estimateFmt);
const gate = $derived(controller.gate);
const gateReason = $derived(controller.gateReason);
const regionsFreeFmt = $derived(controller.regionsFreeFmt);
const pinnedFmt = $derived(controller.pinnedFmt);
const scrollFmt = $derived(controller.scrollFmt);
const usedFmt = $derived(controller.usedFmt);
const capFmt = $derived(controller.capFmt);
const usedPercent = $derived(controller.usedPercent);
const autoCacheFmt = $derived(controller.autoCacheFmt);

const loadPositionWarm = () => controller.loadPositionWarm();
const commitPositionRadius = (value: number) => controller.commitPositionRadius(value);
const commitMoveThreshold = (value: number) => controller.commitMoveThreshold(value);
const commitTtlDays = (value: number) => controller.commitTtlDays(value);
const clearScrollCache = () => controller.clearScrollCache();
const loadStats = () => controller.loadStats();
const prepareDownload = () => controller.prepareDownload();
const saveRegion = () => controller.saveRegion();
const cancelNamePrep = () => controller.cancelNamePrep();
const redownloadRegion = (id: string) => controller.redownloadRegion(id);
const toggleSource = (id: string, enabled: boolean) => controller.toggleSource(id, enabled);
const startDrawing = () => controller.startDrawing();
const startNewRegion = () => controller.startNewRegion();
const backToOfflineHome = () => controller.backToOfflineHome();
const showRegion = (region: SavedRegionDto) => controller.showRegion(region);
const useRegionAsTemplate = (region: SavedRegionDto) => controller.useRegionAsTemplate(region);
const applyDetailPreset = (key: 'overview' | 'coastal' | 'harbor') =>
  controller.applyDetailPreset(key);

// The per-chart storage breakdown is keyed by source id. Resolve it to the plain registry title
// through the shared catalog lookup, collapse the synthetic base-map sub-source keys, and fall back
// to the id so an unknown key never shows blank.
function chartLabel(id: string): string {
  if (id.startsWith('style:') || id === '__basemap_assets__') return 'Base map';
  return chartSourceById(id)?.title ?? id;
}
</script>

<SlideOver
  title={subViewTitle}
  subtitle={drawing ? 'Drag over the chart to select the area' : undefined}
  closeLabel="Close offline charts"
  {onClose}
  onBack={subView === 'home' ? onBack : backToOfflineHome}
  backLabel={subView === 'home' ? 'Back to menu' : 'Back to offline charts'}
  minimize={subView === 'build'
    ? { collapsed: panelCollapsed, onToggle: () => controller.toggleCollapsed() }
    : undefined}
  bodyFlex
>
  {#if error !== null}
    <p class="alert-note" role="alert">{error}</p>
  {/if}
  {#if !adminAccess}
    <AccessRecoveryNote
      state={accessState}
      capability="manage offline charts"
      {accessUrl}
      onRetry={onRetryAccess}
    />
  {/if}

  {#if subView === 'home'}
    <p class="muted-note">
      Save the charts needed for a passage, verify their status, and manage offline storage.
    </p>
    <div class="panel-controls">
      <button
        type="button"
        class="btn btn-primary btn--grow"
        disabled={!adminAccess}
        onclick={startNewRegion}
      >
        <DownloadCloud size={16} aria-hidden="true" />
        Save a chart area
      </button>
    </div>

    <SavedRegionsView
      {regions}
      {loadError}
      {regionStatus}
      {pendingRegion}
      {submitting}
      {adminAccess}
      {armedDelete}
      {chartLabel}
      onShow={showRegion}
      onUseTemplate={useRegionAsTemplate}
      onRedownload={(id) => void redownloadRegion(id)}
    />

    <button
      type="button"
      class="subview-link row-interactive"
      onclick={() => controller.showSubView('auto')}
    >
      <span class="subview-link-label">Automatic caching</span>
      <span class="subview-link-value">{positionEnabled ? 'On' : 'Off'}</span>
      <ChevronRight class="subview-link-chevron" size={18} aria-hidden="true" />
    </button>
    <button type="button" class="subview-link row-interactive" onclick={onOpenCharts}>
      <Files size={18} aria-hidden="true" />
      <span class="subview-link-label">Installed charts</span>
      <span class="subview-link-value">Names and file health</span>
      <ChevronRight class="subview-link-chevron" size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="subview-link row-interactive"
      onclick={() => controller.showSubView('storage')}
    >
      <span class="subview-link-label">Storage</span>
      <span class="subview-link-value">
        {usedFmt?.value ?? '--'} {usedFmt?.unit ?? ''} of {capFmt?.value ?? '--'}
        {capFmt?.unit ?? ''}
      </span>
      <ChevronRight class="subview-link-chevron" size={18} aria-hidden="true" />
    </button>
  {:else if subView === 'build'}
    <section class="panel-section" aria-label="Save a chart area">
      <h3 class="caps-label">1. Select the area</h3>
      <div class="panel-controls">
        <button
          type="button"
          class="btn btn--grow"
          disabled={!adminAccess}
          class:is-on={drawing}
          aria-pressed={drawing}
          onclick={startDrawing}
        >
          <SquareDashed size={16} aria-hidden="true" />
          Draw on the chart
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          disabled={bbox === null || !adminAccess}
          onclick={() => controller.clearRectangle()}
        >
          <Trash2 size={16} aria-hidden="true" />
          Clear
        </button>
      </div>
      {#if bbox !== null}
        <p class="muted-note">Area set. Draw again to change it.</p>
      {:else}
        <p class="muted-note">Tap Draw on the chart, then drag a box over where you are going.</p>
      {/if}
      {#if providerError !== null}
        <p class="alert-note" role="alert">{providerError}</p>
      {/if}

      {#if bbox !== null}
        <h3 class="caps-label">2. Choose charts and detail</h3>
        <p class="muted-note"><strong>Included:</strong> {includedText}</p>
        <Disclosure label="Customize included charts">
          <p class="muted-note">
            Binnacle initially includes the primary chart covering this area, navigation marks, and
            the base map. Specialist overlays stay off unless you choose them.
          </p>
          <p class="muted-note">
            A chart left unchecked will not be available offline in this saved area.
          </p>
          {#each sourceGroups as group (group.category)}
            <h4 class="caps-label">{group.title}</h4>
            {#each group.sources as source (source.id)}
              <div class="list-row">
                <LayerToggle
                  title={source.id === 'basemap'
                    ? 'Base map: land, roads, and place names'
                    : source.title}
                  description={sourceDescription(source.id)}
                  visible={selectedSet.has(source.id)}
                  disabled={!adminAccess}
                  onToggle={(on) => toggleSource(source.id, on)}
                />
              </div>
            {/each}
          {/each}
        </Disclosure>

        <div class="segmented" role="group" aria-label="Detail level">
          {#each DETAIL_PRESETS as preset (preset.key)}
            <button
              type="button"
              class="btn"
              class:is-on={detailPreset === preset.key}
              aria-pressed={detailPreset === preset.key}
              aria-label={preset.recommended ? `${preset.label}, recommended` : preset.label}
              onclick={() => applyDetailPreset(preset.key)}
            >
              {preset.label}
            </button>
          {/each}
        </div>
        {#if selectedDetail}
          <p class="muted-note detail-explanation">{selectedDetail.description}</p>
        {:else}
          <p class="muted-note detail-explanation">Custom zoom detail.</p>
        {/if}
        <Disclosure label="Advanced zoom">
          <UnitField
            label="Minimum zoom"
            value={minzoom}
            min={0}
            max={maxzoom}
            step={1}
            onCommit={(value) => controller.commitMinZoom(value)}
          />
          <UnitField
            label="Maximum zoom"
            value={maxzoom}
            min={minzoom}
            max={22}
            step={1}
            onCommit={(value) => controller.commitMaxZoom(value)}
          />
        </Disclosure>

        <h3 class="caps-label">3. Review and download</h3>
        {#if statsError !== null}
          <p class="alert-note" role="alert">{statsError}</p>
          <button type="button" class="btn btn-ghost" onclick={() => void loadStats()}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry storage check
          </button>
        {:else if stats === null}
          <p class="muted-note" role="status">Checking storage…</p>
        {:else}
          <dl class="stat-grid">
            <dt>Estimated download</dt>
            <dd>
              {#if estimateError === null}
                <span class="num">{estimateFmt.value}</span>
                <span class="unit">{estimateFmt.unit}</span>
              {:else}
                <span class="num">--</span>
              {/if}
            </dd>
            <dt>Space available</dt>
            <dd>
              <span class="num">{regionsFreeFmt?.value ?? '--'}</span>
              <span class="unit">{regionsFreeFmt?.unit ?? ''}</span>
            </dd>
          </dl>
          <p class="muted-note">
            This planning estimate can vary with tile content. Empty water with no chart data is
            skipped, shared base-map labels are downloaded only once, and storage limits are
            enforced while saving.
          </p>
        {/if}

        {#if namePrep}
          <TextField
            label="Area name"
            value={regionName}
            onCommit={(value) => controller.setRegionName(value)}
          />
          <div class="panel-controls">
            <button
              type="button"
              class="btn btn-primary btn--grow"
              disabled={submitting || !adminAccess}
              onclick={() => void saveRegion()}
            >
              <Download size={16} aria-hidden="true" />
              Start download
            </button>
            <button type="button" class="btn btn-ghost" onclick={cancelNamePrep}>Cancel</button>
          </div>
        {:else}
          <div class="panel-controls">
            <button
              type="button"
              class="btn btn-primary btn--grow"
              disabled={!gate || submitting}
              onclick={() => void prepareDownload()}
            >
              <Download size={16} aria-hidden="true" />
              Review download
            </button>
          </div>
          {#if gateReason === 'choose-charts'}
            <p class="muted-note sev-warning" role="status">
              Choose at least one chart for this area.
            </p>
          {:else if gateReason === 'insufficient-space'}
            <p class="alert-note" role="alert">
              This download is larger than the available saved-area storage. Choose less detail,
              draw a smaller area, or free storage.
            </p>
            <button
              type="button"
              class="btn btn-ghost"
              onclick={() => controller.showSubView('storage')}
            >
              Open storage
            </button>
          {:else if gateReason === 'storage-loading'}
            <p class="muted-note" role="status">Waiting for storage information.</p>
          {:else if gateReason === 'estimate-error'}
            <p class="alert-note" role="alert">{estimateError}</p>
            <button type="button" class="btn btn-ghost" onclick={() => void loadStats()}>
              <RefreshCw size={16} aria-hidden="true" />
              Retry storage check
            </button>
          {:else if gateReason === 'administrator-access'}
            <p class="muted-note" role="status">
              Signal K administrator access is required to download.
            </p>
          {/if}
        {/if}
        <p class="muted-note">Once complete, this area remains available without internet.</p>
      {:else}
        <div class="pending-step" aria-disabled="true">
          <h3 class="caps-label">2. Choose charts and detail</h3>
          <p class="muted-note">Available after an area is selected.</p>
        </div>
        <div class="pending-step" aria-disabled="true">
          <h3 class="caps-label">3. Review and download</h3>
          <p class="muted-note">Available after an area is selected.</p>
        </div>
      {/if}
    </section>
  {:else if subView === 'storage'}
    <StorageView
      {stats}
      {usedPercent}
      used={usedFmt}
      cap={capFmt}
      pinned={pinnedFmt}
      scroll={scrollFmt}
      automatic={autoCacheFmt}
      {ttlDays}
      writerState={controller.ttlWriterState}
      {adminAccess}
      {confirmingClear}
      {clearNote}
      {chartLabel}
      onCommitTtl={commitTtlDays}
      onRetryTtl={() => controller.retryTtlWrite()}
      onRequestClear={() => controller.requestClear()}
      onConfirmClear={() => void clearScrollCache()}
      onCancelClear={() => controller.cancelClear()}
    />
  {:else if subView === 'auto'}
    <AutoCacheView
      enabled={positionEnabled}
      {adminAccess}
      loadError={positionLoadError}
      writerState={controller.positionWriterState}
      sources={positionWarmSourceList}
      selectedSources={positionSet}
      {unit}
      radius={positionRadiusDisplay}
      moveThreshold={positionMoveDisplay}
      intervalSeconds={positionIntervalSecs}
      baseZoom={positionBaseZoom}
      {sourceDescription}
      onRetryLoad={() => void loadPositionWarm()}
      onRetrySave={() => controller.retryPositionWrite()}
      onToggleEnabled={(enabled) => controller.setPositionEnabled(enabled)}
      onToggleSource={(id, enabled) => controller.togglePositionSource(id, enabled)}
      onCommitRadius={commitPositionRadius}
      onCommitMoveThreshold={commitMoveThreshold}
      onCommitInterval={(value) => controller.commitPositionInterval(value)}
      onCommitBaseZoom={(value) => controller.commitPositionBaseZoom(value)}
    />
  {/if}
</SlideOver>

<style>
/* The .panel-section wrapper used by the sections above is the shared class in panels.css. */

.detail-explanation {
  margin: 0;
}
.pending-step {
  opacity: var(--disabled-opacity);
}
.pending-step h3,
.pending-step p {
  margin: 0;
}
/* A landing row that opens a sub-view: a label, its current value, and a trailing chevron, on the
   shared row-interactive base so it reads like the Layers-panel category toggles. Named off the
   global .nav-row (which is an elevated card with a vertical name-over-metrics layout) so the two do
   not collide: a bare .nav-row here inherited the card's flex-direction column and stacked the row. */
.subview-link {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--control-size);
  padding-inline: var(--space-1);
  border-radius: var(--radius-sm);
}
.subview-link-label {
  flex: 1;
  text-align: start;
}
.subview-link-value {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.subview-link :global(.subview-link-chevron) {
  flex-shrink: 0;
  color: var(--text-muted);
}
</style>
