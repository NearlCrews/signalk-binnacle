import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Bbox } from 'signalk-chart-sources';
import { bboxCenter, normalizeBounds } from '$shared/geo';
import {
  clampInt,
  createLatestWriter,
  feetToMeters,
  formatBytes,
  isFiniteNumber,
  lengthUnit,
  metersToFeet,
  nauticalMilesToMeters,
  type UnitsMode,
} from '$shared/lib';
import { ArmedRow } from '$shared/ui';
import { defaultSelection } from './area-defaults.js';
import { DETAIL_PRESETS, presetForRange, rangeForPreset } from './detail-level.js';
import {
  coveringSources,
  downloadGateReason,
  estimateRegionBytes,
  exceedsRegionsFree,
  isTerminal,
  positionWarmSources,
  regionsFreeBytes,
} from './estimate.js';
import type { CacheStats, RegionsClient, SavedRegionDto, WarmStatus } from './regions-client.js';
import type { RegionRectangle } from './regions-draw.js';
import { createRegionRectangle } from './regions-draw.js';
import {
  buildConfigPayload,
  extractPositionWarm,
  type PositionWarmSettings,
} from './settings-payload.js';
import { coveringGroups, includedSummary } from './source-summary.js';

const WORLD_BBOX: Bbox = [-180, -90, 180, 90];
const POLL_FAIL_CAP = 5;
const DEFAULT_POLL_MS = 2000;

export type RegionsSubView = 'home' | 'build' | 'storage' | 'auto';

export interface RegionsControllerDeps {
  getAdminAccess: () => boolean;
  getClient: () => RegionsClient;
  getMap: () => MapLibreMap;
  getUnitsMode: () => UnitsMode;
  createRectangle?: (map: MapLibreMap) => RegionRectangle;
  pollMs?: number;
}

interface PollState {
  generation: number;
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
  abort?: AbortController;
}

export class RegionsController {
  readonly #pollMs: number;
  readonly #polls = new Map<string, PollState>();
  readonly #positionWriter;
  readonly #ttlWriter;
  #rect: RegionRectangle | null = null;
  #activeClient?: RegionsClient;
  #regionsGeneration = 0;
  #statsGeneration = 0;
  #positionGeneration = 0;
  #regionsAbort?: AbortController;
  #statsAbort?: AbortController;
  #positionAbort?: AbortController;
  #geocodeAbort?: AbortController;
  #disposed = false;
  #started = false;
  #ttlEdited = false;

  stats = $state<CacheStats | null>(null);
  statsError = $state<string | null>(null);
  regions = $state<SavedRegionDto[] | null>(null);
  loadError = $state<string | null>(null);
  bbox = $state<Bbox | null>(null);
  selectedSources = $state<string[]>([]);
  minzoom = $state(6);
  maxzoom = $state(12);
  subView = $state<RegionsSubView>('home');
  panelCollapsed = $state(false);
  drawing = $state(false);
  namePrep = $state(false);
  regionName = $state('');
  submitting = $state(false);
  error = $state<string | null>(null);
  regionStatus = $state<Record<string, WarmStatus>>({});
  pendingRegion = $state<Record<string, boolean>>({});
  ttlDays = $state(30);
  confirmingClear = $state(false);
  clearNote = $state<string | null>(null);
  positionEnabled = $state(false);
  positionRadiusMeters = $state(nauticalMilesToMeters(2));
  positionMoveThresholdMeters = $state(nauticalMilesToMeters(1));
  positionIntervalSecs = $state(60);
  positionBaseZoom = $state(12);
  positionSources = $state<string[]>([]);
  positionLoadError = $state<string | null>(null);
  readonly armedDelete = new ArmedRow((id) => void this.deleteRegion(id));
  readonly positionWarmSourceList = positionWarmSources();

