<script lang="ts">
import { type DefaultOption, IconPicker } from '$entities/icon-picker';
import { isPoiCategory } from '$entities/poi-icons';
import type { SymbolsStore } from '$entities/symbols';
import { MAX_WAYPOINT_NAME_LENGTH, type Waypoint } from '$entities/waypoint';
import { dialog, TextField } from '$shared/ui';

interface Props {
  // Required for add mode (new waypoint). In edit mode `waypoint` takes precedence for the initial
  // name, but defaultName still serves as the placeholder text.
  defaultName: string;
  // When set the dialog is in edit mode: name and icon are pre-populated from this waypoint.
  waypoint?: Waypoint;
  symbols?: SymbolsStore;
  busy?: boolean;
  onSave: (result: { name: string; icon?: string }) => void;
  onCancel: () => void;
}

const { defaultName, waypoint, symbols, busy = false, onSave, onCancel }: Props = $props();

const WAYPOINT_DEFAULT: DefaultOption = {
  iconId: 'waypoint',
  label: 'Default waypoint marker',
  fallbackSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="8" fill="var(--accent-fill)" stroke="var(--accent-contrast)" stroke-width="1.5"/>' +
    '</svg>',
};

// Convert a stored icon value back to the picker's selection value. Stored 'waypoint' and
// undefined both mean "use the default marker", which the picker represents as an empty string.
// A 'default:<cat>' value (explicit built-in with a custom override active) maps back to the bare
// category id so the picker shows the right POI row.
function pickerValueFromStoredIcon(icon: string | undefined): string {
  if (!icon || icon === 'waypoint') return '';
  if (icon.startsWith('default:')) return icon.slice('default:'.length);
  return icon;
}

// Determine the reference to persist. Bare POI category names save as unqualified so a future
// binnacle:<cat> override can take effect. If a provided symbol already overrides that built-in,
// save 'default:<cat>' to explicitly force the built-in. Empty string means the default marker.
function finalIconRef(selected: string): string {
  if (!selected) return 'waypoint';
  if (isPoiCategory(selected)) {
    const hasOverride = symbols?.resolve(selected, 'waypoint') !== undefined;
    return hasOverride ? `default:${selected}` : selected;
  }
  return selected;
}

// Seeded once from the waypoint prop. The dialog is keyed on the waypoint at its mount site, so it
// remounts (and reseeds) when a different waypoint is edited; the initial-value capture is intended.
// svelte-ignore state_referenced_locally
let wpName = $state(waypoint?.name ?? '');
// svelte-ignore state_referenced_locally
let icon = $state(pickerValueFromStoredIcon(waypoint?.icon));

function save(): void {
  if (busy) return;
  onSave({ name: wpName.trim() || defaultName, icon: finalIconRef(icon) });
}

const title = $derived(waypoint ? 'Edit waypoint' : 'Add waypoint');
</script>

<dialog class="modal-card wp-dialog" aria-label={title} use:dialog={onCancel}>
  <header><h2>{title}</h2></header>
  <div class="wp-body">
    <TextField
      variant="stacked"
      large
      label="Name"
      value={wpName}
      placeholder={waypoint?.name ?? defaultName}
      disabled={busy}
      maxLength={MAX_WAYPOINT_NAME_LENGTH}
      focusOnOpen
      onInput={(value) => (wpName = value)}
      onCommit={(value) => (wpName = value)}
      onEnter={save}
    />
    <div class="wp-field">
      <label class="caps-label" for="wp-icon-picker">Icon</label>
      <IconPicker
        id="wp-icon-picker"
        bind:value={icon}
        {symbols}
        symbolRole="waypoint"
        defaultOption={WAYPOINT_DEFAULT}
        disabled={busy}
      />
    </div>
  </div>
  <footer>
    <button type="button" class="btn" onclick={onCancel} disabled={busy}>Cancel</button>
    <button type="button" class="btn btn-primary btn-pill" onclick={save} disabled={busy}>
      {busy ? 'Saving…' : 'Save'}
    </button>
  </footer>
</dialog>

<style>
.wp-dialog {
  inline-size: min(22rem, calc(100dvw - 2 * var(--space-4)));
}
.wp-dialog header {
  padding: var(--space-3) var(--space-4);
  border-block-end: 1px solid var(--border);
}
.wp-dialog h2 {
  margin: 0;
  font-size: var(--text-lg);
}
.wp-body {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  overflow: visible;
}
.wp-field {
  display: grid;
  gap: var(--space-1);
}
.wp-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-block-start: 1px solid var(--border);
}
</style>
