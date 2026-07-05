<script lang="ts">
// The canonical edit-mode entry: a quiet ghost whose label swap to Done is the entire state
// story (no aria-pressed, no is-on, no static aria-label; the visible text IS the accessible
// name in both states). The label always names the object ("Customize toolbar"), even when the
// surface's title repeats it, so the control reads the same on every surface.
interface Props {
  object: string;
  editing: boolean;
  onToggle: () => void;
}

const { object, editing, onToggle }: Props = $props();
</script>

<button type="button" class="btn btn-ghost" onclick={onToggle}>
  {editing ? 'Done' : `Customize ${object}`}
</button>