  constructor(private readonly deps: RegionsControllerDeps) {
    this.#pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
    this.#positionWriter = createLatestWriter<{ positionWarm: PositionWarmSettings }>((payload) =>
      this.deps.getClient().postConfig(payload),
    );
    this.#ttlWriter = createLatestWriter<number>((days) =>
      this.deps.getClient().setCacheConfig(days),
    );
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.syncClient();
  }

  syncClient(): void {
    if (!this.#started || this.#disposed) return;
    const client = this.deps.getClient();
    if (client === this.#activeClient) return;
    this.#activeClient = client;
    this.#regionsAbort?.abort();
    this.#statsAbort?.abort();
    this.#positionAbort?.abort();
    this.#geocodeAbort?.abort();
    for (const id of [...this.#polls.keys()]) this.stopRegionPoll(id);
    this.stats = null;
    this.statsError = null;
    this.regions = null;
    this.loadError = null;
    this.regionStatus = {};
    this.positionLoadError = null;
    void this.loadStats();
    void this.loadRegions();
    void this.loadPositionWarm();
  }

  syncRectangle(): () => void {
    if (this.#disposed) return () => undefined;
    const map = this.deps.getMap();
    const rectangle = (this.deps.createRectangle ?? createRegionRectangle)(map);
    rectangle.onFinish((next) => {
      this.bbox = next;
      this.selectedSources =
        next === null
          ? []
          : defaultSelection(coveringSources(next, [this.minzoom, this.maxzoom]), next);
      this.namePrep = false;
      this.drawing = false;
      this.panelCollapsed = false;
    });
    this.#rect = rectangle;
    return () => {
      rectangle.destroy();
      if (this.#rect === rectangle) this.#rect = null;
    };
  }

  subViewTitle = $derived(
    this.subView === 'build'
      ? 'Save a chart area'
      : this.subView === 'storage'
        ? 'Storage'
        : this.subView === 'auto'
          ? 'Automatic caching'
          : 'Offline charts',
  );

  get mode(): UnitsMode {
    return this.deps.getUnitsMode();
  }

  get unit(): ReturnType<typeof lengthUnit> {
    return lengthUnit(this.mode);
  }
  positionRadiusDisplay = $derived(this.#toDisplayLength(this.positionRadiusMeters));
  positionMoveDisplay = $derived(this.#toDisplayLength(this.positionMoveThresholdMeters));
  sourceResult = $derived.by(() => {
    try {
      return {
        sources: coveringSources(this.bbox ?? WORLD_BBOX, [this.minzoom, this.maxzoom]),
        error: null,
      };
    } catch {
      return {
        sources: [],
        error: 'The chart provider returned invalid coverage information.',
      };
    }
  });
  sourceList = $derived(this.sourceResult.sources);
  providerError = $derived(this.sourceResult.error);
  selectedSet = $derived(new Set(this.selectedSources));
  positionSet = $derived(new Set(this.positionSources));
  activeSourceIds = $derived(
    this.sourceList.filter((source) => this.selectedSet.has(source.id)).map((source) => source.id),
  );
  selectedObjects = $derived(this.sourceList.filter((source) => this.selectedSet.has(source.id)));
  includedText = $derived(includedSummary(this.selectedObjects));
  sourceGroups = $derived(coveringGroups(this.sourceList));
  detailPreset = $derived(presetForRange(this.minzoom, this.maxzoom));
  selectedDetail = $derived(
    DETAIL_PRESETS.find((preset) => preset.key === this.detailPreset) ?? null,
  );
  estimateResult = $derived.by(() => {
    if (this.stats === null || this.bbox === null || this.activeSourceIds.length === 0) {
      return { ok: true, bytes: 0 } as const;
    }
    return estimateRegionBytes(
      this.activeSourceIds,
      this.bbox,
      [this.minzoom, this.maxzoom],
      this.stats.perSourceAvgBytes,
    );
  });
  estimateVal = $derived(this.estimateResult.ok ? this.estimateResult.bytes : 0);
  estimateError = $derived(this.estimateResult.ok ? null : this.estimateResult.message);
  estimateFmt = $derived(formatBytes(this.estimateVal));
  get gate(): boolean {
    return (
      this.stats !== null &&
      !this.namePrep &&
      this.bbox !== null &&
      this.activeSourceIds.length > 0 &&
      this.deps.getAdminAccess() &&
      this.estimateResult.ok &&
      !exceedsRegionsFree(this.estimateVal, this.stats)
    );
  }

  get gateReason(): ReturnType<typeof downloadGateReason> {
    return downloadGateReason({
      bbox: this.bbox,
      sources: this.activeSourceIds,
      accessBlocked: !this.deps.getAdminAccess(),
      stats: this.stats,
      estimate: this.estimateResult.ok ? this.estimateResult.bytes : null,
    });
  }
  regionsFreeFmt = $derived(this.stats !== null ? formatBytes(regionsFreeBytes(this.stats)) : null);
  pinnedFmt = $derived(this.stats !== null ? formatBytes(this.stats.pinnedBytes ?? 0) : null);
  scrollFmt = $derived(this.stats !== null ? formatBytes(this.stats.scrollBytes ?? 0) : null);
  usedFmt = $derived(this.stats !== null ? formatBytes(this.stats.bytes) : null);
  capFmt = $derived(this.stats !== null ? formatBytes(this.stats.cap) : null);
  usedPercent = $derived(
    this.stats !== null && this.stats.cap > 0
      ? Math.min(100, Math.round((this.stats.bytes / this.stats.cap) * 100))
      : 0,
  );
  autoCacheFmt = $derived(
    this.stats !== null ? formatBytes(this.stats.positionWarmBytes ?? 0) : null,
  );

  get positionWriterState() {
    return this.#positionWriter.state;
  }

  get ttlWriterState() {
    return this.#ttlWriter.state;
  }

  retryPositionWrite(): void {
    this.#positionWriter.retry();
  }

  retryTtlWrite(): void {
    this.#ttlWriter.retry();
  }

  async loadPositionWarm(): Promise<void> {
    const generation = ++this.#positionGeneration;
    this.#positionAbort?.abort();
    const abort = new AbortController();
    this.#positionAbort = abort;
    this.positionLoadError = null;
    try {
      const pw = extractPositionWarm(await this.deps.getClient().getConfig(abort.signal));
      if (this.#disposed || abort.signal.aborted || generation !== this.#positionGeneration) return;
      if (pw === null) {
        this.positionLoadError = 'Chart Locker returned invalid automatic-caching settings.';
        return;
      }
      this.positionEnabled = pw.enabled;
      this.positionRadiusMeters = pw.radiusMeters;
      this.positionMoveThresholdMeters = pw.moveThresholdMeters;
      this.positionIntervalSecs = pw.intervalSecs;
      this.positionBaseZoom = pw.baseZoom;
      this.positionSources = pw.sources;
    } catch {
      if (!abort.signal.aborted && generation === this.#positionGeneration) {
        this.positionLoadError = 'Could not load automatic-caching settings.';
      }
    }
  }

  savePositionWarm(): void {
    if (!this.deps.getAdminAccess()) return;
    this.#positionGeneration += 1;
    this.#positionAbort?.abort();
    this.positionLoadError = null;
    this.#positionWriter.submit(
      buildConfigPayload({
        enabled: this.positionEnabled,
        radiusMeters: this.positionRadiusMeters,
        moveThresholdMeters: this.positionMoveThresholdMeters,
        intervalSecs: this.positionIntervalSecs,
        baseZoom: this.positionBaseZoom,
        sources: this.positionSources,
      }),
    );
  }

  setPositionEnabled(enabled: boolean): void {
    this.positionEnabled = enabled;
    this.savePositionWarm();
  }

  togglePositionSource(id: string, enabled: boolean): void {
    this.positionSources = this.#toggleId(this.positionSources, id, enabled);
    this.savePositionWarm();
  }

  commitPositionRadius(entered: number): void {
    if (!isFiniteNumber(entered)) return;
    this.positionRadiusMeters = Math.max(1, this.#fromDisplayLength(entered));
    this.savePositionWarm();
  }

  commitMoveThreshold(entered: number): void {
    if (!isFiniteNumber(entered)) return;
    this.positionMoveThresholdMeters = Math.max(1, this.#fromDisplayLength(entered));
    this.savePositionWarm();
  }

  commitPositionInterval(value: number): void {
    if (!isFiniteNumber(value)) return;
    this.positionIntervalSecs = Math.max(60, Math.round(value));
    this.savePositionWarm();
  }

  commitPositionBaseZoom(value: number): void {
    if (!isFiniteNumber(value)) return;
    this.positionBaseZoom = clampInt(value, 0, 22);
    this.savePositionWarm();
  }

  commitTtlDays(entered: number): void {
    if (!this.deps.getAdminAccess() || !isFiniteNumber(entered)) return;
    this.#ttlEdited = true;
    this.ttlDays = clampInt(entered, 0, 365);
    this.#ttlWriter.submit(this.ttlDays);
  }

  async clearScrollCache(): Promise<void> {
    if (!this.deps.getAdminAccess()) return;
    this.confirmingClear = false;
    this.clearNote = null;
    try {
      const { freedBytes } = await this.deps.getClient().clearScrollCache();
      const freed = formatBytes(freedBytes);
      this.clearNote =
        freedBytes > 0
          ? `Freed ${freed.value} ${freed.unit} of recently viewed charts.`
          : 'Nothing to clear.';
      await this.loadStats();
    } catch {
      this.error = 'Could not clear the scroll cache.';
    }
  }

  async loadRegions(): Promise<void> {
    const generation = ++this.#regionsGeneration;
    this.#regionsAbort?.abort();
    const abort = new AbortController();
    this.#regionsAbort = abort;
    try {
      const list = await this.deps.getClient().getRegions(abort.signal);
      if (this.#disposed || abort.signal.aborted || generation !== this.#regionsGeneration) return;
      this.regions = list;
      this.loadError = null;
      const active = new Set(
        list.filter((region) => region.status === 'downloading').map((r) => r.id),
      );
      for (const id of this.#polls.keys()) {
        if (!active.has(id)) this.stopRegionPoll(id);
      }
      for (const id of active) {
        if (!this.#polls.has(id)) this.pollRegion(id);
      }
    } catch {
      if (abort.signal.aborted || generation !== this.#regionsGeneration) return;
      if (this.regions === null) {
        this.loadError = 'Could not load the saved regions. Check the connection and access.';
      } else {
        this.error = 'Could not refresh the saved regions.';
      }
    }
  }

  async loadStats(): Promise<void> {
    const generation = ++this.#statsGeneration;
    this.#statsAbort?.abort();
    const abort = new AbortController();
    this.#statsAbort = abort;
    try {
      const stats = await this.deps.getClient().getCacheStats(abort.signal);
      if (this.#disposed || abort.signal.aborted || generation !== this.#statsGeneration) return;
      this.stats = stats;
      if (!this.#ttlEdited && typeof stats.ttlDays === 'number') this.ttlDays = stats.ttlDays;
      this.statsError = null;
    } catch {
      if (abort.signal.aborted || generation !== this.#statsGeneration) return;
      if (this.stats === null) this.statsError = 'Could not load the cache stats.';
      else this.error = 'Could not refresh the cache stats.';
    }
  }

  pollRegion(id: string): void {
    this.stopRegionPoll(id);
    const poll: PollState = { generation: 1, failures: 0 };
    this.#polls.set(id, poll);
    this.#schedulePoll(id, poll);
  }

  stopRegionPoll(id: string): void {
    const poll = this.#polls.get(id);
    if (!poll) return;
    poll.generation += 1;
    if (poll.timer !== undefined) clearTimeout(poll.timer);
    poll.abort?.abort();
    this.#polls.delete(id);
  }

  #schedulePoll(id: string, poll: PollState): void {
    if (this.#disposed || this.#polls.get(id) !== poll) return;
    poll.timer = setTimeout(() => {
      poll.timer = undefined;
      void this.#runPoll(id, poll);
    }, this.#pollMs);
  }

  async #runPoll(id: string, poll: PollState): Promise<void> {
    if (this.#disposed || this.#polls.get(id) !== poll) return;
    const generation = poll.generation;
    const abort = new AbortController();
    poll.abort = abort;
    try {
      const status = await this.deps.getClient().getRegionJobStatus(id, abort.signal);
      if (abort.signal.aborted || this.#polls.get(id) !== poll || generation !== poll.generation) {
        return;
      }
      poll.failures = 0;
      if (status !== null) this.regionStatus = { ...this.regionStatus, [id]: status };
      if (isTerminal(status)) {
        this.stopRegionPoll(id);
        await Promise.all([this.loadRegions(), this.loadStats()]);
        return;
      }
    } catch {
      if (abort.signal.aborted || this.#polls.get(id) !== poll) return;
      poll.failures += 1;
      if (poll.failures >= POLL_FAIL_CAP) {
        this.stopRegionPoll(id);
        this.error = 'Lost contact with a region download. Check the connection and try again.';
        return;
      }
    } finally {
      if (poll.abort === abort) poll.abort = undefined;
    }
    this.#schedulePoll(id, poll);
  }

  async prepareDownload(): Promise<void> {
    if (!this.gate || this.bbox === null || this.submitting) return;
    this.error = null;
    this.submitting = true;
    this.#geocodeAbort?.abort();
    const abort = new AbortController();
    this.#geocodeAbort = abort;
    const startedFor = this.bbox;
    const { latitude, longitude } = bboxCenter(this.bbox);
    const fallback = this.#coordName(this.bbox);
    try {
      const name = await this.deps.getClient().geocode(latitude, longitude, abort.signal);
      if (!abort.signal.aborted && this.bbox === startedFor) this.regionName = name ?? fallback;
    } catch {
      if (!abort.signal.aborted && this.bbox === startedFor) this.regionName = fallback;
    } finally {
      if (!abort.signal.aborted && this.bbox === startedFor) this.namePrep = true;
      if (this.#geocodeAbort === abort) this.#geocodeAbort = undefined;
      this.submitting = false;
    }
  }

  async saveRegion(): Promise<void> {
    if (
      !this.deps.getAdminAccess() ||
      this.bbox === null ||
      this.activeSourceIds.length === 0 ||
      this.submitting
    ) {
      return;
    }
    const name = this.regionName.trim() || this.#coordName(this.bbox);
    this.error = null;
    this.submitting = true;
    try {
      const { region } = await this.deps.getClient().postRegion({
        bbox: this.bbox,
        sourceIds: this.activeSourceIds,
        minzoom: this.minzoom,
        maxzoom: this.maxzoom,
        name,
      });
      this.namePrep = false;
      this.regionName = '';
      this.#rect?.clear();
      this.subView = 'home';
      await Promise.all([this.loadRegions(), this.loadStats()]);
      this.pollRegion(region.id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Region download failed';
    } finally {
      this.submitting = false;
    }
  }

  async redownloadRegion(id: string): Promise<void> {
    if (!this.deps.getAdminAccess() || this.submitting || this.pendingRegion[id]) return;
    this.error = null;
    this.#setPending(id, true);
    try {
      await this.deps.getClient().redownloadRegion(id);
      await this.loadRegions();
      this.pollRegion(id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Re-download failed';
    } finally {
      this.#setPending(id, false);
    }
  }

  async deleteRegion(id: string): Promise<void> {
    if (!this.deps.getAdminAccess() || this.submitting || this.pendingRegion[id]) return;
    this.error = null;
    this.#setPending(id, true);
    const wasPolling = this.#polls.has(id);
    this.stopRegionPoll(id);
    try {
      await this.deps.getClient().deleteRegion(id);
      await Promise.all([this.loadRegions(), this.loadStats()]);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Delete failed';
      if (wasPolling && !this.#disposed) this.pollRegion(id);
    } finally {
      this.#setPending(id, false);
    }
  }

  applyDetailPreset(key: 'overview' | 'coastal' | 'harbor'): void {
    [this.minzoom, this.maxzoom] = rangeForPreset(key);
  }

  commitMinZoom(value: number): void {
    if (!isFiniteNumber(value)) return;
    this.minzoom = clampInt(value, 0, this.maxzoom);
  }

  commitMaxZoom(value: number): void {
    if (!isFiniteNumber(value)) return;
    this.maxzoom = clampInt(value, this.minzoom, 22);
  }

  toggleSource(id: string, enabled: boolean): void {
    this.selectedSources = this.#toggleId(this.selectedSources, id, enabled);
  }

  startDrawing(): void {
    this.drawing = true;
    this.panelCollapsed = true;
    this.#rect?.start();
  }

  startNewRegion(): void {
    this.bbox = null;
    this.selectedSources = [];
    [this.minzoom, this.maxzoom] = rangeForPreset('coastal');
    this.regionName = '';
    this.namePrep = false;
    this.drawing = false;
    this.panelCollapsed = false;
    this.#rect?.clear();
    this.subView = 'build';
  }

  backToOfflineHome(): void {
    if (this.subView === 'build') {
      this.drawing = false;
      this.panelCollapsed = false;
      this.#rect?.clear();
    }
    this.subView = 'home';
  }

  showSubView(view: Exclude<RegionsSubView, 'build'>): void {
    this.subView = view;
  }

  showRegion(region: SavedRegionDto): void {
    const bounds = normalizeBounds(region.bbox);
    if (bounds === null) {
      this.error = 'This saved area has invalid bounds and cannot be shown.';
      return;
    }
    this.deps.getMap().fitBounds(bounds, { padding: 48, maxZoom: region.maxzoom });
  }

  useRegionAsTemplate(region: SavedRegionDto): void {
    this.bbox = [...region.bbox] as Bbox;
    this.selectedSources = [...region.sourceIds];
    this.minzoom = region.minzoom;
    this.maxzoom = region.maxzoom;
    this.regionName = `${region.name} updated`;
    this.namePrep = false;
    this.subView = 'build';
    this.#rect?.set(region.bbox);
    this.showRegion(region);
  }

  clearRectangle(): void {
    this.#rect?.clear();
  }

  toggleCollapsed(): void {
    this.panelCollapsed = !this.panelCollapsed;
  }

  setRegionName(value: string): void {
    this.regionName = value;
  }

  cancelNamePrep(): void {
    this.#geocodeAbort?.abort();
    this.namePrep = false;
    this.regionName = '';
  }

  requestClear(): void {
    this.confirmingClear = true;
  }

  cancelClear(): void {
    this.confirmingClear = false;
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#regionsGeneration += 1;
    this.#statsGeneration += 1;
    this.#positionGeneration += 1;
    this.#regionsAbort?.abort();
    this.#statsAbort?.abort();
    this.#positionAbort?.abort();
    this.#geocodeAbort?.abort();
    for (const id of [...this.#polls.keys()]) this.stopRegionPoll(id);
    this.#positionWriter.dispose();
    this.#ttlWriter.dispose();
  }

  #setPending(id: string, busy: boolean): void {
    this.pendingRegion = { ...this.pendingRegion, [id]: busy };
  }

  #toggleId(list: string[], id: string, enabled: boolean): string[] {
    if (enabled) return list.includes(id) ? list : [...list, id];
    return list.filter((value) => value !== id);
  }

  #coordName(box: Bbox): string {
    const { latitude, longitude } = bboxCenter(box);
    return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  }

  #toDisplayLength(meters: number): number {
    return Math.round(this.mode === 'imperial' ? (metersToFeet(meters) ?? 0) : meters);
  }

  #fromDisplayLength(entered: number): number {
    return this.mode === 'imperial' ? (feetToMeters(entered) ?? entered) : entered;
  }
}

export function createRegionsController(deps: RegionsControllerDeps): RegionsController {
  return new RegionsController(deps);
}
