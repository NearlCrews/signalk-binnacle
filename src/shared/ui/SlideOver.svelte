<script lang="ts">
import type { Snippet } from 'svelte';
import { fly } from 'svelte/transition';
import { prefersReducedMotion } from '$shared/lib';
import { dialog } from './dialog';
import { trapFocus } from './focus';
import PanelHeader from './PanelHeader.svelte';
import { PANEL_TRANSITION_MS } from './transitions';

// The panel slides in from the edge it docks to, with a zero duration when the system reduced-motion
// preference is set, so a helm with reduce-motion sees no movement.
const reduceMotion = prefersReducedMotion();

interface Props {
  // The panel heading, and the default accessible name for the panel landmark.
  title: string;
  // A muted second heading line under the title, for panels whose subject needs a qualifier.
  subtitle?: string;
  ariaLabel?: string;
  dock?: 'left' | 'right';
  // Lay the body out as a gapped column, for panels whose content is a stack of controls.
  bodyFlex?: boolean;
  // Trap Tab navigation when this panel is acting as a modal surface at its current breakpoint.
  focusTrap?: boolean;
  closeLabel?: string;
  onClose: () => void;
  // When supplied, a leading back button returns to the menu instead of dismissing to the chart, so
  // the navigator can move menu to panel to menu to another panel without reopening the hamburger.
  // Panels opened from the chart (the note detail) omit it, so no back arrow renders.
  onBack?: () => void;
  backLabel?: string;
  // Optional extra header content, between the title and the close button.
  headerExtra?: Snippet;
  // A pinned footer below the scrolling body, for panel-level actions or attribution.
  footer?: Snippet;
  // When supplied, a minimize control collapses the panel to just its header on a phone, so the panel
  // does not cover the chart (for example while tapping waypoints into a route). It is a no-op on a
  // desktop side panel, so the control only shows at phone widths. One object so the collapsed state
  // and its toggle are always supplied together.
  minimize?: { collapsed: boolean; onToggle: () => void };
  children: Snippet;
}

const {
  title,
  subtitle,
  ariaLabel,
  dock = 'left',
  bodyFlex = false,
  focusTrap = false,
  closeLabel = 'Close',
  onClose,
  onBack,
  backLabel = 'Back to menu',
  headerExtra,
  footer,
  minimize,
  children,
}: Props = $props();

// Two panels can be open at once (a note detail beside a docked panel), so the body id is generated
// per instance rather than fixed, and the header's minimize control points aria-controls at it.
const bodyId = $props.id();
const bodyClass = $derived(
  `panel-body${bodyFlex ? ' panel-body--flex' : ''}${minimize?.collapsed ? ' panel-body--collapsed' : ''}`,
);
</script>

<!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is always complementary or dialog, and aria-modal is present only for dialog. -->
<div
  class="slide-over slide-over--dock-{dock}"
  role={focusTrap ? 'dialog' : 'complementary'}
  aria-label={ariaLabel ?? title}
  aria-modal={focusTrap ? 'true' : undefined}
  tabindex="-1"
  use:dialog={onClose}
  use:trapFocus={focusTrap}
  transition:fly={{
    x: dock === 'right' ? 24 : -24,
    duration: reduceMotion ? 0 : PANEL_TRANSITION_MS,
    opacity: 0.3,
  }}
>
  <PanelHeader
    {title}
    {subtitle}
    {closeLabel}
    {onClose}
    {onBack}
    {backLabel}
    {headerExtra}
    {minimize}
    {bodyId}
  />
  <!-- Safari requires an independently scrollable region to be keyboard focusable. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Safari requires this scroll region in the tab order. -->
  <div id={bodyId} class={bodyClass} tabindex="0">
    {@render children()}
  </div>
  {#if footer}
    <footer class="panel-footer">
      {@render footer()}
    </footer>
  {/if}
</div>
