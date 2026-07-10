<script lang="ts">
import {
  ArrowLeftRight,
  Download,
  Navigation,
  Plus,
  Save,
  Square,
  SquarePen,
  Trash2,
  Upload,
  X,
} from '@lucide/svelte';
import { type Route, type RouteHighlight, routeDistanceMeters } from '$entities/route';
import { formatNm } from '$shared/lib';
import type { PersistedValue } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import {
  ArmedRow,
  defaultSaveName,
  InlineConfirm,
  NameEntry,
  pickTextFile,
  readErrorMessage,
  resolveSaveName,
  SavedList,
  SlideOver,
  VisibilityToggle,
} from '$shared/ui';
import RouteEditPlan from './RouteEditPlan.svelte';

interface Props {
  auth: AuthController;
  routes: Route[];
  shownIds: ReadonlySet<string>;
  // The route currently under edit on the chart, or undefined when not editing.
  working: Route | undefined;
  // The active (being navigated) route id, or undefined when none is active.
  activeId: string | undefined;
  // Which leg or waypoint of the working route is cross-highlighted, so the matching rows light up.
  highlight: RouteHighlight | undefined;
  // Tap a leg row to highlight it on the chart, and pan the chart to it when it is off-screen.
  onHighlightLeg: (index: number) => void;
  // A transient error to show (a failed save, activate, stop, or delete), or undefined when clear.
  error: string | undefined;
  // True when error is specifically the route editor's lazy-load failure, so a Retry action shows;
  // other errors (a failed save, activate, stop, delete) have no editor to retry loading.
  editorLoadFailed: boolean;
  onRetryEditor: () => void;
  onNew: () => void;
  onEditRoute: (id: string) => void;
  // Called with the name the user enters; the panel collects it via the inline NameEntry form.
  onSave: (name: string) => void;
  onCancelEdit: () => void;
  onToggleShown: (id: string, shown: boolean) => void;
  // Pan the chart to a route's start without changing its shown state.
  onLocate: (id: string) => void;
  onActivate: (id: string) => void;
  onStop: () => void;
  // Save a reversed copy of the route, for the return leg.
  onReverse: (id: string) => void;
  // Download the route as a GPX file for another chartplotter.
  onExportGpx: (id: string) => void;
  // Import routes from the text of a GPX file the user picked.
  onImportGpx: (gpxText: string) => void;
  // The planning speed (knots), persisted, that turns leg distances into per-waypoint passage times.
  planningSpeed: PersistedValue<number>;
  onDelete: (id: string) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  auth,
  routes,
  shownIds,
  working,
  activeId,
  highlight,
  onHighlightLeg,
  error,
  editorLoadFailed,
  onRetryEditor,
  onNew,
  onEditRoute,
  onSave,
  onCancelEdit,
  onToggleShown,
  onLocate,
  onActivate,
  onStop,
  onReverse,
  onExportGpx,
  onImportGpx,
  planningSpeed,
  onDelete,
  onClose,
  onBack,
}: Props = $props();

// Delete is destructive and, for the active route, also stops navigation, so it arms a confirm step
// rather than firing on a single tap where a mis-tap on a rolling deck would lose a saved route.
const armedDelete = new ArmedRow((id) => onDelete(id));

// A failed file read must not look like a quiet cancel: surface it so the navigator knows the import
// did not happen, not just that nothing changed.
let importError = $state<string | undefined>();

async function importGpx(): Promise<void> {
  const picked = await pickTextFile('.gpx,application/gpx+xml');
  if (!picked.ok) {
    importError = readErrorMessage(picked);
    return;
  }
  importError = undefined;
  onImportGpx(picked.text);
}

// Saving a route names it inline through NameEntry rather than a native prompt.
let naming = $state(false);
function confirmName(value: string): void {
  onSave(resolveSaveName(value, 'Route'));
  naming = false;
}

// Precompute each route's formatted distance once per change rather than re-walking every route's
// waypoints on every panel render inside the each-block.
const savedCards = $derived(
  routes.map((route) => ({ route, distanceNm: formatNm(routeDistanceMeters(route.waypoints)) })),
);

// Minimize collapses the panel to its header on a phone, so the chart is usable while waypoints are
// tapped in. Expand it whenever an edit begins, so the edit controls are visible before the navigator
// chooses to minimize; the transition check keeps a minimize during editing from springing back open
// on the next waypoint.
let minimized = $state(false);
// A non-reactive edge sentinel, tracked by hand so the effect fires only on the false to true edit
// transition; deliberately not $state, so writing it does not re-trigger the effect.
let wasEditing = false;
$effect(() => {
  const editing = working !== undefined;
  if (editing && !wasEditing) minimized = false;
  wasEditing = editing;
});
</script>

<SlideOver
  title="Routes"
  bodyFlex
  closeLabel="Close routes panel"
  minimize={{ collapsed: minimized, onToggle: () => (minimized = !minimized) }}
  {onClose}
  {onBack}
