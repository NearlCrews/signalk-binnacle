<script module lang="ts">
const ENABLED_MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])';
const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function enabledMenuItems(surface: HTMLElement | undefined): HTMLElement[] {
  return surface ? [...surface.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR)] : [];
}

function focusMenuItem(items: HTMLElement[], index: number): void {
  for (const [itemIndex, item] of items.entries()) item.tabIndex = itemIndex === index ? 0 : -1;
  items[index]?.focus({ preventScroll: true });
}

export function initializeOverflowMenuFocus(surface: HTMLElement | undefined): void {
  const items = enabledMenuItems(surface);
  if (items.length > 0) focusMenuItem(items, 0);
}

export function handleOverflowMenuKeydown(
  event: KeyboardEvent,
  surface: HTMLElement | undefined,
  activeElement: Element | null = document.activeElement,
  onTab?: (reverse: boolean) => boolean,
): void {
  if (event.key === 'Tab' && onTab) {
    if (onTab(event.shiftKey)) event.preventDefault();
    return;
  }
  if (
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp' &&
    event.key !== 'Home' &&
    event.key !== 'End'
  )
    return;

  const items = enabledMenuItems(surface);
  if (items.length === 0) return;
  event.preventDefault();

  const current = items.indexOf(activeElement as HTMLElement);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  focusMenuItem(items, next);
}

export function overflowTabTarget(
  trigger: HTMLElement | undefined,
  surface: HTMLElement | undefined,
  reverse: boolean,
  candidates: readonly HTMLElement[],
): HTMLElement | undefined {
  if (!trigger) return undefined;
  if (reverse) return trigger;
  const outsideMenu = candidates.filter(
    (candidate) =>
      !surface?.contains(candidate) && !candidate.classList.contains('anchored-menu-backdrop'),
  );
  const triggerIndex = outsideMenu.indexOf(trigger);
  return triggerIndex < 0 ? trigger : outsideMenu[triggerIndex + 1];
}

export function restoreOverflowMenuFocus(
  requested: HTMLElement | undefined,
  trigger: HTMLElement | undefined,
  surface: HTMLElement | undefined,
  activeElement: Element | null = document.activeElement,
  body: HTMLElement = document.body,
): void {
  if (requested?.isConnected) {
    requested.focus({ preventScroll: true });
    return;
  }
  const focusWasLost =
    activeElement === null ||
    activeElement === body ||
    !activeElement.isConnected ||
    surface?.contains(activeElement) === true;
  if (focusWasLost && trigger?.isConnected) trigger.focus({ preventScroll: true });
}
</script>

<script lang="ts">
import { MoreHorizontal } from '@lucide/svelte';
import type { Snippet } from 'svelte';
import AnchoredMenu from './AnchoredMenu.svelte';

interface Props {
  open: boolean;
  label: string;
  onToggle: () => void;
  onClose: () => void;
  children: Snippet;
}

const { open, label, onToggle, onClose, children: content }: Props = $props();
let trigger = $state<HTMLButtonElement>();
let surface = $state<HTMLElement | undefined>();
let wasOpen = false;
let requestedCloseFocus: HTMLElement | null | undefined;

$effect(() => {
  if (open) {
    wasOpen = true;
    const frame = requestAnimationFrame(() => initializeOverflowMenuFocus(surface));
    return () => cancelAnimationFrame(frame);
  }
  if (!wasOpen) return;
  wasOpen = false;
  const target = requestedCloseFocus;
  requestedCloseFocus = undefined;
  if (target === null) return;
  const closingSurface = surface;
  const frame = requestAnimationFrame(() =>
    restoreOverflowMenuFocus(target, trigger, closingSurface),
  );
  return () => cancelAnimationFrame(frame);
});

function close(focusTarget: HTMLElement | null | undefined = trigger): void {
  requestedCloseFocus = focusTarget;
  onClose();
}

function handleKeydown(event: KeyboardEvent): void {
  handleOverflowMenuKeydown(event, surface, document.activeElement, (reverse) => {
    if (reverse) {
      close(trigger);
      return true;
    }
    const candidates = [...document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    const target = overflowTabTarget(trigger, surface, false, candidates);
    close(target ?? null);
    return target !== undefined;
  });
}

function handleClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const item = target.closest<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR);
  if (item && surface?.contains(item)) {
    // The action may mount and focus an editor or confirmation control. Do not request the trigger
    // explicitly here; the close effect restores it only when focus was actually lost.
    requestedCloseFocus = undefined;
    onClose();
  }
}
</script>

<div class="overflow-actions">
  <button
    type="button"
    class="icon-btn"
    aria-label={label}
    aria-expanded={open}
    aria-haspopup="menu"
    bind:this={trigger}
    onclick={onToggle}
  >
    <MoreHorizontal size={18} aria-hidden="true" />
  </button>
  <AnchoredMenu
    {open}
    onClose={close}
    backdropLabel={`Close ${label.toLowerCase()}`}
    surfaceClass="popover-card overflow-actions-menu"
    anchor={trigger}
    ariaLabel={label}
    role="menu"
    bind:surfaceRef={surface}
    onKeydown={handleKeydown}
    onClick={handleClick}
  >
    {@render content()}
  </AnchoredMenu>
</div>

<style>
.overflow-actions {
  position: relative;
}

:global(.overflow-actions-menu) {
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  inline-size: min(13rem, calc(100vw - 1rem));
  padding: var(--space-1);
  transform-origin: left var(--anchored-origin-y, top);
}

:global(.overflow-actions-menu .menu-item) {
  justify-content: flex-start;
  gap: var(--space-2);
  white-space: nowrap;
}
</style>
