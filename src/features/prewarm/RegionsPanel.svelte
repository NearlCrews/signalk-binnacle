<script lang="ts">
import {
  ChevronRight,
  Download,
  DownloadCloud,
  RefreshCw,
  SquareDashed,
  Trash2,
} from '@lucide/svelte';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { type Bbox, chartSourceById } from 'signalk-chart-sources';
import { onDestroy } from 'svelte';
import type { UnitsStore } from '$entities/units';
import {
  clampInt,
  feetToMeters,
  formatBytes,
  lengthUnit,
  metersToFeet,
  nauticalMilesToMeters,
} from '$shared/lib';
import type { AuthController } from '$shared/signalk';
import {
  ArmedRow,
  Disclosure,
  InlineConfirm,
  LayerToggle,
  SavedList,
  ShowOnChartToggle,
  SlideOver,
  TextField,
  UnitField,
} from '$shared/ui';
import { defaultSelection } from './area-defaults.js';
import { DETAIL_PRESETS, presetForRange, rangeForPreset } from './detail-level.js';
import {
  coveringSources,
  estimateBytes,
  exceedsRegionsFree,
  formatBySource,
  isTerminal,
  positionWarmSources,
  regionsFreeBytes,
} from './estimate.js';
import type { CacheStats, SavedRegionDto, WarmStatus } from './regions-client.js';
import { createRegionsClient } from './regions-client.js';
import type { RegionRectangle } from './regions-draw.js';
import { createRegionRectangle } from './regions-draw.js';
import { buildConfigPayload, extractPositionWarm } from './settings-payload.js';
import { coveringGroups, includedSummary, sourceDescription } from './source-summary.js';

interface Props {
  auth: AuthController;
  companionBase: string;
  map: MapLibreMap;
  units: UnitsStore;
  onClose: () => void;
  onBack?: () => void;
}

const { auth, companionBase, map, units, onClose, onBack }: Props = $props();

// The whole-world box stands in for "no box drawn" when enumerating covering sources.
const WORLD_BBOX: Bbox = [-180, -90, 180, 90];

// Region builder state. regions starts null to mean "loading"; loadError surfaces a failed initial
// load. stats follows the same null-is-loading, statsError-is-failed shape.
let stats = $state<CacheStats | null>(null);
let statsError = $state<string | null>(null);
let regions = $state<SavedRegionDto[] | null>(null);
let loadError = $state<string | null>(null);
let bbox = $state<Bbox | null>(null);
let selectedSources = $state<string[]>([]);
let minzoom = $state(6);
let maxzoom = $state(12);

// Which view of the feature is showing: the landing list, the area builder, the storage detail, or
// the auto-cache settings. Switching keeps all state in this one parent; only the template branches.
let subView = $state<'home' | 'build' | 'storage' | 'auto'>('home');
const subViewTitle = $derived(
  subView === 'build'
    ? 'Download an area'
    : subView === 'storage'
      ? 'Storage'
      : subView === 'auto'
        ? 'Auto-cache around the boat'
        : 'Offline areas',
);

// Name prep and submission state.
let namePrep = $state(false);
let regionName = $state('');
let submitting = $state(false);
let error = $state<string | null>(null);

// The latest warm snapshot per downloading region, for the determinate progress bar.
let regionStatus = $state<Record<string, WarmStatus>>({});
// Deleting a region arms an inline confirm first, keyed so only one row is armed at a time, like
// every other destructive per-row delete in the app.
const armedDelete = new ArmedRow((id) => void deleteRegion(id));
// A per-region busy flag so a re-download or delete on one card does not disable the others, and
// neither action can fire twice.
let pendingRegion = $state<Record<string, boolean>>({});

// The scroll cache TTL in days, seeded from stats.ttlDays on load. Zero means the age sweep is off.
let ttlDays = $state(30);
// Clearing the scroll cache arms an inline confirm first, like every destructive action in the app.
let confirmingClear = $state(false);
let clearNote = $state<string | null>(null);

// Internal references not read in the template: the draw controller, the per-region poll timers, and
// the consecutive poll-failure counts.
let rect: RegionRectangle | null = null;
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();
const pollFailures = new Map<string, number>();
// Generation counters so two in-flight loads cannot resolve out of order and clobber the newer value.
let regionsGen = 0;
let statsGen = 0;
// Stop a region's 2-second poller after this many consecutive failures, surfacing an error.
const POLL_FAIL_CAP = 5;

