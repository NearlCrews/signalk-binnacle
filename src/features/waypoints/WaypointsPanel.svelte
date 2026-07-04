<script lang="ts">
import { Navigation, SquarePen, Trash2 } from '@lucide/svelte';
import type { Waypoint } from '$entities/waypoint';
import { formatLatitude, formatLongitude } from '$shared/lib';
import { ArmedRow, InlineConfirm, SavedList, SlideOver } from '$shared/ui';

interface Props {
  waypoints: Waypoint[];
  // A transient error to show (a failed save, edit, or delete), or undefined when clear.
  error: string | undefined;
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

const { waypoints, error, onLocate, onGoTo, onEdit, onDelete, onClose, onBack }: Props = $props();

// Deleting a waypoint is destructive, so it arms a confirm step rather than firing on a single
// tap where a mis-tap on a rolling deck would lose a saved mark.
const armedDelete = new ArmedRow((id) => onDelete(id));
</script>

<SlideOver title="Waypoints" closeLabel="Close waypoints panel" bodyFlex {onClose} {onBack}>
  {#if error}
    <p class="alert-note" role="alert">{error}</p>
  {/if}

  <p class="muted-note">Press and hold anywhere on the chart to drop a waypoint.</p>

  <SavedList
    heading="Saved waypoints"
    items={waypoints}
    empty="No waypoints yet. Press and hold the chart to drop one."
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
      {#if armedDelete.isArmed(waypoint.id)}
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
              onclick={() => onGoTo(waypoint)}
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
          >
            <SquarePen size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Delete waypoint"
            title="Delete"
            onclick={() => armedDelete.arm(waypoint.id)}
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
