<script lang="ts">
import Crosshair from '@lucide/svelte/icons/crosshair';
import ExternalLink from '@lucide/svelte/icons/external-link';
import SquarePen from '@lucide/svelte/icons/square-pen';
import Star from '@lucide/svelte/icons/star';
import Trash2 from '@lucide/svelte/icons/trash-2';
import { categoryLabel } from '$entities/poi-icons';
import { InlineConfirm, SlideOver } from '$shared/ui';
import type { NoteSelection } from './notes-client';
import type { NormalizedItem, NoteDetail } from './notes-detail';
import { safeHttpUrl } from './notes-detail';
import { isDangerFlag, isRedundantNoteLabel, orderSections } from './notes-present';

interface Props {
  selection: NoteSelection;
  load: (id: string) => Promise<NoteDetail | undefined>;
  onClose: () => void;
  onBack?: () => void;
  // Pan the chart to this place; the action renders only when the host wires it.
  onLocate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  writeBlocked?: boolean;
  busy?: boolean;
  mutationError?: string;
}

const {
  selection,
  load,
  onClose,
  onBack,
  onLocate,
  onEdit,
  onDelete,
  writeBlocked = false,
  busy = false,
  mutationError,
}: Props = $props();

let detail = $state<NoteDetail | undefined>();
let loading = $state(true);
let failed = $state(false);
let attempt = $state(0);
let confirmingDelete = $state(false);

// A new selection or a retry re-runs the load; the object identity changes either way.
const request = $derived({ id: selection.id, attempt });

$effect(() => {
  const { id } = request;
  let active = true;
  loading = true;
  failed = false;
  detail = undefined;
  load(id)
    .then((result) => {
      if (!active) return;
      if (result) detail = result;
      else failed = true;
      loading = false;
    })
    .catch(() => {
      if (!active) return;
      failed = true;
      loading = false;
    });
  return () => {
    active = false;
  };
});

const STARS = [1, 2, 3, 4, 5];

// Order sections by helm relevance: facts first, reviews and provenance last.
const sections = $derived(detail?.sections ? orderSections(detail.sections) : undefined);

const credit = $derived(detail?.attribution ?? selection.attribution);
const extraSources = $derived((detail?.sources ?? []).filter((s) => s !== credit));
const sourceUrl = $derived(safeHttpUrl(detail?.url ?? selection.url ?? ''));
const hasFooter = $derived(Boolean(credit || extraSources.length || sourceUrl));

function measure(item: NormalizedItem): string {
  return item.unit ? `${item.value} ${item.unit}` : String(item.value);
}
</script>

<SlideOver
  dock="right"
  title={selection.name}
  subtitle={categoryLabel(selection.category)}
  ariaLabel="Details for {selection.name}"
  closeLabel="Close place details"
  {onClose}
  {onBack}
  backLabel="Back to find places"
  footer={hasFooter ? footer : undefined}
  bodyFlex
