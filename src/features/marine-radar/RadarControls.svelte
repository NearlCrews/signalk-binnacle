<script lang="ts">
import Radar from '@lucide/svelte/icons/radar';
import {
  feetToMeters,
  formatDuration,
  formatLengthOr,
  lengthUnit,
  METERS_PER_FOOT,
  PLACEHOLDER,
  RAD_TO_DEG,
  type UnitsMode,
} from '$shared/lib';
import { Disclosure, InlineConfirm, ShowOnChartToggle } from '$shared/ui';
import type { MarineRadarStore } from './marine-radar-store.svelte';
import RadarAreaControl from './RadarAreaControl.svelte';
import {
  controlWriteBlockReason,
  isPowerControl,
  isPrimaryControl,
  widgetKind,
} from './radar-controls-model';
import type { ControlDefinition, RadarStatus, RadarStructuredValue } from './radar-types';

let {
  store,
  onSetControl,
  onSetAuto,
  onSetAreaControl,
  onSetAreaDraft,
  onStartAreaChartEdit,
  onStopAreaChartEdit,
  onSelectRadar,
  onSetPower,
  echoShown,
  onToggleEcho,
  onOpenOverlaySettings,
  unitsMode,
  discardRequested = false,
  onDraftDirtyChange,
  onDiscardResolved,
}: {
  store: MarineRadarStore;
  onSetControl: (controlId: string, value: number | string | boolean) => void;
  onSetAuto: (controlId: string, auto: boolean) => void;
  onSetAreaControl: (controlId: string, value: RadarStructuredValue) => void;
  onSetAreaDraft: (draft: import('./radar-types').RadarAreaDraft | undefined) => void;
  onStartAreaChartEdit: (controlId: string) => string | undefined;
  onStopAreaChartEdit: () => void;
  onSelectRadar?: (id: string) => void;
  onSetPower: (status: RadarStatus) => void;
  echoShown: boolean;
  onToggleEcho: (shown: boolean) => void;
  onOpenOverlaySettings?: () => void;
  unitsMode: UnitsMode;
  discardRequested?: boolean;
  onDraftDirtyChange?: (dirty: boolean) => void;
  onDiscardResolved?: (discarded: boolean) => void;
} = $props();

let confirmingTransmit = $state(false);
let activeEditorId = $state<string | undefined>(undefined);
let activeEditorDirty = $state(false);

const controls = $derived(
  [...store.capabilities].sort(
    (a, b) =>
      (a.category ?? '').localeCompare(b.category ?? '') ||
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  ),
);
// The everyday controls lead in their own section; everything else falls under Advanced. The power
// control is pulled out entirely: it drives the dedicated TX/Standby section below, never a generic
// widget. When the radar reports none of the primary ids the primary list is empty and the advanced
// section becomes the lone Controls section, so the panel never shows an empty heading.
const primary = $derived(controls.filter((def) => isPrimaryControl(def) && !isPowerControl(def)));
const advanced = $derived(controls.filter((def) => !isPrimaryControl(def) && !isPowerControl(def)));

// The stream connection state, deliberately worded as a LINK state ("Connected") so it is not confused
// with the radar's operational transmit state shown in the Power section below.
const statusLabel = $derived.by(() => {
  switch (store.status) {
    case 'connecting':
      return 'Connecting to the radar';
    case 'waiting':
      return 'Connected, waiting for spokes';
    case 'live':
      return 'Connected';
    case 'error':
      return 'Radar stream error';
    case 'stale':
      return 'Radar picture is stale';
    case 'paused':
      return operational === 'transmit' ? 'Radar picture paused' : 'Stream paused in standby';
    default:
      return '';
  }
});

// The radar's own operational state, distinct from the stream connection above. Drives the TX/Standby
// section and the power pill.
const operational = $derived(store.operationalStatus);
const operationalLabel = $derived.by(() => {
  switch (operational) {
    case 'transmit':
      return 'Transmitting';
    case 'standby':
      return 'Standby';
    case 'warming':
      return 'Warming up';
    case 'off':
      return 'Off';
    default:
      return 'Unknown';
  }
});
// Power buttons need write access and a present radar. Standby stays available during warm-up so the
// navigator can abort a warm-up; only Transmit waits out the transitional warming state.
const powerBusy = $derived(
  !store.hasRadar || store.controlsForbidden || store.pendingControls.power === true,
);
const transmitDisabled = $derived(powerBusy || operational === 'warming');
const isTransmitting = $derived(operational === 'transmit');

