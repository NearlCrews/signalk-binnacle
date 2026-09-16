<script lang="ts">
import type { LatestWriterState } from '$shared/lib';
import { Disclosure, LayerToggle, SaveStatus, ShowOnChartToggle, UnitField } from '$shared/ui';
import { CHART_LOCKER_MAX_WARM_ZOOM } from './contract.js';

interface AutoCacheSource {
  id: string;
  title: string;
}

interface Props {
  enabled: boolean;
  adminAccess: boolean;
  loadError: string | null;
  loading: boolean;
  settingsReady: boolean;
  writerState: LatestWriterState;
  sources: AutoCacheSource[];
  selectedSources: Set<string>;
  unit: string;
  radius: number;
  moveThreshold: number;
  intervalSeconds: number;
  baseZoom: number;
  sourceDescription: (id: string) => string | undefined;
  onRetryLoad: () => void;
  onRetrySave: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onToggleSource: (id: string, enabled: boolean) => void;
  onCommitRadius: (value: number) => void;
  onCommitMoveThreshold: (value: number) => void;
  onCommitInterval: (value: number) => void;
  onCommitBaseZoom: (value: number) => void;
}

const {
  enabled,
  adminAccess,
  loadError,
  loading,
  settingsReady,
  writerState,
  sources,
  selectedSources,
  unit,
  radius,
  moveThreshold,
  intervalSeconds,
  baseZoom,
  sourceDescription,
  onRetryLoad,
  onRetrySave,
  onToggleEnabled,
  onToggleSource,
  onCommitRadius,
  onCommitMoveThreshold,
  onCommitInterval,
  onCommitBaseZoom,
}: Props = $props();
const unavailable = $derived(!adminAccess || !settingsReady || loading);
</script>

<section class="panel-section" aria-label="Automatic caching">
  <p class="muted-note">
    Caches selected charts around the boat as it moves. Check saved coverage before relying on it
    without internet; caching does not certify passage readiness.
  </p>
  {#if loading}
    <p class="muted-note" role="status">Loading automatic-caching settings…</p>
  {/if}
  {#if loadError !== null}
    <div class="save-error" role="alert">
      <p class="alert-note">{loadError}</p>
      <button type="button" class="btn btn-ghost" disabled={loading} onclick={onRetryLoad}>
        Retry settings
      </button>
    </div>
  {/if}
  <SaveStatus
    state={writerState}
    errorMessage="Could not save automatic-caching settings."
    onRetry={onRetrySave}
  />
  {#if settingsReady}
    <ShowOnChartToggle
      visible={enabled}
      label="Enable automatic caching"
      description="Caches selected chart tiles around the boat as it moves."
      disabled={unavailable}
      onToggle={onToggleEnabled}
    />
    {#if enabled}
      <h4 class="caps-label">Charts to cache automatically</h4>
      {#if selectedSources.size === 0 && sources.length > 0}
        <p class="muted-note sev-warning" role="status">
          Automatic caching is on but no charts are picked, so nothing is being saved. Choose at
          least one chart below.
        </p>
      {/if}
      {#each sources as source (source.id)}
        <div class="list-row">
          <LayerToggle
            label={source.title}
            description={sourceDescription(source.id)}
            visible={selectedSources.has(source.id)}
            disabled={unavailable}
            onToggle={(on) => onToggleSource(source.id, on)}
          />
        </div>
      {/each}
      {#if sources.length === 0}
        <p class="muted-note">No charts are available for automatic caching.</p>
      {/if}
    {/if}
    <Disclosure label="Advanced">
      <UnitField
        label="How far around the boat"
        {unit}
        value={radius}
        min={1}
        step={1}
        disabled={!enabled || unavailable}
        onCommit={onCommitRadius}
      />
      <UnitField
        label="Re-cache after moving"
        {unit}
        value={moveThreshold}
        min={1}
        step={1}
        disabled={!enabled || unavailable}
        onCommit={onCommitMoveThreshold}
      />
      <UnitField
        label="Check every"
        unit="s"
        value={intervalSeconds}
        min={60}
        step={1}
        disabled={!enabled || unavailable}
        onCommit={onCommitInterval}
      />
      <UnitField
        label="Zoom detail"
        value={baseZoom}
        min={0}
        max={CHART_LOCKER_MAX_WARM_ZOOM}
        step={1}
        disabled={!enabled || unavailable}
        onCommit={onCommitBaseZoom}
      />
    </Disclosure>
  {:else if !loading}
    <p class="muted-note">
      Settings are unavailable. Load the current policy before changing automatic caching.
    </p>
  {/if}
</section>

<style>
.save-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}
.save-error .alert-note {
  margin: 0;
}
</style>
