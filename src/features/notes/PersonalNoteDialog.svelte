<script lang="ts">
import { type DefaultOption, IconPicker } from '$entities/icon-picker';
import {
  categoryLabel,
  isPoiCategory,
  POI_CATEGORIES,
  type PoiCategory,
} from '$entities/poi-icons';
import type { SymbolsStore } from '$entities/symbols';
import type { AuthController } from '$shared/signalk';
import { dialog, TextField, UnitField } from '$shared/ui';
import {
  MAX_PERSONAL_NOTE_NAME_LENGTH,
  MAX_PERSONAL_NOTE_TEXT_LENGTH,
  type PersonalNoteInput,
} from './personal-note-contract';
import type { PersonalNotesCapability } from './personal-notes-client';
import type { PersonalNoteEditorState } from './personal-notes-controller.svelte';

interface Props {
  editor: PersonalNoteEditorState;
  symbols?: SymbolsStore;
  auth: AuthController;
  capability: PersonalNotesCapability;
  probing: boolean;
  busy: boolean;
  error?: string;
  onSave: (input: PersonalNoteInput) => void;
  onCancel: () => void;
  onProbe: () => void;
}

const {
  editor,
  symbols,
  auth,
  capability,
  probing,
  busy,
  error,
  onSave,
  onCancel,
  onProbe,
}: Props = $props();

const NOTE_DEFAULT: DefaultOption = {
  iconId: 'note',
  label: 'Use category marker',
  fallbackSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">' +
    '<path d="M5 3.5h9l3 3V18.5H5z" fill="var(--accent-fill)" stroke="var(--accent-contrast)" stroke-width="1.5"/>' +
    '<path d="M14 3.5v3h3" fill="none" stroke="var(--accent-contrast)" stroke-width="1.5"/>' +
    '</svg>',
};

// The dialog is keyed on the editor state at its mount site, so these deliberately seed once.
// svelte-ignore state_referenced_locally
const initial = editor.kind === 'edit' ? editor.note : undefined;
// svelte-ignore state_referenced_locally
const initialPosition = editor.kind === 'edit' ? editor.note.position : editor.position;
let noteName = $state(initial?.name ?? '');
let text = $state(initial?.description ?? '');
let category = $state<PoiCategory>(initial?.category ?? 'generic');
let symbol = $state(initial?.skIcon === initial?.category ? '' : (initial?.skIcon ?? ''));
let latitude = $state(initialPosition.latitude);
let longitude = $state(initialPosition.longitude);

const title = $derived(editor.kind === 'edit' ? 'Edit personal note' : 'Add personal note');
const saveBlocked = $derived(
  busy ||
    probing ||
    auth.writeBlocked ||
    capability === 'read-only-v1' ||
    capability === 'unavailable',
);

const capabilityMessage = $derived(
  capability === 'read-only-v1'
    ? 'This server exposes only the legacy read-only notes API. Enable a v2 notes provider to save personal notes.'
    : capability === 'unavailable'
      ? 'No Signal K notes provider is available. Enable Notes in the built-in Resources Provider, then check again.'
      : capability === 'error'
        ? 'Binnacle could not confirm the notes provider. You can keep editing and try Save, or check again.'
        : undefined,
);

function save(): void {
  if (saveBlocked) return;
  onSave({
    name: noteName,
    text,
    category,
    ...(symbol ? { symbol } : {}),
    position: { latitude, longitude },
  });
}

function chooseCategory(event: Event): void {
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (isPoiCategory(value)) category = value;
}
</script>

<dialog class="modal-card note-dialog" aria-label={title} use:dialog={onCancel}>
  <header><h2>{title}</h2></header>
  <div class="note-body">
    {#if auth.writeBlocked}
      <div class="muted-note" role="status">
        <p>
          Binnacle has read-only access. Your entries stay in this editor while access is requested.
        </p>
        <button
          type="button"
          class="btn btn-ghost"
          disabled={auth.upgrading}
          onclick={() => void auth.requestWriteAccess()}
        >
          {auth.upgrading ? 'Requesting access…' : 'Request read/write access'}
        </button>
      </div>
    {/if}
    {#if capabilityMessage}
      <div class="muted-note" role="status">
        <p>{capabilityMessage}</p>
        <button type="button" class="btn btn-ghost" disabled={probing} onclick={onProbe}>
          {probing ? 'Checking…' : 'Check provider'}
        </button>
      </div>
    {/if}
    {#if error}
      <p class="alert-note" role="alert">{error}</p>
    {/if}

    <TextField
      variant="stacked"
      large
      label="Name"
      value={noteName}
      placeholder="Personal note"
      disabled={busy}
      maxLength={MAX_PERSONAL_NOTE_NAME_LENGTH}
      focusOnOpen
      onInput={(value) => (noteName = value)}
      onCommit={(value) => (noteName = value)}
      onEnter={save}
    />

    <label class="note-field">
      <span>Text</span>
      <textarea
        class="input note-text"
        bind:value={text}
        maxlength={MAX_PERSONAL_NOTE_TEXT_LENGTH}
        disabled={busy}
        rows="5"
      ></textarea>
    </label>

    <label class="note-field">
      <span>Category</span>
      <select class="input" value={category} disabled={busy} onchange={chooseCategory}>
        {#each POI_CATEGORIES as option (option)}
          <option value={option}>{categoryLabel(option)}</option>
        {/each}
      </select>
    </label>

    <div class="note-field">
      <label for="personal-note-symbol">Symbol</label>
      <IconPicker
        id="personal-note-symbol"
        bind:value={symbol}
        {symbols}
        symbolRole="note"
        defaultOption={NOTE_DEFAULT}
        disabled={busy}
      />
    </div>

    <section class="position-fields" aria-labelledby="personal-note-position">
      <h3 id="personal-note-position" class="caps-label">Position</h3>
      <UnitField
        label="Latitude"
        unit="°"
        value={latitude}
        min={-90}
        max={90}
        step={0.000001}
        disabled={busy}
        onCommit={(value) => (latitude = Math.max(-90, Math.min(90, value)))}
      />
      <UnitField
        label="Longitude"
        unit="°"
        value={longitude}
        min={-180}
        max={180}
        step={0.000001}
        disabled={busy}
        onCommit={(value) => (longitude = Math.max(-180, Math.min(180, value)))}
      />
    </section>
  </div>
  <footer>
    <button type="button" class="btn" onclick={onCancel} disabled={busy}>Cancel</button>
    <button type="button" class="btn btn-primary btn-pill" onclick={save} disabled={saveBlocked}>
      {busy ? 'Saving…' : 'Save note'}
    </button>
  </footer>
</dialog>

<style>
.note-dialog {
  inline-size: min(25rem, calc(100dvw - 2 * var(--space-4)));
  max-block-size: calc(100dvh - 2 * var(--space-4));
}
.note-dialog header {
  padding: var(--space-3) var(--space-4);
  border-block-end: 1px solid var(--border);
}
.note-dialog h2 {
  margin: 0;
  font-size: var(--text-lg);
}
.note-body {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  overflow: auto;
}
.note-body p {
  margin: 0;
}
.note-field {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.note-text {
  min-block-size: calc(3 * var(--control-size));
  padding-block: var(--space-2);
  resize: vertical;
  color: var(--text);
}
.position-fields {
  display: grid;
  gap: var(--space-1);
}
.position-fields h3 {
  margin: 0;
}
.note-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-block-start: 1px solid var(--border);
}
</style>
