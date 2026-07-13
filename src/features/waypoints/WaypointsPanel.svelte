<script lang="ts">
import { Navigation, SquarePen, Trash2 } from '@lucide/svelte';
import type { Waypoint } from '$entities/waypoint';
import { formatLatitude, formatLongitude } from '$shared/lib';
import type { AuthController } from '$shared/signalk';
import { ArmedRow, InlineConfirm, SavedList, SlideOver } from '$shared/ui';
import type { WaypointLoadState } from './waypoint-controller.svelte';

interface Props {
  auth: AuthController;
  waypoints: Waypoint[];
  loadState: WaypointLoadState;
  busy: boolean;
  routeBusy: boolean;
  // Pan the chart to the waypoint without changing anything else.
  onLocate: (waypoint: Waypoint) => void;
  // Arm the Course API destination at this waypoint; the action renders only when provided.
  onGoTo?: (waypoint: Waypoint) => void;
  // Opens the edit dialog (name + icon) for this waypoint.
  onEdit: (waypoint: Waypoint) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  auth,
  waypoints,
  loadState,
  busy,
  routeBusy,
  onLocate,
  onGoTo,
  onEdit,
  onDelete,
  onClose,
  onBack,
}: Props = $props();

const writesDisabled = $derived(auth.writeBlocked || busy);
const navigationDisabled = $derived(writesDisabled || routeBusy);

// Deleting a waypoint is destructive, so it arms a confirm step rather than firing on a single
// tap where a mis-tap on a rolling deck would lose a saved mark.
const armedDelete = new ArmedRow((id) => {
  if (!writesDisabled) onDelete(id);
});

let confirmingNavigate = $state<Waypoint | undefined>();

function confirmNavigation(): void {
  const waypoint = confirmingNavigate;
  confirmingNavigate = undefined;
  if (!waypoint || navigationDisabled) return;
  onGoTo?.(waypoint);
}
</script>

<SlideOver title="Waypoints" closeLabel="Close waypoints panel" bodyFlex {onClose} {onBack}>
  {#if auth.writeBlocked}
    <p class="muted-note" role="alert">
      A write token is needed to add, edit, or delete waypoints. Request a read/write token to
      continue.
    </p>
  {/if}

  <p class="muted-note">Press and hold anywhere on the chart to drop a waypoint.</p>

  {#if loadState === 'error'}
    <p class="muted-note" role="alert">
      {waypoints.length > 0
        ? 'Could not refresh waypoints. Showing the last loaded waypoints.'
        : 'Could not load waypoints. Check the connection, then reopen this panel.'}
    </p>
  {:else if loadState === 'loading' && waypoints.length > 0}
    <p class="muted-note" role="status">Refreshing waypoints…</p>
  {/if}

  <SavedList
    heading="Saved waypoints"
    items={waypoints}
    empty={loadState === 'loading'
      ? 'Loading waypoints…'
      : loadState === 'error'
        ? 'Waypoints are unavailable.'
        : 'No waypoints yet. Press and hold the chart to drop one.'}
    key={(waypoint) => waypoint.id}
  >
    {#snippet card(waypoint)}
      <div class="card-head">
        <button
          type="button"
          class="name"
          title="Show this waypoint on the chart"
          onclick={() => onLocate(waypoint)}
        >
          {waypoint.name}
        </button>
      </div>
      <dl class="card-stats">
        <dt class="caps-label">Position</dt>
        <dd>
          <span class="num">
            {formatLatitude(waypoint.position.latitude)}
            {formatLongitude(waypoint.position.longitude)}
          </span>
        </dd>
      </dl>
      {#if waypoint.description}
        <p class="description">{waypoint.description}</p>
      {/if}
      {#if confirmingNavigate?.id === waypoint.id}
        <InlineConfirm
          question={`Start navigation to ${waypoint.name}? Check the destination before relying on it.`}
          confirmLabel="Start navigation"
          onConfirm={confirmNavigation}
          onCancel={() => (confirmingNavigate = undefined)}
        />
      {:else if armedDelete.isArmed(waypoint.id)}
        <InlineConfirm
          question="Delete this waypoint?"
          onConfirm={() => armedDelete.confirm(waypoint.id)}
          onCancel={() => armedDelete.cancel()}
        />
      {:else}
        <div class="actions">
          {#if onGoTo}
            <button
              type="button"
              class="icon-btn"
              aria-label="Navigate to waypoint"
              title="Start navigating to this waypoint"
              onclick={() => (confirmingNavigate = waypoint)}
              disabled={navigationDisabled}
            >
              <Navigation size={18} aria-hidden="true" />
            </button>
          {/if}
          <button
            type="button"
            class="icon-btn"
            aria-label="Edit waypoint"
            title="Edit"
            onclick={() => onEdit(waypoint)}
            disabled={writesDisabled}
          >
            <SquarePen size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Delete waypoint"
            title="Delete"
            onclick={() => armedDelete.arm(waypoint.id)}
            disabled={writesDisabled}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      {/if}
    {/snippet}
  </SavedList>
</SlideOver>

<style>
/* The card list, wrapper, stats, and actions come from the shared SavedList plus the global .saved
   system in app.css; only the optional description line is Waypoints-specific. */
.description {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
/* The tappable name is the locate action; the box, button reset, and the hover-to-accent
   interactivity come from the global .saved button.name rule. */
</style>
