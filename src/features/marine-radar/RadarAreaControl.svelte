<script lang="ts">
import { onDestroy } from 'svelte';
import {
  formatLengthOr,
  lengthUnit,
  METERS_PER_FOOT,
  RAD_TO_DEG,
  type UnitsMode,
} from '$shared/lib';
import { UnitField } from '$shared/ui';
import { controlWriteBlockReason } from './radar-controls-model';
import type { ControlDefinition, RadarControlEntry, RadarZoneValue } from './radar-types';
import {
  isNativeZoneDefinition,
  type RadarZoneDraft,
  radarZoneSignature,
  radarZoneValue,
  validateRadarZone,
  zoneDraftFromValue,
  zoneValueFromDraft,
} from './radar-zone-model';

type EditState = 'idle' | 'editing' | 'dirty';

let {
  definition,
  entry,
  radarId,
  unitsMode,
  controlsForbidden,
  pending,
  anotherEditorActive,
  onSave,
  onEditStateChange,
}: {
  definition: ControlDefinition;
  entry: RadarControlEntry | undefined;
  radarId: string | undefined;
  unitsMode: UnitsMode;
  controlsForbidden: boolean;
  pending: boolean;
  anotherEditorActive: boolean;
  onSave: (controlId: string, value: RadarZoneValue) => void;
  onEditStateChange: (controlId: string, state: EditState) => void;
} = $props();

let editing = $state(false);
let draft = $state<RadarZoneDraft | undefined>(undefined);
let baselineSignature = $state<string | undefined>(undefined);
let conflict = $state(false);
let identity = $state('');

const accepted = $derived(radarZoneValue(entry));
const supported = $derived(
  isNativeZoneDefinition(definition) &&
    accepted !== undefined &&
    validateRadarZone(definition, accepted) === undefined,
);
const blockedReason = $derived(controlWriteBlockReason(definition, entry, controlsForbidden));
const proposed = $derived(draft ? zoneValueFromDraft(draft, unitsMode) : undefined);
const validation = $derived(
  proposed ? validateRadarZone(definition, proposed) : 'No complete guard-zone value is available.',
);
const dirty = $derived(
  proposed !== undefined &&
    baselineSignature !== undefined &&
    radarZoneSignature(proposed) !== baselineSignature,
);
const distanceUnit = $derived(lengthUnit(unitsMode));
const distanceMax = $derived(
  definition.maxDistance === undefined
    ? 0
    : unitsMode === 'imperial'
      ? definition.maxDistance / METERS_PER_FOOT
      : definition.maxDistance,
);
const angleMin = $derived((definition.range?.min ?? 0) * RAD_TO_DEG);
const angleMax = $derived((definition.range?.max ?? 0) * RAD_TO_DEG);
const angleStep = $derived((definition.range?.step ?? 1 / RAD_TO_DEG) * RAD_TO_DEG);

function editState(): EditState {
  if (!editing) return 'idle';
  return dirty ? 'dirty' : 'editing';
}

function cancel(): void {
  editing = false;
  draft = undefined;
  baselineSignature = undefined;
  conflict = false;
  onEditStateChange(definition.id, 'idle');
}

function loadAccepted(): void {
  if (!accepted) return;
  draft = zoneDraftFromValue(accepted, unitsMode);
  baselineSignature = radarZoneSignature(accepted);
  conflict = false;
  editing = true;
  onEditStateChange(definition.id, 'editing');
}

function save(): void {
  if (!proposed || validation || blockedReason || conflict || pending) return;
  onSave(definition.id, proposed);
  cancel();
}

function structuredReadout(): string {
  if (!entry) return 'No current geometry was reported.';
  const fields = Object.entries(entry)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return fields.length > 0 ? fields.join(', ') : 'No current geometry was reported.';
}

function zoneSummary(): string {
  if (!accepted) return 'The provider has not reported a complete guard zone.';
  const start = Number((accepted.value * RAD_TO_DEG).toFixed(1));
  const end = Number((accepted.endValue * RAD_TO_DEG).toFixed(1));
  return `Zone ${accepted.enabled ? 'enabled' : 'disabled'}. ${start}° to ${end}°, ${formatLengthOr(accepted.startDistance, unitsMode)} to ${formatLengthOr(accepted.endDistance, unitsMode)} ${distanceUnit}.`;
}

$effect(() => {
  const nextIdentity = `${radarId ?? ''}\u0000${definition.id}\u0000${unitsMode}`;
  if (nextIdentity !== identity) {
    identity = nextIdentity;
    if (editing) cancel();
  }
});

