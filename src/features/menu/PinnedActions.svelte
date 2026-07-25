<script module lang="ts">
const ENABLED_MORE_ITEM_SELECTOR =
  '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

function enabledMoreItems(surface: HTMLElement | undefined): HTMLElement[] {
  return surface ? [...surface.querySelectorAll<HTMLElement>(ENABLED_MORE_ITEM_SELECTOR)] : [];
}

function focusMoreItem(items: HTMLElement[], index: number): void {
  for (const [itemIndex, item] of items.entries()) item.tabIndex = itemIndex === index ? 0 : -1;
  items[index]?.focus({ preventScroll: true });
}

export function initializePinnedMenuFocus(surface: HTMLElement | undefined): void {
  const items = enabledMoreItems(surface);
  if (items.length > 0) focusMoreItem(items, 0);
}

export function handlePinnedMenuKeydown(
  event: KeyboardEvent,
  surface: HTMLElement | undefined,
  activeElement: Element | null = document.activeElement,
): void {
  if (
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp' &&
    event.key !== 'Home' &&
    event.key !== 'End'
  )
    return;

  const items = enabledMoreItems(surface);
  if (items.length === 0) return;
  event.preventDefault();

  const current = items.indexOf(activeElement as HTMLElement);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  focusMoreItem(items, next);
}

export function restorePinnedMenuFocus(
  trigger: HTMLElement | undefined,
  activeElement: Element | null = document.activeElement,
  body: HTMLElement = document.body,
): void {
  if (
    trigger?.isConnected &&
    (activeElement === null || activeElement === body || !activeElement.isConnected)
  ) {
    trigger.focus({ preventScroll: true });
  }
}
</script>

<script lang="ts">
import { Ellipsis } from '@lucide/svelte';
import { onDestroy, onMount } from 'svelte';
import { Toast } from '$shared/lib';
import { AnchoredMenu, UnavailableHint } from '$shared/ui';
import MenuItemIcon from './MenuItemIcon.svelte';
import { blockedReason, itemBlocked, type MenuItem } from './menu-item';
import { MAX_BAR_PILLS, splitBarActions } from './pinned-actions';

interface Props {
  actions: MenuItem[];
}

const { actions }: Props = $props();
let compactPhone = $state(false);
let moreOpen = $state(false);
let moreTrigger = $state<HTMLButtonElement>();
let moreSurface = $state<HTMLElement>();
let wasMoreOpen = false;
const split = $derived(splitBarActions(actions, compactPhone ? 2 : MAX_BAR_PILLS));
const moreActive = $derived(split.overflow.some((action) => action.pressed === true));
const blockedNote = new Toast();
const NOTE_MS = 5_000;

onDestroy(() => blockedNote.dispose());
onMount(() => {
  const query = window.matchMedia('(max-width: 600px)');
  const sync = (): void => {
    compactPhone = query.matches;
  };
  sync();
  query.addEventListener('change', sync);
  return () => query.removeEventListener('change', sync);
});

function closeMore(): void {
  moreOpen = false;
}

function handleMoreFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && moreSurface?.contains(next)) return;
  closeMore();
}

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

$effect(() => {
  if (moreOpen) {
    wasMoreOpen = true;
    let focusFrame = 0;
    const positionFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => initializePinnedMenuFocus(moreSurface));
    });
    return () => {
      cancelAnimationFrame(positionFrame);
      cancelAnimationFrame(focusFrame);
    };
  }
  if (!wasMoreOpen) return;
  wasMoreOpen = false;
  const frame = requestAnimationFrame(() => restorePinnedMenuFocus(moreTrigger));
  return () => cancelAnimationFrame(frame);
});
</script>

<div class="pinned-actions strip-center">
  {#if blockedNote.message}
    <p class="blocked-pill-note popover-card" role="status" aria-live="polite">
      {blockedNote.message}
    </p>
  {/if}
  {#each split.visible as action (action.id)}
    <button
      type="button"
      class="btn btn-pill"
      class:is-on={action.pressed === true}
      aria-pressed={action.pressed === undefined ? undefined : action.pressed}
      disabled={action.disabled === true}
      aria-disabled={action.available === false ? true : undefined}
      title={blockedReason(action) ?? action.label}
      onclick={() => run(action)}
    >
      <UnavailableHint hint={action.available === false ? action.unavailableHint : undefined} />
      <MenuItemIcon item={action} size={16} />
      {action.shortLabel ?? action.label}
    </button>
  {/each}
  {#if split.overflow.length > 0}
    <div class="more-wrap">
      <button
        type="button"
        class="btn btn-pill"
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
        More
        {#if split.overflow.length > 1}
          <span class="pill-count" aria-hidden="true">{split.overflow.length}</span>
        {/if}
      </button>
      <AnchoredMenu
        open={moreOpen}
        onClose={closeMore}
        backdropLabel="Close more actions"
        surfaceClass="popover-card bar-more"
        ariaLabel="More actions"
        role="menu"
        id="bar-more-menu"
        anchor={moreTrigger}
        preferredPlacement="above"
        anchorAlign="end"
        bind:surfaceRef={moreSurface}
        onKeydown={(event) => handlePinnedMenuKeydown(event, moreSurface)}
        onFocusOut={handleMoreFocusOut}
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
            onclick={() => run(action, closeMore)}
          >
            <UnavailableHint
              hint={action.available === false ? action.unavailableHint : undefined}
            />
            <MenuItemIcon item={action} size={16} />
            {action.label}
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
}
.btn-pill[aria-disabled="true"],
.menu-item[aria-disabled="true"] {
  opacity: var(--disabled-opacity);
  cursor: default;
}
.btn-pill[aria-disabled="true"]:hover {
  border-color: var(--border);
  background: var(--surface-raised);
}
.menu-item[aria-disabled="true"]:hover {
  background: transparent;
}
.more-wrap {
  position: relative;
}
.pill-count {
  font-size: var(--text-xs);
  background: var(--accent-tint);
  border-radius: var(--radius-pill);
  padding: 0 0.3rem;
  color: var(--accent);
}
.blocked-pill-note {
  position: absolute;
  inset-block-end: calc(100% + var(--space-1));
  inset-inline-start: 50%;
  transform: translateX(-50%);
  z-index: var(--z-menu);
  max-inline-size: 16rem;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  text-align: center;
}
:global(.bar-more) {
  transform-origin: right var(--anchored-origin-y, bottom);
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  inline-size: min(12rem, calc(100vw - 1rem));
  max-block-size: calc(100dvh - 1rem);
  overflow-y: auto;
  padding: var(--space-1);
}
@media (max-width: 600px) {
  .pinned-actions {
    flex-wrap: nowrap;
    gap: var(--space-1);
  }
}
</style>
