<script lang="ts">
import { onDestroy } from 'svelte';
import { formatLengthOr, lengthUnit, RAD_TO_DEG, type UnitsMode } from '$shared/lib';
import { InlineConfirm, registerDismiss, UnitField } from '$shared/ui';
import { displayRadarDistance, siRadarDistance } from './radar-area-units';
import { controlWriteBlockReason } from './radar-controls-model';
import {
  isNativeRectDefinition,
  radarRectSignature,
  radarRectValue,
  validateRadarRect,
} from './radar-rect-model';
import {
  isNativeSectorDefinition,
  radarSectorSignature,
  radarSectorValue,
  validateRadarSector,
} from './radar-sector-model';
import type {
  ControlDefinition,
  RadarAreaDraft,
  RadarControlEntry,
  RadarRectValue,
  RadarSectorValue,
  RadarStructuredValue,
  RadarZoneValue,
} from './radar-types';
import {
  isNativeZoneDefinition,
  radarZoneSignature,
  radarZoneValue,
  validateRadarZone,
} from './radar-zone-model';

type EditState = 'idle' | 'editing' | 'dirty';

const NO_TRANSMIT_WARNING_ID = 'radar-no-transmit-warning';

let {
  definition,
  entry,
  radarId,
  unitsMode,
  controlsForbidden,
  pending,
  anotherEditorActive,
  areaDraft,
  onSave,
  onDraftChange,
  onStartChartEdit,
  onStopChartEdit,
  onEditStateChange,
}: {
  definition: ControlDefinition;
  entry: RadarControlEntry | undefined;
  radarId: string | undefined;
  unitsMode: UnitsMode;
  controlsForbidden: boolean;
  pending: boolean;
  anotherEditorActive: boolean;
  areaDraft: RadarAreaDraft | undefined;
  onSave: (controlId: string, value: RadarStructuredValue) => void;
  onDraftChange: (draft: RadarAreaDraft | undefined) => void;
  onStartChartEdit: (controlId: string) => string | undefined;
  onStopChartEdit: () => void;
  onEditStateChange: (controlId: string, state: EditState) => void;
} = $props();

let baselineSignature = $state<string | undefined>(undefined);
let conflict = $state(false);
let identity = $state('');
let chartError = $state<string | undefined>(undefined);
let confirmingSector = $state(false);
let ownsEditor = false;
let sawOwnedDraft = false;

const accepted = $derived(readStructuredValue());
const supported = $derived(accepted !== undefined && definitionSupported());
const activeDraft = $derived(
  areaDraft?.radarId === radarId && areaDraft?.controlId === definition.id ? areaDraft : undefined,
);
const proposed = $derived(activeDraft?.value);
const chartFeedback = $derived(chartError ?? activeDraft?.chartError);
const blockedReason = $derived(controlWriteBlockReason(definition, entry, controlsForbidden));
const validation = $derived(
  proposed ? validateStructuredValue(proposed) : 'No complete radar-area value is available.',
);
const dirty = $derived(
  proposed !== undefined &&
    baselineSignature !== undefined &&
    structuredSignature(proposed) !== baselineSignature,
);
const distanceUnit = $derived(lengthUnit(unitsMode));
const distanceMax = $derived(
  definition.maxDistance === undefined
    ? 0
    : displayRadarDistance(definition.maxDistance, unitsMode),
);
const angleMin = $derived((definition.range?.min ?? 0) * RAD_TO_DEG);
const angleMax = $derived((definition.range?.max ?? 0) * RAD_TO_DEG);
const angleStep = $derived((definition.range?.step ?? 1 / RAD_TO_DEG) * RAD_TO_DEG);
// One spelling of the no-transmit-sector test, shared by the warning id below and the template's
// editor branch, so the description reference cannot dangle on a zone or rectangle editor.
const isNoTransmitSector = $derived(
  definition.type === 'sector' &&
    proposed !== undefined &&
    'value' in proposed &&
    !('startDistance' in proposed),
);
const noTransmitWarningId = $derived(isNoTransmitSector ? NO_TRANSMIT_WARNING_ID : undefined);

function definitionSupported(): boolean {
  if (definition.type === 'zone') return isNativeZoneDefinition(definition);
  if (definition.type === 'sector') return isNativeSectorDefinition(definition);
  if (definition.type === 'rect') return isNativeRectDefinition(definition);
  return false;
}

function readStructuredValue(): RadarStructuredValue | undefined {
  if (definition.type === 'zone') return radarZoneValue(entry);
  if (definition.type === 'sector') return radarSectorValue(entry);
  if (definition.type === 'rect') return radarRectValue(entry);
  return undefined;
}

