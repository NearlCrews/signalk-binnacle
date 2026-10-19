<script lang="ts">
import Info from '@lucide/svelte/icons/info';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import VolumeX from '@lucide/svelte/icons/volume-x';
import { tick, untrack } from 'svelte';
import { AnchoredMenu } from '$shared/ui';
import type { StatusNotice } from './status-notices';

interface Props {
  notices: StatusNotice[];
  connectionLabel: string;
  connectionTitle: string;
  // A safety alarm is taking the screen: the list must not cover its card.
  emergency?: boolean;
}

const { notices, connectionLabel, connectionTitle, emergency = false }: Props = $props();

const ICONS = { alert: TriangleAlert, mute: VolumeX, info: Info } as const;

let open = $state(false);
let cell = $state<HTMLButtonElement>();
let surface = $state<HTMLElement>();

const worst = $derived(notices[0]);
const others = $derived(notices.slice(1));
const toneClass = $derived(
  worst === undefined
    ? undefined
    : worst.tone === 'info'
      ? 'status-cell--info'
      : `data-cell--${worst.tone} status-cell--${worst.tone}`,
);

function close(restoreFocus: boolean): void {
  if (!open) return;
  open = false;
  if (restoreFocus) void tick().then(() => cell?.focus());
}

// An action that opens a panel hands the screen to it, so the list closes; one that fixes the
// problem in place (Enable, Reconnect, Unmute) leaves the list open on the result.
function act(action: Extract<NonNullable<StatusNotice['action']>, { kind: 'button' }>): void {
  action.run();
  if (action.opens) close(false);
}

function toggle(): void {
  if (open) close(false);
  else open = true;
}

function focusFirst(): void {
  const first = surface?.querySelector<HTMLElement>('.status-row .btn');
  if (first) {
    first.focus();
    return;
  }
  if (!surface) return;
  surface.tabIndex = -1;
  surface.focus();
}

// A polite announcement of each live notice as it newly appears, worst or not, and again when its
// words change (radar going from stale to failed keeps its id). A notice that leaves clears the
// region, so one that returns is announced again; a change of order alone says nothing. Notices
// already present when the bar mounts are not announced.
let announcement = $state('');
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping the effect reads untracked
const seen = new Set<string>();
let seeded = false;
let generation = 0;
$effect(() => {
  const live = notices.filter((notice) => notice.live);
  untrack(() => {
    const key = (notice: StatusNotice): string => `${notice.id}\n${notice.title}`;
    const present = new Set<string>(live.map(key));
    let left = false;
    for (const id of seen) {
      if (!present.has(id)) {
        seen.delete(id);
        left = true;
      }
    }
    const fresh = live.filter((notice) => !seen.has(key(notice)));
    for (const notice of fresh) seen.add(key(notice));
    if (!seeded) {
      seeded = true;
      return;
    }
    if (fresh.length === 0) {
      if (left) announcement = '';
      return;
    }
    const text = fresh.map((notice) => notice.title).join('. ');
    const run = ++generation;
    announcement = '';
    void tick().then(() => {
      if (run === generation) announcement = text;
    });
  });
});

// When an action clears its own row, focus moves to the row that took its place (or the list
// itself) instead of dropping to the page; when the last row goes, the list closes.
let focusedRow = -1;
let rowCount = 0;
$effect.pre(() => {
  void notices;
  untrack(() => {
    rowCount = surface?.querySelectorAll('.status-row').length ?? 0;
    const active = document.activeElement;
    const row = active instanceof HTMLElement ? active.closest('.status-row') : null;
    focusedRow =
      row && surface?.contains(row)
        ? [...surface.querySelectorAll('.status-row')].indexOf(row)
        : -1;
  });
});
$effect(() => {
  const count = notices.length;
  untrack(() => {
    if (!open) return;
    if (count === 0 && rowCount > 0) {
      close(true);
      return;
    }
    if (focusedRow < 0 || surface?.contains(document.activeElement)) return;
    const rows = [...(surface?.querySelectorAll<HTMLElement>('.status-row') ?? [])];
    const row = rows[Math.min(focusedRow, rows.length - 1)];
    const target = row?.querySelector<HTMLElement>('.btn');
    if (target) target.focus();
    else focusFirst();
  });
});

$effect(() => {
  if (emergency) untrack(() => close(false));
});
</script>