// positionWarmSources() is a pure function with no reactive deps, evaluated once. Used by the
// position-warm section, which is not box-scoped and never warms the basemap.
const positionWarmSourceList = positionWarmSources();

// Rebuild the client when the auth token changes so every call carries the current bearer token.
const client = $derived(createRegionsClient(companionBase, auth.token ?? undefined));

// Position-warm settings, loaded from getConfig on open, which seeds them from the server default
// (on, with no charts picked, so the panel prompts the navigator to choose). This false is only the
// pre-load value before the config arrives, replaced as soon as getConfig resolves.
let positionEnabled = $state(false);
let positionRadiusMeters = $state(nauticalMilesToMeters(2));
let positionMoveThresholdMeters = $state(nauticalMilesToMeters(1));
let positionIntervalSecs = $state(60); // server-side floor is 60 s
let positionBaseZoom = $state(12);
let positionSources = $state<string[]>([]);

// Length display unit follows the server unit preference, same as the anchor watch panel.
const mode = $derived(units.mode);
const unit = $derived(lengthUnit(mode));
// The length fields display feet in imperial and meters otherwise, storing SI meters; these two
// closures convert each way through the current mode so the radius and move fields share one rule.
function toDisplayLength(meters: number): number {
  return Math.round(mode === 'imperial' ? (metersToFeet(meters) ?? 0) : meters);
}
function fromDisplayLength(entered: number): number {
  return mode === 'imperial' ? (feetToMeters(entered) ?? entered) : entered;
}
const positionRadiusDisplay = $derived(toDisplayLength(positionRadiusMeters));
const positionMoveDisplay = $derived(toDisplayLength(positionMoveThresholdMeters));

// Only the sources that cover the current box show; a global source (no bounds) always covers a
// non-empty box, and the style basemap is already excluded.
const sourceList = $derived(coveringSources(bbox ?? WORLD_BBOX, [minzoom, maxzoom]));
// The selected ids as a Set for O(1) membership in the derived filters and the checklist rows.
const selectedSet = $derived(new Set(selectedSources));
const positionSet = $derived(new Set(positionSources));
// The selected ids restricted to what is currently shown, so a zoom change that drops a source from
// the list never carries a stale id into the estimate or the request.
const activeSourceIds = $derived(sourceList.filter((s) => selectedSet.has(s.id)).map((s) => s.id));
// The selected covering sources as objects, for the plain "what is included" sentence.
const selectedObjects = $derived(sourceList.filter((s) => selectedSet.has(s.id)));
const includedText = $derived(includedSummary(selectedObjects));
// The covering sources grouped by plain category for the Customize checklist (facets hidden).
const sourceGroups = $derived(coveringGroups(sourceList));
// The detail preset the current zoom range matches, or 'custom'.
const detailPreset = $derived(presetForRange(minzoom, maxzoom));

function applyDetailPreset(key: 'overview' | 'coastal' | 'harbor'): void {
  [minzoom, maxzoom] = rangeForPreset(key);
}

// The estimated download size, computed once and fed to both the size row and the gate so
// estimateBytes runs a single time per change rather than once here and again inside the gate.
const estimateVal = $derived(
  stats !== null && bbox !== null && activeSourceIds.length > 0
    ? estimateBytes(activeSourceIds, bbox, [minzoom, maxzoom], stats.perSourceAvgBytes)
    : 0,
);
const estimateFmt = $derived(formatBytes(estimateVal));

// Download is enabled only with a box drawn, at least one source picked, write access, storage that
// still holds the estimate, and no name prompt open. Mirrors canDownloadRegion (shared with its
// test) but reuses estimateVal rather than re-running the estimate.
const gate = $derived(
  stats !== null &&
    !namePrep &&
    bbox !== null &&
    activeSourceIds.length > 0 &&
    !auth.writeBlocked &&
    !exceedsRegionsFree(estimateVal, stats),
);
const regionsFreeFmt = $derived(stats !== null ? formatBytes(regionsFreeBytes(stats)) : null);
const pinnedFmt = $derived(stats !== null ? formatBytes(stats.pinnedBytes ?? 0) : null);
const scrollFmt = $derived(stats !== null ? formatBytes(stats.scrollBytes ?? 0) : null);
const usedFmt = $derived(stats !== null ? formatBytes(stats.bytes) : null);
const capFmt = $derived(stats !== null ? formatBytes(stats.cap) : null);

