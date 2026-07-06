<script lang="ts">
import { ArrowLeft, ChevronDown, ChevronUp, X } from '@lucide/svelte';
import type { Snippet } from 'svelte';

// The panel-header triad shared by every docked panel: an optional accent back button, the heading
// (title plus optional subtitle), optional interleaved header content, an optional phone-only
// minimize control, and the close button. Every panel-shaped header renders through it so the
// back, title, and close chrome cannot drift apart between consumers.
interface Props {
  title: string;
  // A muted second heading line under the title, for panels whose subject needs a qualifier.
  subtitle?: string;
  closeLabel?: string;
  onClose: () => void;
  // When supplied, a leading back button returns to the menu instead of dismissing to the chart.
  onBack?: () => void;
  backLabel?: string;
  // Extra header content between the title and the close button (the instrument dock's
  // CustomizeToggle).
  headerExtra?: Snippet;
  // When supplied, a phone-only minimize control collapses the panel to its header. One object so the
  // collapsed state and its toggle always travel together.
  minimize?: { collapsed: boolean; onToggle: () => void };
  // Extra classes forwarded onto the header element, for a consumer that needs a denser variant.
  extraClass?: string;
}

const {
  title,
  subtitle,
  closeLabel = 'Close',
  onClose,
  onBack,
  backLabel = 'Back to menu',
  headerExtra,
  minimize,
  extraClass,
}: Props = $props();
</script>

<header
  class={extraClass ? `panel-header ${extraClass}` : 'panel-header'}
  class:panel-header--stacked={subtitle}
>
  {#if onBack}
    <button
      type="button"
      class="icon-btn icon-btn--accent"
      aria-label={backLabel}
      title={backLabel}
      onclick={onBack}
    >
      <ArrowLeft size={20} aria-hidden="true" />
    </button>
  {/if}
  <div class="heading">
    <h2 class="panel-title">{title}</h2>
    {#if subtitle}
      <span class="subtitle">{subtitle}</span>
    {/if}
  </div>
  {@render headerExtra?.()}
  {#if minimize}
    <button
      type="button"
      class="panel-minimize"
      aria-label={minimize.collapsed ? 'Expand panel' : 'Minimize panel'}
      aria-expanded={!minimize.collapsed}
      title={minimize.collapsed ? 'Expand panel' : 'Minimize panel'}
      onclick={minimize.onToggle}
    >
      {#if minimize.collapsed}
        <ChevronUp size={18} aria-hidden="true" />
      {:else}
        <ChevronDown size={18} aria-hidden="true" />
      {/if}
    </button>
  {/if}
  <button
    type="button"
    class="panel-close"
    aria-label={closeLabel}
    title={closeLabel}
    onclick={onClose}
  >
    <X size={18} aria-hidden="true" />
  </button>
</header>

<style>
.heading {
  flex: 1;
  min-inline-size: 0;
}
.subtitle {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
/* A two-line heading aligns to the top of the header instead of vertical center. */
.panel-header--stacked {
  align-items: flex-start;
}
</style>