// The slider readout: the live value with its unit when the radar reports one, the shared placeholder
// until a value arrives. Radar API controls stay in SI and convert at this display boundary.
function displayNumber(def: ControlDefinition, value: number): number {
  if (def.range?.unit === 'rad') return value * RAD_TO_DEG;
  if (def.range?.unit === 'm' && unitsMode === 'imperial') return value / METERS_PER_FOOT;
  return value;
}

function siNumber(def: ControlDefinition, value: number): number {
  if (def.range?.unit === 'rad') return value / RAD_TO_DEG;
  if (def.range?.unit === 'm' && unitsMode === 'imperial') return feetToMeters(value);
  return value;
}

function displayUnit(def: ControlDefinition): string | undefined {
  if (def.range?.unit === 'rad') return '°';
  if (def.range?.unit === 'm') return lengthUnit(unitsMode);
  return def.range?.unit;
}

function displayBound(def: ControlDefinition, value: number): number {
  return displayNumber(def, value);
}

function enumOptionValue(value: number | string): string {
  return `${typeof value === 'number' ? 'number' : 'string'}:${String(value)}`;
}

function controlLabelId(def: ControlDefinition): string {
  const index = controls.findIndex((candidate) => candidate.id === def.id);
  return `radar-control-label-${index < 0 ? controls.length : index}`;
}

function readout(def: ControlDefinition): string {
  const value = store.controlValues[def.id];
  if (value === undefined) return PLACEHOLDER;
  if (typeof value !== 'number') return String(value);
  if (def.range?.unit === 's') return formatDuration(value);
  const unit = displayUnit(def);
  const shown =
    def.range?.unit === 'm'
      ? formatLengthOr(value, unitsMode)
      : Number(displayNumber(def, value).toFixed(def.range?.step && def.range.step < 1 ? 2 : 1));
  return unit ? `${shown} ${unit}` : String(shown);
}

// Whether a control reports an auto/manual capability, so it gets an Auto toggle, and whether that
// control is currently in auto, so its manual widget is disabled while the radar drives the value.
const hasAuto = (def: ControlDefinition): boolean => def.modes?.includes('auto') === true;
const isAuto = (def: ControlDefinition): boolean => store.controlAuto[def.id] === true;

function blockedReason(def: ControlDefinition): string | undefined {
  return controlWriteBlockReason(def, store.controlEntries[def.id], store.controlsForbidden);
}

// Pending never disables a scalar widget: the per-control write queue accepts a newer value while a
// request is in flight and coalesces unsent values to the newest snapshot, and the Applying status
// line reports the round trip. Structured area saves and the power segmented control keep their own
// pending gates.
function controlWriteDisabled(def: ControlDefinition): boolean {
  return blockedReason(def) !== undefined;
}

function controlDisabled(def: ControlDefinition): boolean {
  return controlWriteDisabled(def) || isAuto(def);
}

function onAreaEditState(controlId: string, state: 'idle' | 'editing' | 'dirty'): void {
  if (state === 'idle') {
    if (activeEditorId === controlId) activeEditorId = undefined;
  } else {
    activeEditorId = controlId;
  }
  activeEditorDirty = state === 'dirty';
  onDraftDirtyChange?.(activeEditorDirty);
  if (discardRequested && state === 'idle') onDiscardResolved?.(true);
}

function discardActiveDraft(): void {
  const controlId = activeEditorId;
  onStopAreaChartEdit();
  onSetAreaDraft(undefined);
  if (controlId) onAreaEditState(controlId, 'idle');
  onDiscardResolved?.(true);
}
</script>

