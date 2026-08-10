<script lang="ts">
import { onDestroy } from 'svelte';
import type { Route } from '$entities/route';
import { ConfirmArm } from '$shared/ui';

// The persistent route-edit mode strip: whenever a working route exists, the mode, its point
// count, the next step, and the exit actions stay visible, even when the Routes panel has been
// minimized or replaced by another panel. Route editing must never continue invisibly.
interface Props {
  working: Route;
  // Whether the Routes panel (the full editor) is currently open, so the strip offers a way back
  // to it instead of assuming it is on screen.
  editorOpen: boolean;
  onOpenEditor: () => void;
  // Save with the panel-owned naming flow when at least two points exist.
  onSave: () => void;
  canSave: boolean;
  onCancel: () => void;
}

const { working, editorOpen, onOpenEditor, onSave, canSave, onCancel }: Props = $props();

const count = $derived(working.waypoints.length);
const nextStep = $derived(
  count === 0 ? 'Tap the chart to place the first point.' : 'Tap the chart to add the next point.',
);

// Cancel discards the draft, so it arms a confirm step instead of firing on a single tap.
const cancelArm = new ConfirmArm();
onDestroy(() => cancelArm.disarm());

function tapCancel(): void {
  if (cancelArm.tap()) onCancel();
}
</script>

<aside class="bottom-strip bottom-strip--accent" aria-label="Route editing">
  <div class="head">
    <span class="title">Editing route</span>
    <span class="note" role="status">{count} {count === 1 ? 'point' : 'points'}. {nextStep}</span>
    <div class="actions">
      {#if !editorOpen}
        <button type="button" class="ack" onclick={onOpenEditor}>Open editor</button>
      {/if}
      <button type="button" class="ack" disabled={!canSave} onclick={onSave}>Save</button>
      <button type="button" class="ack ack--warning" onclick={tapCancel}>
        {cancelArm.armed ? 'Confirm cancel?' : 'Cancel'}
      </button>
    </div>
  </div>
</aside>