function validateStructuredValue(value: RadarStructuredValue): string | undefined {
  if (definition.type === 'zone' && 'startDistance' in value)
    return validateRadarZone(definition, value);
  if (definition.type === 'sector' && 'value' in value && !('startDistance' in value))
    return validateRadarSector(definition, value);
  if (definition.type === 'rect' && 'x1' in value) return validateRadarRect(definition, value);
  return 'The structured value does not match this radar control.';
}

function structuredSignature(value: RadarStructuredValue): string {
  if ('x1' in value) return radarRectSignature(value);
  if ('startDistance' in value) return radarZoneSignature(value);
  return radarSectorSignature(value);
}

function cancel(): void {
  onStopChartEdit();
  onDraftChange(undefined);
  baselineSignature = undefined;
  conflict = false;
  chartError = undefined;
  confirmingSector = false;
  onEditStateChange(definition.id, 'idle');
  ownsEditor = false;
  sawOwnedDraft = false;
}

function loadAccepted(): void {
  if (!accepted || !radarId) return;
  baselineSignature = structuredSignature(accepted);
  conflict = false;
  chartError = undefined;
  confirmingSector = false;
  ownsEditor = true;
  onDraftChange({
    radarId,
    controlId: definition.id,
    type: definition.type as RadarAreaDraft['type'],
    value: accepted,
    chartEditing: false,
    chartStep: 0,
  });
  onEditStateChange(definition.id, 'editing');
}

function commitSave(): void {
  if (!proposed || validation || blockedReason || conflict || pending) return;
  onSave(definition.id, proposed);
  cancel();
}

function save(): void {
  if (definition.type === 'sector') {
    confirmingSector = true;
    return;
  }
  commitSave();
}

function updateValue(value: RadarStructuredValue): void {
  if (!activeDraft) return;
  chartError = undefined;
  onDraftChange({ ...activeDraft, value, chartError: undefined });
}

function updateEnabled(enabled: boolean): void {
  if (proposed) updateValue({ ...proposed, enabled });
}

function startChartEdit(): void {
  chartError = onStartChartEdit(definition.id);
}

function structuredReadout(): string {
  if (!entry) return 'No current geometry was reported.';
  const fields = Object.entries(entry)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return fields.length > 0 ? fields.join(', ') : 'No current geometry was reported.';
}

function areaSummary(): string {
  if (!accepted) return 'The provider has not reported a complete radar area.';
  const state = accepted.enabled ? 'enabled' : 'disabled';
  if ('x1' in accepted) {
    return `Rectangle ${state}. Edge ${formatLengthOr(accepted.x1, unitsMode)} ${distanceUnit} east, ${formatLengthOr(accepted.y1, unitsMode)} ${distanceUnit} north to ${formatLengthOr(accepted.x2, unitsMode)} ${distanceUnit} east, ${formatLengthOr(accepted.y2, unitsMode)} ${distanceUnit} north. Width ${formatLengthOr(accepted.width, unitsMode)} ${distanceUnit}.`;
  }
  const start = Number((accepted.value * RAD_TO_DEG).toFixed(1));
  const end = Number((accepted.endValue * RAD_TO_DEG).toFixed(1));
  if ('startDistance' in accepted) {
    return `Zone ${state}. ${start}° to ${end}°, ${formatLengthOr(accepted.startDistance, unitsMode)} to ${formatLengthOr(accepted.endDistance, unitsMode)} ${distanceUnit}.`;
  }
  return `No-transmit sector ${state}. ${start}° to ${end}°.`;
}

function editLabel(): string {
  if (definition.type === 'sector') return 'Edit no-transmit sector';
  if (definition.type === 'rect') return 'Edit exclusion rectangle';
  return 'Edit guard zone';
}

function saveLabel(): string {
  if (definition.type === 'sector') return 'Save sector';
  if (definition.type === 'rect') return 'Save rectangle';
  return 'Save zone';
}

$effect(() => {
  const nextIdentity = `${radarId ?? ''}\u0000${definition.id}\u0000${unitsMode}`;
  if (nextIdentity !== identity) {
    identity = nextIdentity;
    if (activeDraft) cancel();
  }
});

// Assigned, not latched: another station reverting its change, or a provider that bounced and
// republished the original geometry, must clear the conflict and unblock this draft again rather
// than forcing the navigator to discard work over a change that no longer exists.
$effect(() => {
  if (!activeDraft || !accepted || !baselineSignature) return;
  conflict = structuredSignature(accepted) !== baselineSignature;
});

