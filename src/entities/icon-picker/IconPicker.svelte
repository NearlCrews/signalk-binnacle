<script lang="ts">
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import {
  categoryLabel,
  POI_CATEGORIES,
  type PoiCategory,
  poiInlineIconSvg,
} from '$entities/poi-icons';
import type { SymbolsStore } from '$entities/symbols';
import { AnchoredMenu, isTabKey } from '$shared/ui';

// Optional "default" entry at the top of the list (e.g. "Default waypoint marker"). When provided,
// value='' selects it. If no override symbol exists for defaultOption.iconId, fallbackSvg renders.
export interface DefaultOption {
  iconId: string; // ID resolved via symbols.resolve(iconId, role) to detect an override
  label: string;
  // SVG string shown when there is no symbol override. It is injected via {@html}, so it MUST be a
  // static literal authored in this codebase, never external or extension-supplied input.
  fallbackSvg: string;
}

type IconOption =
  | { value: string; label: string; kind: 'default' }
  | { value: string; label: string; kind: 'poi'; category: PoiCategory }
  | { value: string; label: string; kind: 'symbol'; url: string };

interface Props {
  value: string;
  symbols?: SymbolsStore;
  // Symbol role used for both forRole() filtering and override resolution (e.g. 'waypoint', 'note').
  // Named symbolRole, not role, so it is not mistaken for the HTML ARIA role attribute.
  symbolRole: string;
  defaultOption?: DefaultOption;
  id?: string;
  disabled?: boolean;
}

let {
  value = $bindable(),
  symbols,
  symbolRole,
  defaultOption,
  id,
  disabled = false,
}: Props = $props();

// POI_CATEGORIES and categoryLabel are static, so this list never changes; a plain const computes
// it once instead of a $derived that would re-allocate in the reactive graph but never recompute.
const poiOptions: IconOption[] = POI_CATEGORIES.map((cat) => ({
  value: cat,
  label: categoryLabel(cat),
  kind: 'poi' as const,
  category: cat,
}));

const symbolOptions: IconOption[] = $derived(
  (symbols?.forRole(symbolRole) ?? []).flatMap((symbol) => {
    const reference = symbols?.pickerReference(symbol);
    return reference
      ? [
          {
            value: reference,
            label: symbol.name,
            kind: 'symbol' as const,
            url: symbol.url,
          },
        ]
      : [];
  }),
);

const options: IconOption[] = $derived([
  ...(defaultOption ? [{ value: '', label: defaultOption.label, kind: 'default' as const }] : []),
  ...poiOptions,
  ...symbolOptions,
]);

const selected: IconOption = $derived(options.find((o) => o.value === value) ?? options[0]);

// The default option and each POI category may have a binnacle: override in the symbols store;
// the same resolution path the overlay's managedIcon uses: symbols.resolve(bareId, role).
const defaultSymbol = $derived(
  defaultOption ? symbols?.resolve(defaultOption.iconId, symbolRole) : undefined,
);
const poiOverrides = $derived(
  new Map(
    POI_CATEGORIES.map((cat) => [cat, symbols?.resolve(cat, symbolRole)] as const)
      .filter(
        (entry): entry is [PoiCategory, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined,
      )
      .map(([cat, sym]) => [cat, sym.url] as const),
  ),
);

let isOpen = $state(false);
let triggerEl = $state<HTMLButtonElement>();
let typeahead = '';
let lastTypedAt = 0;
let surfaceRef = $state<HTMLElement>();

function optionElements(): HTMLElement[] {
  return [...(surfaceRef?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
}
function closeAndReturnFocus(): void {
  isOpen = false;
  triggerEl?.focus();
}

function select(v: string): void {
  if (disabled) return;
  value = v;
  closeAndReturnFocus();
}

function openAndFocus(): void {
  if (disabled) return;
  typeahead = '';
  isOpen = true;
}

function focusSelected(): void {
  const idx = options.findIndex((o) => o.value === value);
  const option = optionElements()[idx >= 0 ? idx : 0];
  const surface = surfaceRef;
  if (!option || !surface) return;
  // Scroll only the picker so a selected symbol stays visible without moving its editor.
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < surface.scrollTop) surface.scrollTop = top;
  else if (bottom > surface.scrollTop + surface.clientHeight) {
    surface.scrollTop = bottom - surface.clientHeight;
  }
  option.focus({ preventScroll: true });
}

function handleTriggerKey(e: KeyboardEvent): void {
  if (disabled) return;
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault();
    openAndFocus();
  }
}

// Arrow keys rove the options; ArrowUp from the first returns to the trigger (a combobox idiom the
// generic rovingFocus action does not model, so the nav stays bespoke here). Tab and Shift+Tab
// close the picker and restore focus to the trigger so focus cannot escape a nominally open
// listbox (WCAG 2.1.1). Escape is handled by the shared dismiss stack. Enter and Space activate
// the option natively as a button.
function handleOptionKey(e: KeyboardEvent, i: number): void {
  if (isTabKey(e)) {
    e.preventDefault();
    closeAndReturnFocus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    optionElements()[Math.min(i + 1, options.length - 1)]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (i === 0) {
      closeAndReturnFocus();
    } else {
      optionElements()[i - 1]?.focus();
    }
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    optionElements()[e.key === 'Home' ? 0 : options.length - 1]?.focus();
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
    e.preventDefault();
    const now = performance.now();
    typeahead = `${now - lastTypedAt > 700 ? '' : typeahead}${e.key.toLocaleLowerCase()}`;
    lastTypedAt = now;
    const query = [...typeahead].every((letter) => letter === typeahead[0])
      ? typeahead[0]
      : typeahead;
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (i + offset) % options.length;
      if (options[index].label.toLocaleLowerCase().startsWith(query)) {
        optionElements()[index]?.focus();
        break;
      }
    }
  }
}

