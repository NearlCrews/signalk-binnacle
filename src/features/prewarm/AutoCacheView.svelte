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
</script>

<section class="panel-section" aria-label="Automatic caching">
  <p class="muted-note">
    Caches the chart around the boat as it moves, so the area ahead is ready offline without
    downloading an area yourself.
  </p>
  {#if loadError !== null}
    <div class="save-error" role="alert">
      <p class="alert-note">{loadError}</p>
      <button type="button" class="btn btn-ghost" onclick={onRetryLoad}>Try again</button>
    </div>
  {/if}
  <SaveStatus
    state={writerState}
    errorMessage="Could not save automatic-caching settings."
    onRetry={onRetrySave}
  />
  <ShowOnChartToggle
    visible={enabled}
    label="Enable automatic caching"
    description="Caches chart tiles around the boat as it moves, so the water ahead is ready offline."
    disabled={!adminAccess}
    onToggle={onToggleEnabled}
  />
  {#if enabled}
    <h4 class="caps-label">Charts to cache automatically</h4>
    {#if selectedSources.size === 0 && sources.length > 0}
      <p class="muted-note sev-warning" role="status">
        Automatic caching is on but no charts are picked, so nothing is being saved. Choose at least
        one chart below.
      </p>
    {/if}
    {#each sources as source (source.id)}
      <div class="list-row">
        <LayerToggle
          label={source.title}
          description={sourceDescription(source.id)}
          visible={selectedSources.has(source.id)}
          disabled={!adminAccess}
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
      disabled={!enabled || !adminAccess}
      onCommit={onCommitRadius}
    />
    <UnitField
      label="Re-cache after moving"
      {unit}
      value={moveThreshold}
      min={1}
      step={1}
      disabled={!enabled || !adminAccess}
      onCommit={onCommitMoveThreshold}
    />
    <UnitField
      label="Check every"
      unit="s"
      value={intervalSeconds}
      min={60}
      step={1}
      disabled={!enabled || !adminAccess}
      onCommit={onCommitInterval}
    />
    <UnitField
      label="Zoom detail"
      value={baseZoom}
      min={0}
      max={CHART_LOCKER_MAX_WARM_ZOOM}
      step={1}
      disabled={!enabled || !adminAccess}
      onCommit={onCommitBaseZoom}
    />
  </Disclosure>
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