$effect(() => {
  if (activeDraft) onEditStateChange(definition.id, dirty ? 'dirty' : 'editing');
});

$effect(() => {
  if (activeDraft && ownsEditor) {
    sawOwnedDraft = true;
  } else if (!activeDraft && ownsEditor && sawOwnedDraft) {
    ownsEditor = false;
    sawOwnedDraft = false;
    onEditStateChange(definition.id, 'idle');
  }
});

$effect(() => {
  if (activeDraft?.chartEditing) return registerDismiss(() => onStopChartEdit());
});

onDestroy(() => {
  if (ownsEditor) {
    if (activeDraft) onDraftChange(undefined);
    onEditStateChange(definition.id, 'idle');
    ownsEditor = false;
  }
});
</script>

{#if supported}
  <p class="area-summary">{areaSummary()}</p>
  {#if activeDraft && proposed}
    <div class="area-editor" role="group" aria-label={`${definition.name} editor`}>
      {#if definition.type === 'zone' && 'startDistance' in proposed}
        {@const zone = proposed as RadarZoneValue}
        <UnitField
          label="Start angle (from heading)"
          unit="°"
          value={zone.value * RAD_TO_DEG}
          min={angleMin}
          max={angleMax}
          step={angleStep}
          disabled={pending}
          onCommit={(value) => updateValue({ ...zone, value: value / RAD_TO_DEG })}
        />
        <UnitField
          label="End angle (from heading)"
          unit="°"
          value={zone.endValue * RAD_TO_DEG}
          min={angleMin}
          max={angleMax}
          step={angleStep}
          disabled={pending}
          onCommit={(value) => updateValue({ ...zone, endValue: value / RAD_TO_DEG })}
        />
        <UnitField
          label="Inner distance"
          unit={distanceUnit}
          value={displayRadarDistance(zone.startDistance, unitsMode)}
          min={0}
          max={distanceMax}
          step={unitsMode === 'imperial' ? 1 : 0.5}
          disabled={pending}
          onCommit={(value) =>
            updateValue({ ...zone, startDistance: siRadarDistance(value, unitsMode) })}
        />
        <UnitField
          label="Outer distance"
          unit={distanceUnit}
          value={displayRadarDistance(zone.endDistance, unitsMode)}
          min={0}
          max={distanceMax}
          step={unitsMode === 'imperial' ? 1 : 0.5}
          disabled={pending}
          onCommit={(value) =>
            updateValue({ ...zone, endDistance: siRadarDistance(value, unitsMode) })}
        />
      {:else if isNoTransmitSector && proposed !== undefined}
        {@const sector = proposed as RadarSectorValue}
        <p id={NO_TRANSMIT_WARNING_ID} class="alert-note">
          This is a no-transmit sector. Changing or enabling it alters where the radar can emit.
        </p>
        <UnitField
          label="Start angle (from heading)"
          unit="°"
          value={sector.value * RAD_TO_DEG}
          min={angleMin}
          max={angleMax}
          step={angleStep}
          disabled={pending}
          ariaDescribedBy={NO_TRANSMIT_WARNING_ID}
          onCommit={(value) => updateValue({ ...sector, value: value / RAD_TO_DEG })}
        />
        <UnitField
          label="End angle (from heading)"
          unit="°"
          value={sector.endValue * RAD_TO_DEG}
          min={angleMin}
          max={angleMax}
          step={angleStep}
          ariaDescribedBy={NO_TRANSMIT_WARNING_ID}
          disabled={pending}
          onCommit={(value) => updateValue({ ...sector, endValue: value / RAD_TO_DEG })}
        />
      {:else if definition.type === 'rect' && 'x1' in proposed}
        {@const rect = proposed as RadarRectValue}
        <UnitField
          label="First point east"
          unit={distanceUnit}
          value={displayRadarDistance(rect.x1, unitsMode)}
          min={-distanceMax}
          max={distanceMax}
          step={unitsMode === 'imperial' ? 1 : 0.5}
          disabled={pending}
          onCommit={(value) => updateValue({ ...rect, x1: siRadarDistance(value, unitsMode) })}
        />
        <UnitField
          label="First point north"
          unit={distanceUnit}
          value={displayRadarDistance(rect.y1, unitsMode)}
          min={-distanceMax}
          max={distanceMax}
          step={unitsMode === 'imperial' ? 1 : 0.5}
          disabled={pending}
          onCommit={(value) => updateValue({ ...rect, y1: siRadarDistance(value, unitsMode) })}
        />
        <UnitField
          label="Second point east"
          unit={distanceUnit}
          value={displayRadarDistance(rect.x2, unitsMode)}
          min={-distanceMax}
          max={distanceMax}
          step={unitsMode === 'imperial' ? 1 : 0.5}
          disabled={pending}
          onCommit={(value) => updateValue({ ...rect, x2: siRadarDistance(value, unitsMode) })}
        />
        <UnitField
          label="Second point north"
          unit={distanceUnit}
          value={displayRadarDistance(rect.y2, unitsMode)}
          min={-distanceMax}
          max={distanceMax}
          step={unitsMode === 'imperial' ? 1 : 0.5}
          disabled={pending}
          onCommit={(value) => updateValue({ ...rect, y2: siRadarDistance(value, unitsMode) })}
        />
        <UnitField
          label="Width"
          unit={distanceUnit}
          value={displayRadarDistance(rect.width, unitsMode)}
          min={0}
          max={distanceMax}
          step={unitsMode === 'imperial' ? 1 : 0.5}
          disabled={pending}
          onCommit={(value) => updateValue({ ...rect, width: siRadarDistance(value, unitsMode) })}
        />
      {/if}

      <div class="enabled-row">
        <span class="field-label">Area enabled</span>
        <div class="segmented" role="group" aria-label={`${definition.name} enabled`}>
          <button
            type="button"
            class="btn"
            class:is-on={!proposed.enabled}
            aria-pressed={!proposed.enabled}
            aria-describedby={noTransmitWarningId}
            disabled={pending}
            onclick={() => updateEnabled(false)}
          >
            Off
          </button>
          <button
            type="button"
            class="btn"
            class:is-on={proposed.enabled}
            aria-pressed={proposed.enabled}
            aria-describedby={noTransmitWarningId}
            disabled={pending}
            onclick={() => updateEnabled(true)}
          >
            On
          </button>
        </div>
      </div>

      {#if !activeDraft.chartEditing}
        <button type="button" class="btn btn-ghost" disabled={pending} onclick={startChartEdit}>
          Edit on chart
        </button>
      {/if}

      {#if chartFeedback}
        <p class="muted-note" role="status">{chartFeedback}</p>
      {/if}
      {#if conflict}
        <p class="alert-note" role="alert">
          The radar changed this area while you were editing. Reload its current geometry before
          saving.
        </p>
        <button type="button" class="btn btn-ghost" onclick={loadAccepted}>Reload current</button>
      {:else if validation}
        <p class="control-error" role="alert">{validation}</p>
      {:else if blockedReason}
        <p class="muted-note" role="status">{blockedReason} Your draft is preserved.</p>
      {/if}
      <div class="panel-controls">
        <button type="button" class="btn btn-ghost" onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={Boolean(validation || blockedReason || conflict || pending)}
          onclick={save}
        >
          {saveLabel()}
        </button>
      </div>
      {#if confirmingSector}
        <InlineConfirm
          question="Apply this no-transmit sector and change the radar emission envelope?"
          confirmLabel="Apply sector"
          onConfirm={commitSave}
          onCancel={() => (confirmingSector = false)}
        />
      {/if}
    </div>
  {:else}
    <button
      type="button"
      class="btn btn-ghost"
      disabled={Boolean(blockedReason || pending || anotherEditorActive)}
      title={blockedReason}
      onclick={loadAccepted}
    >
      {editLabel()}
    </button>
    {#if blockedReason}
      <p class="muted-note">{blockedReason}</p>
    {/if}
  {/if}
{:else}
  <p class="muted-note">
    {structuredReadout()}.
    {#if definition.type === 'sector'}
      This sector is read-only because the provider did not report a complete native shape and
      angular bounds.
    {:else if definition.type === 'rect'}
      This rectangle is read-only because the provider did not report a complete native shape and
      distance bounds.
    {:else if definition.type === 'zone'}
      This guard zone is read-only because the provider did not report a complete native shape and
      bounds.
    {:else}
      This provider-defined control is not supported for editing.
    {/if}
  </p>
{/if}

<style>
.area-summary,
.control-error {
  margin: 0;
  font-size: var(--text-xs);
}
.area-summary {
  color: var(--text-muted);
}
.control-error {
  color: var(--alarm);
}
.area-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.enabled-row {
  display: flex;
  min-block-size: var(--control-size);
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.field-label {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
@media (max-width: 360px) {
  .enabled-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