// Offset into options[] where POI categories start (0 or 1 depending on defaultOption).
const poiStart = $derived(defaultOption ? 1 : 0);

$effect(() => {
  if (disabled) isOpen = false;
});
</script>

{#snippet iconGlyph(opt: IconOption)}
  {#if opt.kind === 'poi'}
    {#if poiOverrides.has(opt.category)}
      <img src={poiOverrides.get(opt.category)} width="20" height="20" alt="">
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- fixed local icon markup -->
      {@html poiInlineIconSvg(opt.category)}
    {/if}
  {:else if opt.kind === 'symbol'}
    <img src={opt.url} width="20" height="20" alt="">
  {:else if opt.kind === 'default'}
    {#if defaultSymbol}
      <img src={defaultSymbol.url} width="20" height="20" alt="">
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- caller contract requires fixed local SVG -->
      {@html defaultOption?.fallbackSvg ?? ''}
    {/if}
  {/if}
{/snippet}

<div class="icon-picker">
  <button
    type="button"
    class="picker-trigger"
    {id}
    bind:this={triggerEl}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    {disabled}
    onclick={() => {
      if (isOpen) isOpen = false;
      else openAndFocus();
    }}
    onkeydown={handleTriggerKey}
  >
    <span class="picker-icon"> {@render iconGlyph(selected)} </span>
    <span class="picker-label">{selected.label}</span>
    <ChevronDown class="picker-chevron" size={14} aria-hidden="true" />
  </button>

  <AnchoredMenu
    open={isOpen}
    onClose={closeAndReturnFocus}
    onFocusLeft={() => (isOpen = false)}
    onPositioned={focusSelected}
    bind:surfaceRef
    backdropLabel="Close icon choices"
    surfaceClass="picker-list popover-card"
    surfaceStyle={`inline-size: ${triggerEl?.clientWidth ?? 256}px;`}
    anchor={triggerEl}
    role="listbox"
    ariaLabel="Icon"
  >
    {#each options as opt, i (opt.value)}
      {#if i === poiStart}
        <div class="caps-label picker-group-label" aria-hidden="true">POI categories</div>
      {:else if i === poiStart + poiOptions.length && symbolOptions.length > 0}
        <div class="caps-label picker-group-label" aria-hidden="true">Custom symbols</div>
      {/if}
      <button
        type="button"
        role="option"
        class="row-interactive picker-option"
        aria-selected={value === opt.value}
        class:is-on={value === opt.value}
        tabindex={-1}
        onclick={() => select(opt.value)}
        onkeydown={(e) => handleOptionKey(e, i)}
      >
        <span class="picker-icon"> {@render iconGlyph(opt)} </span>
        <span>{opt.label}</span>
      </button>
    {/each}
  </AnchoredMenu>
</div>

<style>
.icon-picker {
  position: relative;
  inline-size: 100%;
}

.picker-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--control-size);
  padding: var(--space-2);
  font-size: var(--text-md);
  text-align: start;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text);
  cursor: pointer;
}

.picker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  inline-size: 1.375rem;
  block-size: 1.375rem;
}

.picker-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* :global because the class lands on the lucide ChevronDown's svg, a child component Svelte's scoped
   CSS cannot see; scoped under .picker-trigger so it does not leak. */
.picker-trigger :global(.picker-chevron) {
  flex-shrink: 0;
  color: var(--text-muted);
}

/* The floating frame is the shared .popover-card; only position, sizing, scroll, padding, and
   stacking stay scoped here. */
:global(.picker-list) {
  max-inline-size: calc(100vw - 2 * var(--space-2));
  max-block-size: min(16rem, calc(100 * var(--dvh) - 2 * var(--space-2)));
  overflow-y: auto;
  margin: 0;
  padding: var(--space-1) 0;
  z-index: var(--z-menu);
}

/* Option rows compose the shared .row-interactive primitive (hover tint, lit .is-on body, control
   height) so they are buttons that activate on Enter and Space, pick up the shared :focus-visible
   ring, and match the app's other interactive rows. Only the row's own layout stays scoped. */
.picker-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-md);
  text-align: start;
}

.picker-group-label {
  padding: var(--space-1) var(--space-3);
  border-block-start: 1px solid var(--border);
  margin-block-start: var(--space-1);
}

.picker-group-label:first-child {
  margin-block-start: 0;
  border-block-start: none;
}
</style>
