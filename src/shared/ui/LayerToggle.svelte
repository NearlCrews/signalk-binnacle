<script lang="ts">
import { resolveToggleDescription, type VisibilityToggleProps } from './visibility-toggle';

interface Props extends VisibilityToggleProps {
  title: string;
}

// disabled: a sub-layer toggle is disabled while its parent is off, so a facet cannot be enabled
// without the chart it annotates. description falls back to the visible title.
const { title, visible, onToggle, disabled = false, description, describedBy }: Props = $props();

const ownDescriptionId = $props.id();
const described = $derived(
  resolveToggleDescription({ description, describedBy }, ownDescriptionId),
);
</script>

<label class="layer-toggle" class:disabled>
  <!-- The accessible name comes from the wrapping label's visible title text, so the on-screen word
       and the spoken name match exactly (WCAG 2.5.3). The checkbox role and its state carry the rest. -->
  <input
    type="checkbox"
    checked={visible}
    {disabled}
    aria-describedby={described.describedBy}
    onchange={(e) => onToggle(e.currentTarget.checked)}
  >
  <span class="title" title={description ?? title}>{title}</span>
</label>
<!-- Outside the label: text inside it would join the checkbox's accessible name, which must stay the
     visible title alone. -->
{#if described.ownText}
  <span id={described.describedBy} class="visually-hidden">{described.ownText}</span>
{/if}

<style>
.layer-toggle {
  display: flex;
  flex: 1;
  min-inline-size: 0;
  align-items: center;
  gap: var(--space-2);
  /* The toggle runs at the dense list-row line; a primary row's full control-size height comes from the
     row container (.list-row, .row-main), so the toggle centers within it, and a nested facet child can
     run tighter still without the toggle forcing it back up to control-size. */
  min-block-size: var(--row-size);
  font-size: var(--text-md);
  cursor: pointer;
}
.layer-toggle.disabled {
  cursor: default;
  opacity: var(--disabled-opacity);
}
.layer-toggle input[type="checkbox"] {
  inline-size: var(--checkbox-size);
  block-size: var(--checkbox-size);
  /* Never let a long layer name shrink the box: the title ellipsizes, the checkbox stays square. */
  flex-shrink: 0;
}
.layer-toggle .title {
  min-inline-size: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