<!-- One labeled control: the name (and, for a slider, the live value) on a head row, then a full-width
     control beneath, so sliders and selects line up in a single column rather than at ragged offsets.
     A read-only control (diagnostics, info) renders as a value readout, never an inert widget. The
     visible name is associated with the control via aria-labelledby across all widget kinds. -->
{#snippet control(def: ControlDefinition)}
  {@const kind = widgetKind(def)}
  {@const labelId = controlLabelId(def)}
  {@const value = store.controlValues[def.id]}
  {@const writeBlocked = blockedReason(def)}
  <div class="radar-field">
    <div class="field-head" title={def.description}>
      <span class="field-name" id={labelId}>{def.name}</span>
      <div class="field-head-end">
        {#if kind === 'slider' || def.readOnly || (kind === 'toggle' && value === undefined)}
          <span class="num field-value">{readout(def)}</span>
        {/if}
        {#if hasAuto(def) && !def.readOnly}
          <!-- An auto-capable control (gain, sea, rain): Auto hands the value to the radar and
               disables the manual widget; touching the widget returns it to manual. -->
          <button
            type="button"
            class="btn btn-compact auto-toggle"
            class:is-on={isAuto(def)}
            aria-pressed={isAuto(def)}
            aria-label={`Auto ${def.name}`}
            disabled={controlWriteDisabled(def)}
            onclick={() => onSetAuto(def.id, !isAuto(def))}
          >
            Auto
          </button>
        {/if}
      </div>
    </div>
    {#if def.readOnly && kind !== 'structured'}
    <!-- Nothing more: the readout above is the whole control. -->
    {:else if kind === 'slider'}
      <input
        type="range"
        class="range"
        class:is-unset={value === undefined}
        min={displayBound(def, def.range?.min ?? 0)}
        max={displayBound(def, def.range?.max ?? 100)}
        step={displayBound(def, def.range?.step ?? 1)}
        disabled={controlDisabled(def)}
        value={typeof value === 'number' ? displayNumber(def, value) : displayBound(def, def.range?.min ?? 0)}
        aria-labelledby={labelId}
        aria-valuetext={value === undefined ? 'No value reported' : readout(def)}
        onchange={(e) => onSetControl(def.id, siNumber(def, Number(e.currentTarget.value)))}
      >
    {:else if kind === 'toggle'}
      <div class="segmented" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          class="btn"
          class:is-on={value !== undefined && !value}
          aria-pressed={value !== undefined && !value}
          disabled={controlDisabled(def)}
          onclick={() => onSetControl(def.id, false)}
        >
          Off
        </button>
        <button
          type="button"
          class="btn"
          class:is-on={Boolean(value)}
          aria-pressed={Boolean(value)}
          disabled={controlDisabled(def)}
          onclick={() => onSetControl(def.id, true)}
        >
          On
        </button>
      </div>
    {:else if kind === 'list'}
      <select
        class="input"
        aria-labelledby={labelId}
        disabled={controlDisabled(def)}
        value={typeof value === 'number' || typeof value === 'string' ? enumOptionValue(value) : ''}
        onchange={(e) => {
          const raw = e.currentTarget.value;
          const option = def.values?.find((entry) => enumOptionValue(entry.value) === raw);
          if (option) onSetControl(def.id, option.value);
        }}
      >
        {#each def.values ?? [] as opt (enumOptionValue(opt.value))}
          <option value={enumOptionValue(opt.value)}>{opt.label}</option>
        {/each}
      </select>
    {:else if kind === 'text'}
      <input
        class="input"
        type="text"
        aria-labelledby={labelId}
        value={typeof value === 'string' ? value : ''}
        disabled={controlDisabled(def)}
        onchange={(e) => onSetControl(def.id, e.currentTarget.value)}
      >
    {:else if kind === 'button'}
      <button
        type="button"
        class="btn"
        disabled={controlDisabled(def)}
        onclick={() => onSetControl(def.id, true)}
      >
        {def.name}
      </button>
    {:else if kind === 'structured'}
      <RadarAreaControl
        definition={def}
        entry={store.controlEntries[def.id]}
        radarId={store.selectedId}
        {unitsMode}
        controlsForbidden={store.controlsForbidden}
        pending={store.pendingControls[def.id] === true}
        anotherEditorActive={activeEditorId !== undefined && activeEditorId !== def.id}
        areaDraft={store.areaDraft}
        onSave={onSetAreaControl}
        onDraftChange={onSetAreaDraft}
        onStartChartEdit={onStartAreaChartEdit}
        onStopChartEdit={onStopAreaChartEdit}
        onEditStateChange={onAreaEditState}
      />
    {/if}
    {#if writeBlocked && !def.readOnly && kind !== 'structured' && !store.controlsForbidden}
      <p class="muted-note">{writeBlocked}</p>
    {/if}
    {#if def.description}
      <p class="control-description">{def.description}</p>
    {/if}
    {#if store.pendingControls[def.id]}
      <p class="control-state" role="status">Applying…</p>
    {/if}
    {#if store.controlErrors[def.id]}
      <p class="control-error" role="alert">{store.controlErrors[def.id]}</p>
    {/if}
  </div>
{/snippet}

<p class="muted-note">Control your radar's power and tuning, and show its echo on the chart.</p>
<section class="panel-section" aria-label="Radar status">
  <h3 class="caps-label">Radar</h3>
  {#if store.selected}
    <p class="radar-identity">
      {store.selected.name}{store.selected.brand ? ` · ${store.selected.brand}` : ''}
    </p>
  {/if}
  {#if statusLabel}
    <p class="radar-head">
      <Radar size={18} aria-hidden="true" />
      <span
        class="radar-status"
        class:is-error={store.status === 'error'}
        role="status"
        aria-live="polite"
      >
        {statusLabel}
      </span>
    </p>
    {#if store.statusDetail}
      <p class="muted-note">{store.statusDetail}</p>
    {/if}
  {/if}
  {#if store.radars.length === 0}
    <p class="muted-note">
      {store.unavailableHint}
      {#if store.discoveryDetail}
        {store.discoveryDetail}
      {/if}
    </p>
  {/if}
  {#if store.radars.length > 1}
    <select
      class="input"
      aria-label="Select radar"
      value={store.selectedId}
      onchange={(e) => {
        const requestedId = e.currentTarget.value;
        e.currentTarget.value = store.selectedId ?? '';
        onSelectRadar?.(requestedId);
      }}
    >
      {#each store.radars as r (r.id)}
        <option value={r.id}>{r.name}</option>
      {/each}
    </select>
  {/if}
</section>

{#if discardRequested && activeEditorId}
  <InlineConfirm
    question="Discard unsaved radar-area changes?"
    confirmLabel="Discard"
    onConfirm={discardActiveDraft}
    onCancel={() => onDiscardResolved?.(false)}
  />
{/if}

{#if store.controlsForbidden}
  <p class="muted-note" role="status">
    Radar needs read-write access. Approve Binnacle for read and write in the Signal K server's
    access requests, then reconnect.
  </p>
{/if}
{#if store.rendererStatus === 'error' || store.rendererStatus === 'context-lost' || store.rendererStatus === 'blocked'}
  <p class="control-error" role="alert">
    Radar rendering is unavailable. {store.rendererDetail ?? 'Reload the chart to try again.'}
  </p>
{/if}

{#if store.hasRadar}
  <section class="panel-section" aria-label="Radar power">
    <h3 class="caps-label">Power</h3>
    <div class="field-head">
      <div class="segmented" role="group" aria-label="Transmit or standby">
        <button
          type="button"
          class="btn"
          class:is-on={operational === 'standby'}
          aria-pressed={operational === 'standby'}
          disabled={powerBusy}
          onclick={() => {
            confirmingTransmit = false;
            onSetPower('standby');
          }}
        >
          Standby
        </button>
        <button
          type="button"
          class="btn"
          class:is-on={operational === 'transmit'}
          aria-pressed={operational === 'transmit'}
          disabled={transmitDisabled}
          onclick={() => {
            if (operational !== 'transmit') confirmingTransmit = true;
          }}
        >
          Transmit
        </button>
      </div>
      <span
        class="power-status"
        class:is-transmitting={isTransmitting}
        role="status"
        aria-live="polite"
      >
        {operationalLabel}
      </span>
    </div>
    {#if confirmingTransmit}
      <InlineConfirm
        question="Start transmitting radar energy?"
        confirmLabel="Transmit"
        onConfirm={() => {
          confirmingTransmit = false;
          onSetPower('transmit');
        }}
        onCancel={() => (confirmingTransmit = false)}
      />
    {/if}
    <p class="muted-note">
      Standby keeps the radar powered but not emitting. Transmit scans and paints returns.
    </p>
    <ShowOnChartToggle
      visible={echoShown}
      label="Show echo on chart"
      description="The radar echo: the returns it paints from boats, land, and rain around you"
      onToggle={onToggleEcho}
    />
    {#if store.controlErrors.power}
      <p class="control-error" role="alert">{store.controlErrors.power}</p>
    {/if}
    <p class="muted-note">Opacity and stacking are in Overlays.</p>
    {#if onOpenOverlaySettings}
      <button type="button" class="btn btn-ghost" onclick={onOpenOverlaySettings}>
        Open overlay settings
      </button>
    {/if}
  </section>
{/if}

{#if primary.length > 0}
  <section class="panel-section" aria-label="Controls">
    <h3 class="caps-label">Controls</h3>
    {#each primary as def (def.id)}
      {@render control(def)}
    {/each}
  </section>
{/if}
{#if advanced.length > 0}
  {#if primary.length}
    <!-- With everyday controls present, the rest fold under an Advanced disclosure so the panel
         opens to the common controls. With no primary controls the radar reports only these, so they
         stand as the lone Controls section, never hidden behind a closed disclosure. -->
    <section class="panel-section" aria-label="Advanced controls">
      <Disclosure label="Advanced controls">
        {#each advanced as def (def.id)}
          {@render control(def)}
        {/each}
      </Disclosure>
    </section>
  {:else}
    <section class="panel-section" aria-label="Controls">
      <h3 class="caps-label">Controls</h3>
      {#each advanced as def (def.id)}
        {@render control(def)}
      {/each}
    </section>
  {/if}
{/if}

<style>
/* The titled sections use the shared .panel-section class in panels.css; only the field and segment
   layout inside them is scoped here. */
/* One control: the name (and the slider's live value) on a head row, then a full-width control beneath,
   so every slider track and select box shares one left and right edge. */
.radar-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.control-description,
.control-state,
.control-error,
.radar-identity {
  margin: 0;
  font-size: var(--text-xs);
}
.control-description,
.control-state,
.radar-identity {
  color: var(--text-muted);
}
.control-error {
  color: var(--alarm);
}
.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
/* The live value and the Auto toggle share the trailing end of the head row, so an auto-capable
   control reads as one labeled line: name on the left, value and Auto on the right. */
.field-head-end {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
/* The per-field label uses the sentence-case muted field style (like UnitField), not the .caps-label
   section vocabulary, so a column of field names does not read as a stack of headings. */
.field-name {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.field-value {
  font-size: var(--text-sm);
  color: var(--text);
}
.radar-field select.input {
  inline-size: 100%;
}
/* Every segmented in this panel (the On/Off field toggles and the Power control) fills its row with
   equal-width segments; one rule covers both since each lives inside a .panel-section. */
.panel-section .segmented {
  flex: 1;
}
.panel-section .segmented .btn {
  flex: 1;
}
/* Before any value has arrived the slider thumb parks at the minimum; dim it so it does not read as a
   real minimum while the value readout shows the unknown placeholder. */
.range.is-unset {
  opacity: var(--disabled-opacity);
}
/* The operational state is the panel's most safety-relevant readout (is the radar emitting), so it is
   larger than a field value and brightens when transmitting, distinguished by weight and brightness so
   it survives night-red where hue alone would not. */
.power-status {
  font-size: var(--text-base);
  color: var(--text-muted);
}
.power-status.is-transmitting {
  color: var(--accent);
  font-weight: 600;
}
/* The radar's identity row: the sweep glyph in the accent color paired with the live status. The
   glyph stays branded; the status text carries the muted or alarm state. */
.radar-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}
.radar-head :global(svg) {
  flex-shrink: 0;
  color: var(--accent);
}
.radar-status {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.radar-status.is-error {
  color: var(--alarm);
}
</style>