<span class="visually-hidden conn-live" role="status" aria-live="polite">{connectionLabel}</span>
<span class="visually-hidden notice-live" role="status" aria-live="polite">{announcement}</span>
<AnchoredMenu
  {open}
  onClose={() => close(true)}
  backdropLabel="Close status"
  anchor={cell}
  preferredPlacement="above"
  anchorAlign="start"
  role="dialog"
  ariaLabel="Status"
  id="status-list"
  surfaceClass="popover-card menu-surface status-list"
  bind:surfaceRef={surface}
  onPositioned={focusFirst}
  onFocusLeft={() => close(false)}
>
  {#if notices.length === 0}
    <p class="status-calm">{connectionTitle}</p>
  {:else}
    <ul class="bare-list status-rows">
      {#each notices as notice (notice.id)}
        {@const Icon = ICONS[notice.icon]}
        <li
          class="status-row status-row--{notice.tone}"
          class:subordinate={notice.subordinate === true}
        >
          <Icon size={16} aria-hidden="true" />
          <span class="status-row-text">
            <span class="status-row-title" id="status-row-{notice.id}">{notice.title}</span>
            {#if notice.detail}
              <span class="status-row-detail">{notice.detail}</span>
            {/if}
          </span>
          {#if notice.action?.kind === 'link'}
            <a class="btn" href={notice.action.href} aria-describedby="status-row-{notice.id}"
              >{notice.action.label}</a
            >
          {:else if notice.action?.kind === 'button'}
            {@const action = notice.action}
            <button
              type="button"
              class="btn"
              aria-describedby="status-row-{notice.id}"
              onclick={() => act(action)}
            >
              {notice.action.label}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</AnchoredMenu>
<button
  type="button"
  class="data-cell status-cell slot-status {toneClass ?? ''}"
  bind:this={cell}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls={open ? 'status-list' : undefined}
  title={worst?.title ?? connectionTitle}
  onclick={toggle}
>
  <span class="data-cell-label status-label">
    Status
    {#if others.length > 0}
      <!-- Neutral: the rest sort at or below the shown problem's grade, so the cell already carries
           the worst of them. -->
      <span class="badge badge--strong status-more">+{others.length}</span>
    {/if}
  </span>
  <span class="data-cell-value">
    {#if worst}
      <span class="word">{worst.word}</span>
    {:else}
      <span class="status-dot" aria-hidden="true"></span>
      <span class="word calm-word">All clear</span>
    {/if}
  </span>
  {#if others.length > 0}
    <span class="visually-hidden">, also {others.map((notice) => notice.word).join(', ')}</span>
  {/if}
</button>

<style>
/* The cell's grade is its text color, as every caution cell on the bar, plus a hairline ring in the
   same color: a tint fill would drop the text below AA in dusk. The word itself names the problem,
   so the grade never rests on color alone; the list rows carry the icons, which the narrowest
   column has no room for beside the label and the count. An inset ring changes no box, so the
   word budget holds. */
.status-cell {
  border-radius: var(--radius-md);
}
.status-cell--warning {
  box-shadow: inset 0 0 0 1px var(--warning);
}
.status-cell--alarm {
  box-shadow: inset 0 0 0 1px var(--alarm);
}
.status-cell--info,
.status-cell--info .word {
  color: var(--accent);
}
.status-label {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.status-more {
  margin-inline-start: auto;
  padding: 0 0.25rem;
  line-height: 1;
  letter-spacing: 0;
}
.status-cell .word {
  flex: 0 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calm-word {
  color: var(--text-muted);
}
.status-dot {
  align-self: center;
  inline-size: 0.6rem;
  block-size: 0.6rem;
  border-radius: 50%;
  background: var(--ok);
}
:global(.status-list) {
  --menu-width: 22rem;
  transform-origin: left var(--anchored-origin-y, bottom);
  max-block-size: calc(var(--room-above-bar) - var(--space-4));
  overflow-y: auto;
}
.status-calm {
  margin: 0;
  padding: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.status-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
  padding: var(--space-1) var(--space-2);
}
.status-row + .status-row {
  border-block-start: 1px solid var(--border);
}
.status-row--alarm > :global(svg) {
  color: var(--alarm);
}
.status-row--warning > :global(svg) {
  color: var(--warning);
}
.status-row--info > :global(svg) {
  color: var(--accent);
}
.status-row-text {
  display: grid;
  gap: 0.1rem;
}
.status-row-title {
  font-weight: 600;
}
.status-row--alarm .status-row-title {
  color: var(--alarm);
}
.status-row--warning .status-row-title {
  color: var(--warning);
}
.status-row-detail {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.subordinate,
.subordinate .status-row-title {
  color: var(--text-subordinate);
}
</style>