>
  <div class="detail-actions">
    {#if onLocate}
      <button type="button" class="btn btn-ghost" onclick={onLocate}>
        <Crosshair size={16} aria-hidden="true" />
        Show on chart
      </button>
    {/if}
    {#if selection.ownedByBinnacle && onEdit}
      <button type="button" class="btn btn-ghost" onclick={onEdit} disabled={busy || writeBlocked}>
        <SquarePen size={16} aria-hidden="true" />
        Edit
      </button>
    {/if}
    {#if selection.ownedByBinnacle && onDelete && !confirmingDelete}
      <button
        type="button"
        class="btn btn-danger"
        onclick={() => (confirmingDelete = true)}
        disabled={busy || writeBlocked}
      >
        <Trash2 size={16} aria-hidden="true" />
        Delete
      </button>
    {/if}
  </div>
  {#if selection.ownedByBinnacle && writeBlocked}
    <p class="muted-note" role="status">
      A read/write token is needed to edit or delete this personal note.
    </p>
  {/if}
  {#if confirmingDelete && onDelete}
    <InlineConfirm
      question="Delete this personal note?"
      onConfirm={onDelete}
      onCancel={() => (confirmingDelete = false)}
    />
  {/if}
  {#if mutationError}
    <p class="alert-note" role="alert">{mutationError}</p>
  {/if}
  {#if loading}
    <p class="muted-note" role="status">Loading…</p>
  {:else if failed}
    <p class="alert-note" role="alert">Could not load the details for this place.</p>
    <button type="button" class="btn btn-ghost" onclick={() => (attempt += 1)}>Retry</button>
  {:else if sections}
    {#each sections as section (section.id)}
      {@const danger = section.items.find((item) => isDangerFlag(item.label, item.kind))}
      {@const listItems = section.items.filter((item) => !isDangerFlag(item.label, item.kind))}
      <section class="panel-section" aria-label={section.title}>
        <h3 class="caps-label">{section.title}</h3>
        <!-- The danger status always leads its section, rendered before the dl: a div between
             dt/dd pairs is non-conforming HTML. -->
        {#if danger}
          <div
            class="alert-note alert"
            class:alert-note--filled={danger.value === true}
            data-danger={danger.value === true}
          >
            {danger.value === true ? 'Dangerous to navigation' : 'Not a danger to navigation'}
          </div>
        {/if}
        <dl class="detail-list">
          {#each listItems as item, i (item.label + i)}
            {@const linkUrl =
              item.kind === 'link' && typeof item.value === 'string'
                ? safeHttpUrl(item.value)
                : undefined}
            {#if item.kind === 'note'}
              <div class="note-item">
                {#if !isRedundantNoteLabel(item.label, section.title)}
                  <dt>{item.label}</dt>
                {/if}
                <dd class="prose">{item.value}</dd>
              </div>
            {:else}
              <div class="item">
                <dt>{item.label}</dt>
                <dd>
                  {#if item.kind === 'availability'}
                    <span class="badge" data-value={String(item.value).toLowerCase()}
                      >{item.value}</span
                    >
                  {:else if item.kind === 'flag'}
                    <span class="badge" data-value={item.value === true ? 'yes' : 'no'}>
                      {item.value === true ? 'Yes' : 'No'}
                    </span>
                  {:else if linkUrl}
                    <a href={linkUrl} target="_blank" rel="noopener noreferrer"
                      >Open link<span class="visually-hidden"> (opens in a new tab)</span></a
                    >
                  {:else if item.kind === 'rating' && Number.isFinite(Number(item.value))}
                    {@const ratingValue = Number(item.value)}
                    {@const filled = Math.round(ratingValue)}
                    <span class="rating" role="img" aria-label={`Rating ${ratingValue} of 5`}>
                      {#each STARS as n (n)}
                        <Star
                          size={14}
                          fill={n <= filled ? 'currentColor' : 'none'}
                          aria-hidden="true"
                        />
                      {/each}
                    </span>
                  {:else if item.kind === 'measure'}
                    {measure(item)}
                  {:else}
                    {item.value}
                  {/if}
                </dd>
              </div>
            {/if}
          {/each}
        </dl>
      </section>
    {/each}
  {:else if detail?.fallbackText}
    <p class="prose">{detail.fallbackText}</p>
  {:else}
    <p class="muted-note" role="status">No extra detail for this place.</p>
  {/if}
</SlideOver>

{#snippet footer()}
  {#if credit}
    <span>{credit}</span>
  {/if}
  {#if extraSources.length > 0}
    <span>{extraSources.join(', ')}</span>
  {/if}
  {#if sourceUrl}
    <a class="source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
      View source <span class="visually-hidden">(opens in a new tab)</span>
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  {/if}
{/snippet}

<style>
.rating {
  display: inline-flex;
  color: var(--select);
}
/* The scroll box and the gapped column come from the shared .panel-body with bodyFlex; only the
   content spacing inside a section is local. */
/* The chart and ownership actions sit at the top as compact buttons, not stretched full width. */
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-self: flex-start;
}
/* dl, dt, dd, and .item come from the shared .detail-list utility in panels.css. */
/* A note carries prose, so it spans the full width below its label instead of being squeezed
   into the value column and right-aligned. */
.note-item {
  padding-block: 0.2rem;
}
.note-item dd {
  margin-block-start: 0.15rem;
  line-height: 1.4;
}
/* The hazard danger status leads its section as a full-width banner on the global .alert-note
   frame: when dangerous to navigation it adds the shared .alert-note--filled tint (matching the
   weather warning treatment), and when explicitly not a danger it drops to a quiet outline. */
.alert {
  margin-block: 0.2rem;
  padding: 0.4rem 0.55rem;
  color: var(--text);
  font-weight: 600;
}
.alert[data-danger="false"] {
  border-color: var(--border);
  color: var(--text-muted);
  font-weight: 400;
}
/* POI hazard badges intentionally use their own pill shape and the --select token so they stay
   in the night-red band. Do not unify with other badge vocabulary. */
.badge {
  padding: 0.05rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  background: var(--surface-raised);
  color: var(--text-muted);
}
.badge[data-value="yes"] {
  color: var(--accent);
  border-color: var(--accent);
}
.badge[data-value="nearby"] {
  color: var(--select);
  border-color: var(--select);
}
.prose {
  white-space: pre-line;
  text-align: start;
}
.source-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-block-size: var(--control-size);
  margin-inline-start: auto;
  color: var(--accent);
}
</style>