// Load the cache stats on mount and refresh when the auth token changes (the client rebuilds on a
// token change, so the effect re-runs with the new credentials). The generation guard inside
// loadStats drops a slow earlier response.
$effect(() => {
  void loadStats();
});

// Load the saved regions on mount, and resume polling any caught mid-download.
$effect(() => {
  void loadRegions();
});

// Wire up the panel-scoped Terra Draw rectangle instance. The prefixId 'chart-locker-region-draw'
// keeps it separate from the route editor's 'binnacle-route-draw' so the two never collide. A new box
// gets the smart default: the covering chart, seamarks, and the base map, with facets and specialist
// layers left off. The base map is on by default so the offline area is not a blank canvas.
$effect(() => {
  const r = createRegionRectangle(map);
  r.onChange((newBbox) => {
    bbox = newBbox;
    selectedSources =
      newBbox === null ? [] : defaultSelection(coveringSources(newBbox, [minzoom, maxzoom]));
    namePrep = false;
  });
  rect = r;
  return () => {
    r.destroy();
    rect = null;
  };
});

// Clear every poll timer on unmount.
onDestroy(() => {
  for (const timer of pollTimers.values()) clearInterval(timer);
  pollTimers.clear();
});

// Load the persisted position-warm settings on mount.
$effect(() => {
  let stale = false;
  void client
    .getConfig()
    .then((cfg) => {
      if (stale) return;
      const pw = extractPositionWarm(cfg);
      if (pw !== null) {
        positionEnabled = pw.enabled;
        positionRadiusMeters = pw.radiusMeters;
        positionMoveThresholdMeters = pw.moveThresholdMeters;
        positionIntervalSecs = pw.intervalSecs;
        positionBaseZoom = pw.baseZoom;
        positionSources = pw.sources;
      }
    })
    .catch(() => {});
  return () => {
    stale = true;
  };
});

async function savePositionWarm(): Promise<void> {
  if (auth.writeBlocked) return;
  try {
    await client.postConfig(
      buildConfigPayload({
        enabled: positionEnabled,
        radiusMeters: positionRadiusMeters,
        moveThresholdMeters: positionMoveThresholdMeters,
        intervalSecs: positionIntervalSecs,
        baseZoom: positionBaseZoom,
        sources: positionSources,
      }),
    );
  } catch {
    // Save is best-effort; the server enforces its own floor values.
  }
}

function commitPositionRadius(entered: number): void {
  positionRadiusMeters = Math.max(1, fromDisplayLength(entered));
  void savePositionWarm();
}

function commitMoveThreshold(entered: number): void {
  positionMoveThresholdMeters = Math.max(1, fromDisplayLength(entered));
  void savePositionWarm();
}

function commitTtlDays(entered: number): void {
  if (auth.writeBlocked) return;
  ttlDays = clampInt(entered, 0, 365);
  void client.setCacheConfig(ttlDays).catch(() => {});
}

async function clearScrollCache(): Promise<void> {
  if (auth.writeBlocked) return;
  confirmingClear = false;
  clearNote = null;
  try {
    const { freedBytes } = await client.clearScrollCache();
    const f = formatBytes(freedBytes);
    clearNote =
      freedBytes > 0
        ? `Freed ${f.value} ${f.unit} of recently viewed charts.`
        : 'Nothing to clear.';
    await loadStats();
  } catch {
    error = 'Could not clear the scroll cache.';
  }
}

// Load the saved regions with a generation guard so a slow earlier load cannot clobber a newer one.
// A failed first load (regions still null) surfaces loadError; a failed refresh keeps the list and
// surfaces a transient action error instead.
async function loadRegions(): Promise<void> {
  const gen = ++regionsGen;
  try {
    const list = await client.getRegions();
    if (gen !== regionsGen) return;
    regions = list;
    loadError = null;
    for (const region of list) {
      if (region.status === 'downloading') pollRegion(region.id);
    }
  } catch {
    if (gen !== regionsGen) return;
    if (regions === null)
      loadError = 'Could not load the saved regions. Check the connection and access.';
    else error = 'Could not refresh the saved regions.';
  }
}

