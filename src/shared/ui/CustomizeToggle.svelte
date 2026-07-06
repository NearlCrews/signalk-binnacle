<script lang="ts">
// The edit-mode entry (full recipe: design-system.md, Edit modes). The visible text IS the
// accessible name in both states, so no aria-pressed, is-on, or static aria-label.
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
