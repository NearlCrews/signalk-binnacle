<script lang="ts">
import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
import Download from '@lucide/svelte/icons/download';
import Navigation from '@lucide/svelte/icons/navigation';
import Plus from '@lucide/svelte/icons/plus';
import Save from '@lucide/svelte/icons/save';
import Square from '@lucide/svelte/icons/square';
import SquarePen from '@lucide/svelte/icons/square-pen';
import Trash2 from '@lucide/svelte/icons/trash-2';
import Upload from '@lucide/svelte/icons/upload';
import X from '@lucide/svelte/icons/x';
import { type Route, type RouteHighlight, routeDistanceMeters } from '$entities/route';
import { formatNm } from '$shared/lib';
import type { PersistedValue } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import {
  ArmedRow,
  createPanelMinimize,
  defaultSaveName,
  InlineConfirm,
  NameEntry,
  OverflowActions,
  pickTextFile,
  readErrorMessage,
  resolveSaveName,
  SavedList,
  SlideOver,
  VisibilityToggle,
} from '$shared/ui';
import RouteEditPlan from './RouteEditPlan.svelte';
import type { RouteLoadState } from './route-controller.svelte';

interface Props {
  auth: AuthController;
  routes: Route[];
  shownIds: ReadonlySet<string>;
  // The route currently under edit on the chart, or undefined when not editing.
  working: Route | undefined;
  // The active (being navigated) route id, or undefined when none is active.
  activeId: string | undefined;
  refreshing: boolean;
  loadState: RouteLoadState;
  busy: boolean;
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
  onRetry: () => void;
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
  refreshing,
  loadState,
  busy,
  highlight,
  onHighlightLeg,
  error,
  editorLoadFailed,
  onRetryEditor,
  onRetry,
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

const writesDisabled = $derived(auth.writeBlocked || busy);

// Delete is destructive and, for the active route, also stops navigation, so it arms a confirm step
// rather than firing on a single tap where a mis-tap on a rolling deck would lose a saved route.
const armedDelete = new ArmedRow((id) => onDelete(id));
let confirmingActivateId = $state<string | undefined>();
let confirmingStopId = $state<string | undefined>();
let actionMenuId = $state<string | undefined>();

// One card confirmation at a time: a second question opening elsewhere in the list would leave two
// destructive answers on screen at once.
function requestActivation(id: string): void {
  confirmingStopId = undefined;
  confirmingActivateId = id;
}

function confirmActivation(): void {
  const id = confirmingActivateId;
  confirmingActivateId = undefined;
  if (id && !writesDisabled) onActivate(id);
}

// Stopping ends navigation for the whole boat, so it confirms in the card the way activation and
// deletion do rather than firing on a single tap.
function requestStop(id: string): void {
  actionMenuId = undefined;
  confirmingActivateId = undefined;
  confirmingStopId = id;
}

function confirmStop(): void {
  const id = confirmingStopId;
  confirmingStopId = undefined;
  if (id && !writesDisabled) onStop();
}

// Navigation can also be stopped from the nav strip or another station while this confirm is open;
// drop it then, so a stale question can never stop a route the boat is no longer navigating.
$effect(() => {
  if (confirmingStopId !== undefined && confirmingStopId !== activeId) confirmingStopId = undefined;
});

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

type ExitIntent = 'cancel' | 'close' | 'back';
let exitIntent = $state<ExitIntent | undefined>();

function finishExit(intent: ExitIntent): void {
  exitIntent = undefined;
  onCancelEdit();
  if (intent === 'close') onClose();
  else if (intent === 'back') onBack?.();
}

function requestExit(intent: ExitIntent): void {
  if (working && working.waypoints.length > 0) {
    exitIntent = intent;
    return;
  }
  finishExit(intent);
}

$effect(() => {
  if (!working) exitIntent = undefined;
});

// Precompute each route's formatted distance once per change rather than re-walking every route's
// waypoints on every panel render inside the each-block.
const savedCards = $derived(
  routes.map((route) => ({ route, distanceNm: formatNm(routeDistanceMeters(route.waypoints)) })),
);

// Minimize collapses the panel to its header on a phone, so the chart is usable while waypoints are
// tapped in. Expand it whenever an edit begins, so the edit controls are visible before the navigator
// chooses to minimize; the transition check keeps a minimize during editing from springing back open
// on the next waypoint.
const minimize = createPanelMinimize();
// A non-reactive edge sentinel, tracked by hand so the effect fires only on the false to true edit
// transition; deliberately not $state, so writing it does not re-trigger the effect.
let wasEditing = false;
$effect(() => {
  const editing = working !== undefined;
  if (editing && !wasEditing) minimize.expand();
  wasEditing = editing;
});
</script>

<SlideOver
  title="Routes"
  bodyFlex
  closeLabel="Close routes panel"
  {minimize}
  onClose={() => requestExit('close')}
  onBack={onBack ? () => requestExit('back') : undefined}
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
    <p class="muted-note" role="status">
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
      disabled={working !== undefined || writesDisabled}
    >
      <Plus size={16} aria-hidden="true" />
      New route
    </button>
    <button
      type="button"
      class="btn"
      title="Import routes from a GPX file (the standard route-exchange format) made by another chartplotter"
      onclick={importGpx}
      disabled={writesDisabled}
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
          value={working.name.trim() || defaultSaveName('Route')}
          onConfirm={confirmName}
          onCancel={() => (naming = false)}
        />
      {:else}
        <div class="panel-controls">
          <button
            type="button"
            class="btn btn-primary btn--grow"
            disabled={working.waypoints.length < 2 || writesDisabled}
            onclick={() => (naming = true)}
          >
            <Save size={16} aria-hidden="true" />
            Save
          </button>
          <button type="button" class="btn" onclick={() => requestExit('cancel')} disabled={busy}>
            <X size={16} aria-hidden="true" />
            Cancel
          </button>
        </div>
      {/if}
      {#if exitIntent}
        <InlineConfirm
          question="Discard unsaved route changes?"
          confirmLabel="Discard"
          onConfirm={() => finishExit(exitIntent ?? 'cancel')}
          onCancel={() => (exitIntent = undefined)}
        />
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

  {#if loadState === 'error'}
    <p class="alert-note" role="alert">
      {routes.length > 0
        ? 'Could not refresh routes. Showing the last loaded routes.'
        : 'Could not load routes. Check the connection, then retry.'}
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry routes</button>
  {:else if loadState === 'loading' && routes.length > 0}
    <p class="muted-note" role="status">Refreshing routes…</p>
  {/if}

  <SavedList
    heading="Saved routes"
    items={savedCards}
    empty={loadState === 'loading' || refreshing
      ? 'Loading routes…'
      : loadState === 'error'
        ? 'Routes are unavailable.'
        : 'No routes yet. Tap New route, then tap the chart to drop points along your path.'}
    key={({ route }) => route.id}
    isActive={({ route }) => route.id === activeId}
  >
    {#snippet card({ route, distanceNm })}
      <div class="card-head">
        <button
          type="button"
          class="name"
          title="Show the entire route on the chart"
          onclick={() => {
            onLocate(route.id);
            minimize.collapse();
          }}
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
      {#if confirmingActivateId === route.id}
        <InlineConfirm
          question={`Start navigation on ${route.name}? Check the route before relying on it.`}
          confirmLabel="Start navigation"
          onConfirm={confirmActivation}
          onCancel={() => (confirmingActivateId = undefined)}
        />
      {:else if confirmingStopId === route.id}
        <InlineConfirm
          question={`Stop navigating ${route.name}?`}
          confirmLabel="Stop navigation"
          onConfirm={confirmStop}
          onCancel={() => (confirmingStopId = undefined)}
        />
      {:else if armedDelete.isArmed(route.id)}
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
          {#if route.id === activeId}
            <button
              type="button"
              class="icon-btn icon-btn--accent"
              aria-label="Stop navigation"
              title="Stop navigation"
              disabled={writesDisabled}
              onclick={() => requestStop(route.id)}
            >
              <Square size={18} aria-hidden="true" />
            </button>
          {:else}
            <button
              type="button"
              class="icon-btn"
              aria-label="Start navigation on route"
              title="Start navigation on route"
              disabled={working !== undefined || writesDisabled}
              onclick={() => requestActivation(route.id)}
            >
              <Navigation size={18} aria-hidden="true" />
            </button>
          {/if}
          <OverflowActions
            open={actionMenuId === route.id}
            label={`More actions for ${route.name}`}
            onToggle={() => (actionMenuId = actionMenuId === route.id ? undefined : route.id)}
            onClose={() => (actionMenuId = undefined)}
          >
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              disabled={working !== undefined || writesDisabled}
              onclick={() => {
                actionMenuId = undefined;
                onEditRoute(route.id);
              }}
            >
              <SquarePen size={18} aria-hidden="true" />
              Edit route
            </button>
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              disabled={writesDisabled}
              onclick={() => {
                actionMenuId = undefined;
                onReverse(route.id);
              }}
            >
              <ArrowLeftRight size={18} aria-hidden="true" />
              Save reversed copy
            </button>
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              onclick={() => {
                actionMenuId = undefined;
                onExportGpx(route.id);
              }}
            >
              <Download size={18} aria-hidden="true" />
              Download GPX
            </button>
            <button
              type="button"
              role="menuitem"
              class="menu-item sev-danger"
              disabled={writesDisabled}
              onclick={() => {
                actionMenuId = undefined;
                armedDelete.arm(route.id);
              }}
            >
              <Trash2 size={18} aria-hidden="true" />
              Delete route
            </button>
          </OverflowActions>
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