// Load the cache stats with the same generation guard and loading-versus-failed split.
async function loadStats(): Promise<void> {
  const gen = ++statsGen;
  try {
    const s = await client.getCacheStats();
    if (gen !== statsGen) return;
    stats = s;
    if (typeof s.ttlDays === 'number') ttlDays = s.ttlDays;
    statsError = null;
  } catch {
    if (gen !== statsGen) return;
    if (stats === null) statsError = 'Could not load the cache stats.';
    else error = 'Could not refresh the cache stats.';
  }
}

function stopRegionPoll(id: string): void {
  const timer = pollTimers.get(id);
  if (timer !== undefined) {
    clearInterval(timer);
    pollTimers.delete(id);
  }
  pollFailures.delete(id);
}

// Poll a region's warm job to a terminal result. The plugin status route reconciles the persisted
// region status on each poll, so a reload after the terminal tick shows ready, capped, or error.
// A non-ok, non-404 status throws; after POLL_FAIL_CAP consecutive failures the poller stops and
// surfaces an error rather than spinning silently. The latest snapshot per region drives the bar.
function pollRegion(id: string): void {
  stopRegionPoll(id);
  pollFailures.set(id, 0);
  // Read the reactive client each tick, not a captured snapshot, so a token that rotates during a
  // long poll is picked up on the next request instead of the poll running on the stale bearer token
  // until it caps out on auth failures.
  const timer = setInterval(() => {
    void client
      .getRegionJobStatus(id)
      .then((s) => {
        pollFailures.set(id, 0);
        if (s !== null) regionStatus = { ...regionStatus, [id]: s };
        if (isTerminal(s)) {
          stopRegionPoll(id);
          void loadRegions();
          void loadStats();
        }
      })
      .catch(() => {
        const failures = (pollFailures.get(id) ?? 0) + 1;
        pollFailures.set(id, failures);
        if (failures >= POLL_FAIL_CAP) {
          stopRegionPoll(id);
          error = 'Lost contact with a region download. Check the connection and try again.';
        }
      });
  }, 2000);
  pollTimers.set(id, timer);
}

function centerOf(box: Bbox): { lat: number; lon: number } {
  return { lat: (box[1] + box[3]) / 2, lon: (box[0] + box[2]) / 2 };
}

function coordName(box: Bbox): string {
  const { lat, lon } = centerOf(box);
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

// The geocode lookup fires once here, on the Download action, never on rectangle drag, which is the
// rate control for the Nominatim usage policy. The name falls back to a coordinate string on failure.
async function prepareDownload(): Promise<void> {
  if (!gate || bbox === null || submitting) return;
  error = null;
  submitting = true;
  // Capture the box the lookup is for; a Clear or redraw during the await changes bbox, so the
  // result is stale and must not reopen the prompt or seed a name under the wrong box.
  const startedFor = bbox;
  const { lat, lon } = centerOf(bbox);
  const fallback = coordName(bbox);
  try {
    const name = await client.geocode(lat, lon);
    if (bbox === startedFor) regionName = name ?? fallback;
  } catch {
    if (bbox === startedFor) regionName = fallback;
  } finally {
    if (bbox === startedFor) namePrep = true;
    submitting = false;
  }
}

async function saveRegion(): Promise<void> {
  if (bbox === null || activeSourceIds.length === 0 || submitting) return;
  const name = regionName.trim() || coordName(bbox);
  error = null;
  submitting = true;
  try {
    const { region } = await client.postRegion({
      bbox,
      sourceIds: activeSourceIds,
      minzoom,
      maxzoom,
      name,
    });
    namePrep = false;
    regionName = '';
    // Return to the landing view so the new area's card and its live download progress are on
    // screen: the card and bar render only under the home sub-view, so staying on build would hide
    // the download the user just started.
    subView = 'home';
    await loadRegions();
    await loadStats();
    pollRegion(region.id);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Region download failed';
  } finally {
    submitting = false;
  }
}

function cancelNamePrep(): void {
  namePrep = false;
  regionName = '';
}

function setPending(id: string, busy: boolean): void {
  pendingRegion = { ...pendingRegion, [id]: busy };
}

async function redownloadRegion(id: string): Promise<void> {
  if (auth.writeBlocked || submitting || pendingRegion[id]) return;
  error = null;
  setPending(id, true);
  try {
    await client.redownloadRegion(id);
    await loadRegions();
    pollRegion(id);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Re-download failed';
  } finally {
    setPending(id, false);
  }
}

async function deleteRegion(id: string): Promise<void> {
  if (auth.writeBlocked || submitting || pendingRegion[id]) return;
  error = null;
  setPending(id, true);
  stopRegionPoll(id);
  try {
    await client.deleteRegion(id);
    await loadRegions();
    await loadStats();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Delete failed';
  } finally {
    setPending(id, false);
  }
}

// Add or remove an id from a selection list, returning a fresh array for the reactive assignment.
function toggleId(list: string[], id: string, on: boolean): string[] {
  return on ? [...list, id] : list.filter((x) => x !== id);
}

function toggleSource(id: string, on: boolean): void {
  selectedSources = toggleId(selectedSources, id, on);
}

// The plain status label and its severity coloring, keyed by region status. The sev-* classes live
// in text.css; an empty severity leaves the plain muted caps label, so a failed or capped region
// reads at a glance while a normal one stays quiet.
const STATUS_META: Record<SavedRegionDto['status'], { label: string; severity: string }> = {
  downloading: { label: 'Saving...', severity: '' },
  ready: { label: 'Saved, works offline', severity: '' },
  capped: { label: 'Storage full, some left out', severity: 'sev-warning' },
  error: { label: 'Could not finish', severity: 'sev-danger' },
  'needs-redownload': { label: 'Out of date, download again', severity: 'sev-warning' },
};

function updatedLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}