>
  {#if error}
    <p class="alert-note" role="alert">
      {error}
      {#if editorLoadFailed}
        <button type="button" class="btn btn-ghost" onclick={onRetryEditor}>Retry</button>
      {/if}
    </p>
  {/if}
  {#if auth.writeBlocked}
    <p class="muted-note">
      A write token is needed to save, activate, or delete routes. Request a read/write token to
      continue.
    </p>
  {/if}

  <p class="muted-note">
    Plan a path by dropping points on the chart. Save it to navigate, reverse it for the trip home,
    or share it with another chartplotter.
  </p>
  <div class="panel-controls">
    <button
      type="button"
      class="btn btn-primary btn--grow"
      onclick={() => onNew()}
      disabled={working !== undefined}
    >
      <Plus size={16} aria-hidden="true" />
      New route
    </button>
    <button
      type="button"
      class="btn"
      title="Import routes from a GPX file (the standard route-exchange format) made by another chartplotter"
      onclick={importGpx}
    >
      <Upload size={16} aria-hidden="true" />
      Import
    </button>
  </div>

  {#if importError}
    <p class="alert-note" role="alert">{importError}</p>
  {/if}

  {#if working}
    <div class="editing" role="group" aria-label="Route under edit">
      {#if naming}
        <NameEntry
          label="Save route as"
          value={defaultSaveName('Route')}
          onConfirm={confirmName}
          onCancel={() => (naming = false)}
        />
      {:else}
        <div class="panel-controls">
          <button
            type="button"
            class="btn btn-primary btn--grow"
            disabled={working.waypoints.length < 2}
            onclick={() => (naming = true)}
          >
            <Save size={16} aria-hidden="true" />
            Save
          </button>
          <button type="button" class="btn" onclick={onCancelEdit}>
            <X size={16} aria-hidden="true" />
            Cancel
          </button>
        </div>
      {/if}
      {#if working.waypoints.length < 2}
        <p class="muted-note">Add at least two points to save this route.</p>
      {/if}
      <RouteEditPlan {working} {highlight} {onHighlightLeg} {planningSpeed} />
      <p class="muted-note">
        Tap the chart to add waypoints. Drag a point to move it, tap a midpoint to insert one.
      </p>
    </div>
  {/if}

  <SavedList
    heading="Saved routes"
    items={savedCards}
    empty="No routes yet. Tap New route, then tap the chart to drop points along your path."
    key={({ route }) => route.id}
    isActive={({ route }) => route.id === activeId}
  >
    {#snippet card({ route, distanceNm })}
      <div class="card-head">
        <button
          type="button"
          class="name"
          title="Show this route on the chart"
          onclick={() => onLocate(route.id)}
        >
          {route.name}
        </button>
        {#if route.id === activeId}
          <span class="badge">Active</span>
        {/if}
      </div>
      <dl class="card-stats">
        <dt class="caps-label">Distance</dt>
        <dd>
          <span class="num">{distanceNm}</span>
          nm
        </dd>
        <dt class="caps-label">Waypoints</dt>
        <dd><span class="num">{route.waypoints.length}</span></dd>
      </dl>
      {#if armedDelete.isArmed(route.id)}
        <InlineConfirm
          question={route.id === activeId
            ? 'Delete this route and stop navigating?'
            : 'Delete this route?'}
          onConfirm={() => armedDelete.confirm(route.id)}
          onCancel={() => armedDelete.cancel()}
        />
      {:else}
        <div class="actions">
          <VisibilityToggle
            visible={shownIds.has(route.id)}
            onToggle={(v) => onToggleShown(route.id, v)}
          />
          <button
            type="button"
            class="icon-btn"
            aria-label="Edit route"
            title="Edit"
            disabled={working !== undefined}
            onclick={() => onEditRoute(route.id)}
          >
            <SquarePen size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Reverse route"
            title="Save a reversed copy"
            onclick={() => onReverse(route.id)}
          >
            <ArrowLeftRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Download route as a GPX file"
            title="Download as a GPX file for another chartplotter"
            onclick={() => onExportGpx(route.id)}
          >
            <Download size={18} aria-hidden="true" />
          </button>
          {#if route.id === activeId}
            <button
              type="button"
              class="icon-btn icon-btn--accent"
              aria-label="Stop navigation"
              title="Stop navigation"
              onclick={onStop}
            >
              <Square size={18} aria-hidden="true" />
            </button>
          {:else}
            <button
              type="button"
              class="icon-btn"
              aria-label="Activate route"
              title="Activate route"
              disabled={working !== undefined}
              onclick={() => onActivate(route.id)}
            >
              <Navigation size={18} aria-hidden="true" />
            </button>
          {/if}
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Delete route"
            title="Delete"
            onclick={() => armedDelete.arm(route.id)}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      {/if}
    {/snippet}
  </SavedList>
</SlideOver>

<style>
.editing {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.6rem;
  border: 1px solid var(--accent);
  border-inline-start-width: var(--active-bar-width);
  border-radius: var(--radius-sm);
  background: var(--accent-tint);
  box-shadow: var(--shadow-overlay);
}
</style>
