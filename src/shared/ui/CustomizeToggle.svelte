<script lang="ts">
// The edit-mode entry (full recipe: design-system.md, Edit modes). The visible text IS the
// accessible name in both states, so no aria-pressed, is-on, or static aria-label.
interface Props {
  object: string;
  editing: boolean;
  onToggle: () => void;
  // A panel header already names the object, so its constrained chrome may show the shorter
  // "Customize" label while preserving the full accessible name.
  compact?: boolean;
}

const { object, editing, onToggle, compact = false }: Props = $props();
const fullLabel = $derived(editing ? 'Done' : `Customize ${object}`);
const visibleLabel = $derived(!editing && compact ? 'Customize' : fullLabel);
</script>

<button
  type="button"
  class="btn btn-ghost"
  aria-label={compact ? fullLabel : undefined}
  onclick={onToggle}
>
  {visibleLabel}
</button>