// The per-chart storage breakdown is keyed by source id. Resolve it to the plain registry title
// through the shared catalog lookup, collapse the synthetic base-map sub-source keys, and fall back
// to the id so an unknown key never shows blank.
function chartLabel(id: string): string {
  if (id.startsWith('style:') || id === '__basemap_assets__') return 'Base map';
  return chartSourceById(id)?.title ?? id;
}
</script>

<SlideOver
  title={subViewTitle}
  closeLabel="Close offline charts"
  {onClose}
  onBack={subView === 'home' ? onBack : () => (subView = 'home')}
  bodyFlex
>
  {#if error !== null}
    <p class="alert-note" role="alert">{error}</p>
  {/if}
  {#if auth.writeBlocked}
    <p class="muted-note">
      A write token is needed to download charts. Request a read/write token to continue.
    </p>
  {/if}

  {#if subView === 'home'}
    <p class="muted-note">Download chart areas so they work without internet at sea.</p>
    <div class="panel-controls">
      <button
        type="button"
        class="btn btn-primary btn--grow"
        disabled={auth.writeBlocked}
        onclick={() => (subView = 'build')}
      >
        <DownloadCloud size={16} aria-hidden="true" />
        Download an area
      </button>
    </div>

    <section class="panel-section" aria-label="My areas">
      <h3 class="caps-label">My areas</h3>
      {#if loadError !== null}
        <p class="alert-note" role="alert">{loadError}</p>
      {:else if regions === null}
        <p class="muted-note" role="status">Loading areas...</p>
      {:else}
        <SavedList
          items={regions}
          empty="No areas yet. Tap Download an area to save charts for offline."
          key={(region) => region.id}
        >
          {#snippet card(region)}
            {@const live = regionStatus[region.id]}
            {@const savedBytes =
              region.status === 'downloading' && live ? live.bytes : region.cachedBytes}
            {@const cached = formatBytes(savedBytes)}
            <div class="card-head">
              <span class="name" title={region.name}>{region.name}</span>
              <span class="caps-label {STATUS_META[region.status].severity}">
                {STATUS_META[region.status].label}
              </span>
            </div>
            <dl class="card-stats">
              <dt class="caps-label">Saved</dt>
              <dd><span class="num">{cached.value}</span> {cached.unit}</dd>
              {#if region.lastDownloadedAt !== null}
                <dt class="caps-label">Updated</dt>
                <dd><span class="num">{updatedLabel(region.lastDownloadedAt)}</span></dd>
              {/if}
            </dl>
            {#if region.status === 'downloading' && live && live.total > 0}
              {@const pct = Math.round((live.done / live.total) * 100)}
              <div
                class="warm-track"
                role="progressbar"
                aria-label="Download progress"
                aria-valuemin="0"
                aria-valuemax={live.total}
                aria-valuenow={live.done}
              >
                <div class="warm-fill" style:inline-size="{pct}%"></div>
              </div>
            {/if}
            {#if armedDelete.isArmed(region.id)}
              <InlineConfirm
                question="Delete this offline area?"
                onConfirm={() => armedDelete.confirm(region.id)}
                onCancel={() => armedDelete.cancel()}
              />
            {:else}
              <div class="actions">
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Download this area again"
                  title="Download again"
                  disabled={auth.writeBlocked ||
                    submitting ||
                    pendingRegion[region.id] ||
                    region.status === 'downloading'}
                  onclick={() => void redownloadRegion(region.id)}
                >
                  <RefreshCw size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="icon-btn icon-btn--danger"
                  aria-label="Delete this area"
                  title="Delete"
                  disabled={auth.writeBlocked || submitting || pendingRegion[region.id]}
                  onclick={() => armedDelete.arm(region.id)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            {/if}
          {/snippet}
        </SavedList>
      {/if}
    </section>

    <button type="button" class="subview-link row-interactive" onclick={() => (subView = 'auto')}>
      <span class="subview-link-label">Auto-cache around the boat</span>
      <span class="subview-link-value">{positionEnabled ? 'On' : 'Off'}</span>
      <ChevronRight class="subview-link-chevron" size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="subview-link row-interactive"
      onclick={() => (subView = 'storage')}
    >
      <span class="subview-link-label">Storage</span>
      <span class="subview-link-value">
        {usedFmt?.value ?? '--'} {usedFmt?.unit ?? ''} of {capFmt?.value ?? '--'}
        {capFmt?.unit ?? ''}
      </span>
      <ChevronRight class="subview-link-chevron" size={18} aria-hidden="true" />
    </button>
  {:else if subView === 'build'}
    <section class="panel-section" aria-label="Download an area">
      <h3 class="caps-label">Draw the area</h3>
      <div class="panel-controls">
        <button
          type="button"
          class="btn btn--grow"
          disabled={auth.writeBlocked}
          onclick={() => rect?.start()}
        >
          <SquareDashed size={16} aria-hidden="true" />
          Draw on the chart
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          disabled={bbox === null || auth.writeBlocked}
          onclick={() => rect?.clear()}
        >
          <Trash2 size={16} aria-hidden="true" />
          Clear
        </button>
      </div>
      {#if bbox !== null}
        <p class="muted-note">Area set. Draw again to change it.</p>
      {:else}
        <p class="muted-note">Tap Draw on the chart, then drag a box over where you are going.</p>
      {/if}

      <h3 class="caps-label">What's included</h3>
      <p class="muted-note">{includedText}</p>
      <Disclosure label="Customize what's included">
        <p class="muted-note">These are the chart layers that cover this area.</p>
        <p class="muted-note">
          You do not need to change anything: by default Binnacle saves every layer shown on your
          chart here.
        </p>
        <p class="muted-note">
          Unchecking a layer leaves it out, so it will not be available offline in this area. You
          can add it back and download again any time.
        </p>
        {#if bbox === null}
          <p class="muted-note">Draw an area first to see the chart layers that cover it.</p>
        {:else}
          {#each sourceGroups as group (group.category)}
            <h4 class="caps-label">{group.title}</h4>
            {#each group.sources as source (source.id)}
              <div class="list-row">
                <LayerToggle
                  title={source.id === 'basemap'
                    ? 'Base map: land, roads, and place names'
                    : source.title}
                  description={sourceDescription(source.id)}
                  visible={selectedSet.has(source.id)}
                  disabled={auth.writeBlocked}
                  onToggle={(on) => toggleSource(source.id, on)}
                />
              </div>
            {/each}
          {/each}
        {/if}
      </Disclosure>

      <h3 class="caps-label">Detail</h3>
      <div class="segmented" role="group" aria-label="Detail level">
        {#each DETAIL_PRESETS as preset (preset.key)}
          <button
            type="button"
            class="btn"
            class:is-on={detailPreset === preset.key}
            aria-pressed={detailPreset === preset.key}
            onclick={() => applyDetailPreset(preset.key)}
          >
            {preset.label}
          </button>
        {/each}
      </div>
      <Disclosure label="Advanced zoom">
        <UnitField
          label="Minimum zoom"
          value={minzoom}
          min={0}
          max={maxzoom}
          step={1}
          onCommit={(v) => {
            minzoom = clampInt(v, 0, maxzoom);
          }}
        />
        <UnitField
          label="Maximum zoom"
          value={maxzoom}
          min={minzoom}
          max={22}
          step={1}
          onCommit={(v) => {
            maxzoom = clampInt(v, minzoom, 22);
          }}
        />
      </Disclosure>

      {#if statsError !== null}
        <p class="alert-note" role="alert">{statsError}</p>
      {:else if stats === null}
        <p class="muted-note" role="status">Checking storage...</p>
      {:else}
        <dl class="stat-grid">
          <dt>Download size</dt>
          <dd>
            <span class="num">{estimateFmt.value}</span>
            <span class="unit">{estimateFmt.unit}</span>
          </dd>
          <dt>Space available</dt>
          <dd>
            <span class="num">{regionsFreeFmt?.value ?? '--'}</span>
            <span class="unit">{regionsFreeFmt?.unit ?? ''}</span>
          </dd>
        </dl>
        <p class="muted-note">
          This is a maximum. Empty water with no chart data is skipped and costs nothing. The base
          map's labels are a one-time shared download.
        </p>
      {/if}

      {#if namePrep}
        <TextField label="Area name" value={regionName} onCommit={(v) => (regionName = v)} />
        <div class="panel-controls">
          <button
            type="button"
            class="btn btn-primary btn--grow"
            disabled={submitting}
            onclick={() => void saveRegion()}
          >
            <Download size={16} aria-hidden="true" />
            Start download
          </button>
          <button type="button" class="btn btn-ghost" onclick={cancelNamePrep}>Cancel</button>
        </div>
      {:else}
        <div class="panel-controls">
          <button
            type="button"
            class="btn btn-primary btn--grow"
            disabled={!gate || submitting}
            onclick={() => void prepareDownload()}
          >
            <Download size={16} aria-hidden="true" />
            Download
          </button>
        </div>
        {#if !gate && bbox !== null && activeSourceIds.length === 0}
          <p class="muted-note">Pick at least one chart layer to download.</p>
        {/if}
      {/if}
      <p class="muted-note">Once saved, this area works on your device with no internet.</p>
    </section>
  {:else if subView === 'storage'}
    <section class="panel-section" aria-label="Storage">
      {#if stats !== null}
        <dl class="stat-grid">
          <dt>Storage used</dt>
          <dd>
            <span class="num">{usedFmt?.value ?? '--'}</span>
            <span class="unit"
              >{usedFmt?.unit ?? ''}
              of {capFmt?.value ?? '--'} {capFmt?.unit ?? ''}</span
            >
          </dd>
          <dt>Saved areas</dt>
          <dd>
            <span class="num">{pinnedFmt?.value ?? '--'}</span>
            <span class="unit">{pinnedFmt?.unit ?? ''}</span>
          </dd>
          <dt>Recently viewed</dt>
          <dd>
            <span class="num">{scrollFmt?.value ?? '--'}</span>
            <span class="unit">{scrollFmt?.unit ?? ''}</span>
          </dd>
        </dl>
        <Disclosure label="Recently viewed, by chart">
          <dl class="stat-grid">
            {#each formatBySource(stats) as row (row.source)}
              <dt>{chartLabel(row.source)}</dt>
              <dd><span class="num">{row.value}</span> <span class="unit">{row.unit}</span></dd>
            {/each}
          </dl>
        </Disclosure>
      {:else}
        <p class="muted-note" role="status">Loading storage...</p>
      {/if}
      <UnitField
        label="Auto-clear after"
        unit="days"
        value={ttlDays}
        min={0}
        max={365}
        step={1}
        onCommit={commitTtlDays}
      />
      {#if confirmingClear}
        <InlineConfirm
          question="Clear recently viewed charts? Your saved areas are kept."
          onConfirm={() => void clearScrollCache()}
          onCancel={() => (confirmingClear = false)}
        />
      {:else}
        <div class="panel-controls">
          <button
            type="button"
            class="btn btn-danger"
            disabled={auth.writeBlocked}
            onclick={() => (confirmingClear = true)}
          >
            <Trash2 size={16} aria-hidden="true" />
            Clear recently viewed
          </button>
        </div>
      {/if}
      {#if clearNote !== null}
        <p class="muted-note">{clearNote}</p>
      {/if}
    </section>
  {:else if subView === 'auto'}
    <section class="panel-section" aria-label="Auto-cache around the boat">
      <p class="muted-note">
        Caches the chart around the boat as it moves, so the area ahead is ready offline without
        downloading an area yourself.
      </p>
      <ShowOnChartToggle
        visible={positionEnabled}
        label="Enable auto-cache"
        description="Caches chart tiles around the boat as it moves, so the water ahead is ready offline."
        disabled={auth.writeBlocked}
        onToggle={(on) => {
          positionEnabled = on;
          void savePositionWarm();
        }}
      />
      {#if positionEnabled}
        <h4 class="caps-label">Charts to auto-cache</h4>
        <!-- Auto-cache with no chart picked saves nothing, so when it is on and the list is empty
             the user is prompted to choose at least one rather than leaving it silently doing
             nothing. -->
        {#if positionSources.length === 0 && positionWarmSourceList.length > 0}
          <p class="muted-note sev-warning" role="status">
            Auto-cache is on but no charts are picked, so nothing is being saved. Choose at least
            one chart below.
          </p>
        {/if}
        {#each positionWarmSourceList as source (source.id)}
          <div class="list-row">
            <LayerToggle
              title={source.title}
              description={sourceDescription(source.id)}
              visible={positionSet.has(source.id)}
              disabled={auth.writeBlocked}
              onToggle={(on) => {
                positionSources = toggleId(positionSources, source.id, on);
                void savePositionWarm();
              }}
            />
          </div>
        {/each}
        {#if positionWarmSourceList.length === 0}
          <p class="muted-note">No charts available to auto-cache.</p>
        {/if}
      {/if}
      <Disclosure label="Advanced">
        <UnitField
          label="How far around the boat"
          {unit}
          value={positionRadiusDisplay}
          min={1}
          step={1}
          disabled={!positionEnabled || auth.writeBlocked}
          onCommit={commitPositionRadius}
        />
        <UnitField
          label="Re-cache after moving"
          {unit}
          value={positionMoveDisplay}
          min={1}
          step={1}
          disabled={!positionEnabled || auth.writeBlocked}
          onCommit={commitMoveThreshold}
        />
        <UnitField
          label="Check every"
          unit="s"
          value={positionIntervalSecs}
          min={60}
          step={1}
          disabled={!positionEnabled || auth.writeBlocked}
          onCommit={(v) => {
            positionIntervalSecs = Math.max(60, Math.round(v));
            void savePositionWarm();
          }}
        />
        <UnitField
          label="Zoom detail"
          value={positionBaseZoom}
          min={0}
          max={22}
          step={1}
          disabled={!positionEnabled || auth.writeBlocked}
          onCommit={(v) => {
            positionBaseZoom = clampInt(v, 0, 22);
            void savePositionWarm();
          }}
        />
      </Disclosure>
    </section>
  {/if}
</SlideOver>

<style>
/* The .panel-section wrapper used by the sections above is the shared class in panels.css. */

/* A landing row that opens a sub-view: a label, its current value, and a trailing chevron, on the
   shared row-interactive base so it reads like the Layers-panel category toggles. Named off the
   global .nav-row (which is an elevated card with a vertical name-over-metrics layout) so the two do
   not collide: a bare .nav-row here inherited the card's flex-direction column and stacked the row. */
.subview-link {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--control-size);
  padding-inline: var(--space-1);
  border-radius: var(--radius-sm);
}
.subview-link-label {
  flex: 1;
  text-align: start;
}
.subview-link-value {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.subview-link :global(.subview-link-chevron) {
  flex-shrink: 0;
  color: var(--text-muted);
}

/* The determinate download progress bar on a downloading region card: a token-driven track with an
   accent fill, mirroring the themed range track so it reads as one instrument across all three
   themes. Local because this is the only place a determinate bar appears. */
.warm-track {
  block-size: var(--range-track-h);
  border-radius: var(--radius-pill);
  background: var(--border);
  overflow: hidden;
}
.warm-fill {
  block-size: 100%;
  background: var(--accent);
  transition: inline-size var(--transition-fast);
}
</style>