$effect(() => {
  if (!editing || !accepted || !baselineSignature) return;
  if (radarZoneSignature(accepted) !== baselineSignature) conflict = true;
});

$effect(() => {
  if (editing) onEditStateChange(definition.id, editState());
});

onDestroy(() => {
  if (editing) onEditStateChange(definition.id, 'idle');
});
</script>

{#if supported}
  <p class="zone-summary">{zoneSummary()}</p>
  {#if editing && draft}
    <div class="zone-editor" role="group" aria-label={`${definition.name} editor`}>
      <UnitField
        label="Start angle"
        unit="°"
        value={draft.startDegrees}
        min={angleMin}
        max={angleMax}
        step={angleStep}
        disabled={pending}
        onCommit={(value) => (draft = draft ? { ...draft, startDegrees: value } : draft)}
      />
      <UnitField
        label="End angle"
        unit="°"
        value={draft.endDegrees}
        min={angleMin}
        max={angleMax}
        step={angleStep}
        disabled={pending}
        onCommit={(value) => (draft = draft ? { ...draft, endDegrees: value } : draft)}
      />
      <UnitField
        label="Inner distance"
        unit={distanceUnit}
        value={draft.innerDistance}
        min={0}
        max={distanceMax}
        step={unitsMode === 'imperial' ? 1 : 0.5}
        disabled={pending}
        onCommit={(value) => (draft = draft ? { ...draft, innerDistance: value } : draft)}
      />
      <UnitField
        label="Outer distance"
        unit={distanceUnit}
        value={draft.outerDistance}
        min={0}
        max={distanceMax}
        step={unitsMode === 'imperial' ? 1 : 0.5}
        disabled={pending}
        onCommit={(value) => (draft = draft ? { ...draft, outerDistance: value } : draft)}
      />
      <div class="enabled-row">
        <span class="field-label">Zone enabled</span>
        <div class="segmented" role="group" aria-label="Zone enabled">
          <button
            type="button"
            class="btn"
            class:is-on={!draft.enabled}
            aria-pressed={!draft.enabled}
            disabled={pending}
            onclick={() => (draft = draft ? { ...draft, enabled: false } : draft)}
          >
            Off
          </button>
          <button
            type="button"
            class="btn"
            class:is-on={draft.enabled}
            aria-pressed={draft.enabled}
            disabled={pending}
            onclick={() => (draft = draft ? { ...draft, enabled: true } : draft)}
          >
            On
          </button>
        </div>
      </div>
      {#if conflict}
        <p class="alert-note" role="alert">
          The radar changed this zone while you were editing. Reload its current geometry before
          saving.
        </p>
        <button type="button" class="btn btn-ghost" onclick={loadAccepted}>Reload current</button>
      {:else if validation}
        <p class="control-error" role="alert">{validation}</p>
      {:else if blockedReason}
        <p class="muted-note" role="status">{blockedReason} Your draft is preserved.</p>
      {/if}
      <div class="editor-actions">
        <button type="button" class="btn btn-ghost" onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={Boolean(validation || blockedReason || conflict || pending)}
          onclick={save}
        >
          Save zone
        </button>
      </div>
    </div>
  {:else}
    <button
      type="button"
      class="btn btn-ghost"
      disabled={Boolean(blockedReason || pending || anotherEditorActive)}
      title={blockedReason}
      onclick={loadAccepted}
    >
      Edit guard zone
    </button>
    {#if blockedReason}
      <p class="muted-note">{blockedReason}</p>
    {/if}
  {/if}
{:else}
  <p class="muted-note">
    {structuredReadout()}.
    {#if definition.type === 'sector'}
      Sector editing is unavailable because a sector can control radar transmission.
    {:else if definition.type === 'rect'}
      Rectangle editing is not supported for this provider shape.
    {:else if definition.type === 'zone'}
      This guard zone is read-only because the provider did not report a complete native shape and
      bounds.
    {:else}
      This provider-defined control is not supported for editing.
    {/if}
  </p>
{/if}

<style>
.zone-summary,
.control-error {
  margin: 0;
  font-size: var(--text-xs);
}
.zone-summary {
  color: var(--text-muted);
}
.control-error {
  color: var(--alarm);
}
.zone-editor {
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
.editor-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}
.editor-actions > .btn {
  min-inline-size: 7rem;
}
@media (max-width: 360px) {
  .enabled-row {
    align-items: stretch;
    flex-direction: column;
  }
  .editor-actions > .btn {
    flex: 1 1 7rem;
  }
}
</style>
