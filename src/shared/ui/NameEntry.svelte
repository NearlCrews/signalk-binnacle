<script lang="ts">
import { untrack } from 'svelte';
import { focusSelectOnMount } from './focus';

// An inline name form that replaces a native window.prompt: a labeled, themed text input with Save
// and Cancel, so naming a route, track, or profile reads like the rest of the app instead of an
// unstyled browser dialog. Enter saves, Escape cancels, and the seeded text starts selected so the
// navigator can type over the default name. The caller owns the trim and the default-name fallback.
interface Props {
  // The caps label above the input, doubling as the form's accessible name.
  label: string;
  // The initial text, typically a seeded default name. Starts selected for type-over.
  value?: string;
  confirmLabel?: string;
  maxLength?: number;
  // Typed as returning unknown because this form deliberately ignores the result: closing (or
  // keeping) the form is the caller's decision, so a caller that saves asynchronously can hold it
  // open with what the navigator typed until its write is accepted. Pair that with `busy`.
  onConfirm: (value: string) => unknown;
  onCancel: () => void;
  // A write is in flight: the controls are inert and the form announces itself as busy, so a second
  // submit cannot start another write against the same entry.
  busy?: boolean;
}

const {
  label,
  value = '',
  confirmLabel = 'Save',
  maxLength = 256,
  onConfirm,
  onCancel,
  busy = false,
}: Props = $props();

// Seed the editable text from the prop once: the form is freshly mounted per use, so it takes a
// snapshot of the default name rather than tracking the prop. untrack makes that one-time read
// explicit and keeps the compiler from flagging a missed reactive reference.
let text = $state(untrack(() => value));

function submit(event: SubmitEvent): void {
  event.preventDefault();
  if (busy) return;
  void onConfirm(text);
}
</script>

<form class="name-entry" aria-label={label} aria-busy={busy} onsubmit={submit}>
  <label class="name-entry-field">
    <span class="caps-label">{label}</span>
    <input
      class="input"
      type="text"
      maxlength={maxLength}
      disabled={busy}
      bind:value={text}
      use:focusSelectOnMount
      onkeydown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
  </label>
  <div class="panel-controls">
    <button type="submit" class="btn btn-primary" disabled={busy}>
      {busy ? 'Saving…' : confirmLabel}
    </button>
    <button type="button" class="btn" disabled={busy} onclick={onCancel}>Cancel</button>
  </div>
</form>

<style>
.name-entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.name-entry-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
