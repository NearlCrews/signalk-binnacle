<script lang="ts">
import Ellipsis from '@lucide/svelte/icons/ellipsis';
import { onDestroy, onMount } from 'svelte';
import { createMediaQuery, Toast } from '$shared/lib';
import { AnchoredMenu, createMenuFocusMachine, TransientNote, UnavailableHint } from '$shared/ui';
import MenuItemCount from './MenuItemCount.svelte';
import MenuItemIcon from './MenuItemIcon.svelte';
import { blockedReason, itemBlocked, type MenuItem } from './menu-item';
import {
  barCapacity,
  MAX_BAR_PILLS,
  MAX_COMPACT_BAR_PILLS,
  splitBarActions,
} from './pinned-actions';

interface Props {
  actions: MenuItem[];
}

const { actions }: Props = $props();
const compactPhone = createMediaQuery('(max-width: 600px)');
// Below 480px the four default pills exceed the strip's width with labels on, so the pills go
// icon-only: the label collapses to visually-hidden, keeping the accessible name and the 44px
// target while all pinned actions stay one tap away.
const iconOnlyPills = createMediaQuery('(max-width: 480px)');
let moreOpen = $state(false);
let moreTrigger = $state<HTMLButtonElement>();
let moreSurface = $state<HTMLElement>();
let bar = $state<HTMLElement>();
let measuredCapacity = $state<number>();
let largeText = $state(false);

// The shared toolbar-menu focus machine: roving keydown, the Tab redirect, and the open-focus and
// close-focus protocol live in $shared/ui menu-focus, identical to OverflowActions. The extra
// focus frame lets the surface position itself before the initial roving focus lands.
const machine = createMenuFocusMachine({
  surface: () => moreSurface,
  trigger: () => moreTrigger,
  requestClose: () => {
    moreOpen = false;
  },
  focusFrames: 2,
});
const responsiveMaximum = $derived(compactPhone.matches ? MAX_COMPACT_BAR_PILLS : MAX_BAR_PILLS);
const capacity = $derived(Math.min(responsiveMaximum, measuredCapacity ?? responsiveMaximum));
const iconOnly = $derived(iconOnlyPills.matches || largeText);
const split = $derived(splitBarActions(actions, capacity));
const moreActive = $derived(split.overflow.some((action) => action.pressed === true));
const blockedNote = new Toast();
const NOTE_MS = 5_000;

onDestroy(() => blockedNote.dispose());

onMount(() => {
  const element = bar;
  if (!element) return;
  const measure = () => {
    const rootStyle = getComputedStyle(document.documentElement);
    const barStyle = getComputedStyle(element);
    const rootSize = Number.parseFloat(rootStyle.fontSize) || 16;
    const controlSize = Number.parseFloat(rootStyle.getPropertyValue('--control-size')) * rootSize;
    const gap = Number.parseFloat(barStyle.columnGap || barStyle.gap) || 0;
    largeText = rootSize >= 24;
    measuredCapacity = barCapacity(element.clientWidth, controlSize, gap, responsiveMaximum);
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  observer.observe(document.documentElement);
  measure();
  return () => observer.disconnect();
});

function run(action: MenuItem, after?: () => void): void {
  if (itemBlocked(action)) {
    blockedNote.show(blockedReason(action) ?? action.label, NOTE_MS);
    return;
  }
  try {
    action.onSelect();
  } finally {
    after?.();
  }
}

$effect(() => machine.syncOpen(moreOpen));
</script>

<div class="pinned-actions strip-center" bind:this={bar}>
  <TransientNote message={blockedNote.message} noteClass="blocked-pill-note" />
  {#each split.visible as action (action.id)}
    <button
      type="button"
      class="btn btn-pill"
      class:icon-only={iconOnly}
      class:is-on={action.pressed === true}
      aria-pressed={action.pressed === undefined ? undefined : action.pressed}
      disabled={action.disabled === true}
      aria-disabled={action.available === false ? true : undefined}
      title={blockedReason(action) ?? action.label}
      onclick={() => run(action)}
    >
      <UnavailableHint hint={action.available === false ? action.unavailableHint : undefined} />
      <MenuItemIcon item={action} size={16} />
      <span class:visually-hidden={iconOnly}>{action.shortLabel ?? action.label}</span>
      <MenuItemCount item={action} hideBadge={iconOnly} />
    </button>
  {/each}
  {#if split.overflow.length > 0}
    <div class="more-wrap">
      <button
        type="button"
        class="btn btn-pill"
        class:icon-only={iconOnly}
        bind:this={moreTrigger}
        class:is-on={moreActive || moreOpen}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-controls={moreOpen ? 'bar-more-menu' : undefined}
        aria-label={`More actions (${split.overflow.length})`}
        title="More actions"
        onclick={() => (moreOpen = !moreOpen)}
      >
        <Ellipsis size={16} aria-hidden="true" />
        <span class:visually-hidden={iconOnly}>More</span>
        {#if split.overflow.length > 1 && !iconOnly}
          <span class="pill-count" aria-hidden="true">{split.overflow.length}</span>
        {/if}
      </button>
      <AnchoredMenu
        open={moreOpen}
        onClose={() => machine.close()}
        backdropLabel="Close more actions"
        surfaceClass="popover-card menu-surface bar-more"
        ariaLabel="More actions"
        role="menu"
        id="bar-more-menu"
        anchor={moreTrigger}
        preferredPlacement="above"
        anchorAlign="end"
        bind:surfaceRef={moreSurface}
        onKeydown={machine.handleKeydown}
        onFocusLeft={() => machine.close()}
      >
        {#each split.overflow as action (action.id)}
          <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is menuitemcheckbox exactly when aria-checked is defined. -->
          <button
            type="button"
            role={action.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
            class="menu-item"
            class:is-on={action.pressed === true}
            aria-checked={action.pressed}
            disabled={action.disabled === true}
            aria-disabled={action.available === false ? true : undefined}
            title={blockedReason(action) ?? action.label}
            onclick={() => run(action, machine.close)}
          >
            <UnavailableHint
              hint={action.available === false ? action.unavailableHint : undefined}
            />
            <MenuItemIcon item={action} size={16} />
            {action.label}
            <MenuItemCount item={action} />
          </button>
        {/each}
      </AnchoredMenu>
    </div>
  {/if}
</div>

<style>
.pinned-actions {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  max-inline-size: calc(
    100vw -
    2 *
    var(--space-2) -
    env(safe-area-inset-left, 0px) -
    env(safe-area-inset-right, 0px)
  );
  min-inline-size: 0;
}
.btn-pill[aria-disabled="true"],
.menu-item[aria-disabled="true"] {
  opacity: var(--disabled-opacity);
  cursor: default;
}
@media (hover: hover) and (pointer: fine) {
  .btn-pill[aria-disabled="true"]:hover {
    border-color: var(--border);
    background: var(--surface-raised);
  }
  .menu-item[aria-disabled="true"]:hover {
    background: transparent;
  }
}
.more-wrap {
  position: relative;
}
:global(.blocked-pill-note) {
  inset-block-end: calc(100% + var(--space-1));
  max-inline-size: 16rem;
  font-size: var(--text-sm);
}
:global(.bar-more) {
  --menu-width: 12rem;
  transform-origin: right var(--anchored-origin-y, bottom);
  gap: var(--space-1);
  max-block-size: calc(100 * var(--dvh) - 1rem);
  overflow-y: auto;
}
@media (max-width: 600px) {
  .pinned-actions {
    flex-wrap: nowrap;
    gap: var(--space-1);
  }
}
@media (max-width: 480px) {
  .btn-pill {
    min-inline-size: var(--control-size);
    justify-content: center;
  }
}
.btn-pill.icon-only {
  min-inline-size: var(--control-size);
  justify-content: center;
}
</style>
