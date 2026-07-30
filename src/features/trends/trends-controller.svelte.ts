import {
  cleanTrendInstrumentIds,
  type InstrumentTrendCategory,
  type InstrumentTrendDescriptor,
  isTrendInstrumentId,
  MAX_TREND_INSTRUMENTS,
} from '$entities/instrument-trend';
import { createRetryableLazyUiLoader } from '$shared/lib';
import type { PersistedValue } from '$shared/settings';
import type { HistoryProviders, SignalKStore, SubscribeEntry } from '$shared/signalk';
import { type SessionTrendSeries, TrendSessionRecorder } from './session-recorder.svelte';
import type { TrendHistory, TrendHistoryState } from './trends-history';

const loadTrendsHistory = createRetryableLazyUiLoader(() => import('./trends-history'));

export type TrendProviderState = 'checking' | 'retrying' | 'available' | 'absent' | 'failed';

export interface TrendItem {
  id: string;
  label: string;
  description: string;
  category: InstrumentTrendCategory | 'unavailable';
  descriptor?: InstrumentTrendDescriptor;
  unavailable: boolean;
  historicalOnly: boolean;
  hasLiveReport: boolean;
}

export interface TrendsDeps {
  store: SignalKStore;
  origin: string;
  getToken: () => string | undefined;
  getHistoryProviders: () => HistoryProviders | undefined;
  getHistoryProviderState: () => TrendProviderState;
  subscribe: (entries: SubscribeEntry[]) => void;
  unsubscribe: (paths: string[]) => void;
  selectionStore: PersistedValue<string[]>;
  getCatalog: () => readonly InstrumentTrendDescriptor[];
  getDescriptor: (id: string) => InstrumentTrendDescriptor | undefined;
  prepareDescriptors: (ids: readonly string[]) => void;
  refreshCatalog: () => void;
  getDiscovering: () => boolean;
  isHistoricalOnly: (id: string) => boolean;
}

export interface TrendsController {
  readonly open: boolean;
  readonly selectedIds: readonly string[];
  readonly selected: readonly TrendItem[];
  readonly catalog: readonly TrendItem[];
  readonly charts: readonly TrendItem[];
  readonly focusedId: string | undefined;
  readonly focusedTransient: boolean;
  readonly discovering: boolean;
  readonly loading: boolean;
  readonly history: TrendHistory | undefined;
  readonly historyState: TrendHistoryState | 'idle' | 'loading';
  readonly providerState: TrendProviderState;
  readonly hasProvider: boolean;
  readonly recorder: TrendSessionRecorder;
  toggle(id: string): void;
  reorder(id: string, slot: number): void;
  setFocus(id: string | undefined): boolean;
  setOpen(open: boolean): void;
  refreshCatalog(): void;
  refreshHistory(): void;
  sessionSeries(id: string): SessionTrendSeries;
  resubscribe(): void;
  dispose(): void;
}

export function createTrendsController(deps: TrendsDeps): TrendsController {
  const recorder = new TrendSessionRecorder();
  const subscribedPaths = new Set<string>();
  let recordedIds = new Set<string>();
  let open = $state(false);
  let focusedId = $state<string | undefined>();
  let focusedTransient = $state(false);
  let loading = $state(false);
  let history = $state.raw<TrendHistory | undefined>();
  let historyState = $state<TrendHistoryState | 'idle' | 'loading'>('idle');
  let refreshGeneration = $state(0);
  let historyGeneration = 0;
  let historyAbort: AbortController | undefined;
  let disposed = false;

  const selectedIds = $derived.by<readonly string[]>(() =>
    cleanTrendInstrumentIds(deps.selectionStore.value),
  );

  function descriptorFor(id: string): InstrumentTrendDescriptor | undefined {
    return deps.getDescriptor(id) ?? deps.getCatalog().find((entry) => entry.id === id);
  }

  function itemFor(id: string): TrendItem {
    const descriptor = descriptorFor(id);
    if (!descriptor) {
      return {
        id,
        label: `Unavailable instrument · ${id}`,
        description: 'This saved instrument is not available on the current Signal K server.',
        category: 'unavailable',
        unavailable: true,
        historicalOnly: false,
        hasLiveReport: false,
      };
    }
    const hasLiveReport = descriptor.candidates.some(
      (candidate) => deps.store.cell(candidate.path).epoch > 0,
    );
    return {
      id,
      label: descriptor.label,
      description: descriptor.description,
      category: descriptor.category,
      descriptor,
      unavailable: false,
      historicalOnly: deps.isHistoricalOnly(id) && !hasLiveReport,
      hasLiveReport,
    };
  }

  const selected = $derived.by<readonly TrendItem[]>(() => selectedIds.map((id) => itemFor(id)));
  const catalog = $derived.by<readonly TrendItem[]>(() =>
    deps.getCatalog().map((descriptor) => itemFor(descriptor.id)),
  );
  const charts = $derived.by<readonly TrendItem[]>(() =>
    focusedId ? [itemFor(focusedId)] : selected,
  );
  const desiredDescriptors = $derived.by<readonly InstrumentTrendDescriptor[]>(() => {
    const resolved = selected.flatMap((item) => (item.descriptor ? [item.descriptor] : []));
    const focus = focusedId ? descriptorFor(focusedId) : undefined;
    if (focus && !resolved.some((descriptor) => descriptor.id === focus.id)) resolved.push(focus);
    return resolved;
  });

  function readPath(path: string) {
    const cell = deps.store.cell(path);
    return { value: cell.value, epoch: cell.epoch };
  }

  function currentDescriptorIds(): string[] {
    return desiredDescriptors.map((descriptor) => descriptor.id);
  }

  function syncDemand(): void {
    if (disposed) return;
    const descriptors = desiredDescriptors;
    // Preserve a selected instrument's existing buffer while discovery temporarily cannot resolve
    // its descriptor. If it returns, its earlier session samples and latched source remain intact.
    const retainedIds = new Set(selectedIds);
    if (focusedId) retainedIds.add(focusedId);
    recorder.retain(retainedIds);
    const addedDescriptors = descriptors.filter((descriptor) => !recordedIds.has(descriptor.id));
    recordedIds = new Set(descriptors.map((descriptor) => descriptor.id));
    if (addedDescriptors.length > 0) {
      recorder.record(addedDescriptors, readPath, Date.now());
    }
    deps.prepareDescriptors([...retainedIds]);
    const desiredPaths = new Map<string, number>();
    for (const descriptor of descriptors) {
      for (const candidate of descriptor.candidates) {
        const current = desiredPaths.get(candidate.path);
        desiredPaths.set(
          candidate.path,
          current === undefined ? candidate.minPeriodMs : Math.min(current, candidate.minPeriodMs),
        );
      }
    }
    deps.store.ensureCells([...desiredPaths.keys()]);
    const toAdd = [...desiredPaths].filter(([path]) => !subscribedPaths.has(path));
    const toRemove = [...subscribedPaths].filter((path) => !desiredPaths.has(path));
    if (toAdd.length > 0) {
      deps.subscribe(toAdd.map(([path, minPeriod]) => ({ path, policy: 'instant', minPeriod })));
      for (const [path] of toAdd) subscribedPaths.add(path);
    }
    if (toRemove.length > 0) {
      deps.unsubscribe(toRemove);
      for (const path of toRemove) subscribedPaths.delete(path);
    }
  }

  recordedIds = new Set(currentDescriptorIds());
  recorder.start(() => desiredDescriptors, readPath);
  syncDemand();

  $effect(() => {
    // The signature intentionally excludes labels and descriptions. Meta display-name updates may
    // redraw the catalog, but they must not perturb subscription refcounts or recorder timing.
    const signature = desiredDescriptors
      .map(
        (descriptor) =>
          `${descriptor.id}\u0001${descriptor.candidates
            .map((candidate) => `${candidate.path}\u0002${candidate.minPeriodMs}`)
            .join('\u0003')}`,
      )
      .join('\u0004');
    void signature;
    syncDemand();
  });

  function cancelHistory(): void {
    historyGeneration += 1;
    historyAbort?.abort();
    historyAbort = undefined;
    loading = false;
  }

  async function loadHistoryNow(
    providers: HistoryProviders,
    descriptors: readonly InstrumentTrendDescriptor[],
    token: string | undefined,
  ): Promise<void> {
    const generation = ++historyGeneration;
    historyAbort?.abort();
    const abort = new AbortController();
    historyAbort = abort;
    loading = true;
    historyState = 'loading';
    try {
      const { loadTrendHistory } = await loadTrendsHistory();
      if (disposed || generation !== historyGeneration || abort.signal.aborted) return;
      const result = await loadTrendHistory(
        deps.origin,
        token,
        providers,
        descriptors,
        abort.signal,
      );
      if (disposed || generation !== historyGeneration || abort.signal.aborted) return;
      if (result.state !== 'failed') history = result;
      historyState = result.state;
    } catch (error) {
      if (
        disposed ||
        generation !== historyGeneration ||
        abort.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      historyState = 'failed';
    } finally {
      if (!disposed && generation === historyGeneration) {
        loading = false;
        if (historyAbort === abort) historyAbort = undefined;
      }
    }
  }

  $effect(() => {
    const isOpen = open;
    const providerState = deps.getHistoryProviderState();
    const providers = deps.getHistoryProviders();
    const token = deps.getToken();
    const descriptorSignature = charts
      .map((item) => {
        const descriptor = item.descriptor;
        return descriptor
          ? `${descriptor.id}:${descriptor.aggregate}:${descriptor.candidates
              .map((candidate) => candidate.path)
              .join(',')}`
          : item.id;
      })
      .join('|');
    void refreshGeneration;
    void descriptorSignature;
    if (!isOpen) {
      cancelHistory();
      return;
    }
    if (providerState === 'checking' || providerState === 'retrying') {
      cancelHistory();
      return;
    }
    if (providerState !== 'available' || !providers?.ids.length) {
      cancelHistory();
      if (providerState === 'absent') {
        history = undefined;
        historyState = 'idle';
      }
      return;
    }
    const descriptors = charts.flatMap((item) => (item.descriptor ? [item.descriptor] : []));
    if (descriptors.length === 0) {
      cancelHistory();
      history = undefined;
      historyState = 'empty';
      return;
    }
    void loadHistoryNow(providers, descriptors, token);
    return () => historyAbort?.abort();
  });

  function toggle(id: string): void {
    if (!isTrendInstrumentId(id)) return;
    const current = [...selectedIds];
    const index = current.indexOf(id);
    if (index < 0 && current.length >= MAX_TREND_INSTRUMENTS) return;
    deps.selectionStore.set(
      index >= 0 ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  function reorder(id: string, slot: number): void {
    const current = [...selectedIds];
    const index = current.indexOf(id);
    if (index < 0) return;
    current.splice(index, 1);
    current.splice(Math.max(0, Math.min(slot, current.length)), 0, id);
    deps.selectionStore.set(current);
  }

  function setFocus(id: string | undefined): boolean {
    if (id === undefined) {
      focusedId = undefined;
      focusedTransient = false;
      syncDemand();
      return true;
    }
    if (!descriptorFor(id)) return false;
    // Latch whether this focus created the buffer. Profile synchronization can add or remove the id
    // while the chart is open, but that must not rewrite the honest session-window explanation.
    focusedTransient = !selectedIds.includes(id);
    focusedId = id;
    syncDemand();
    return true;
  }

  function setOpen(next: boolean): void {
    open = next;
    if (!next) {
      cancelHistory();
      return;
    }
    deps.prepareDescriptors(charts.map((item) => item.id));
    deps.refreshCatalog();
  }

  function refreshCatalog(): void {
    deps.refreshCatalog();
  }

  function refreshHistory(): void {
    refreshGeneration += 1;
  }

  function sessionSeries(id: string): SessionTrendSeries {
    void recorder.version;
    return recorder.series(id, descriptorFor(id));
  }

  function resubscribe(): void {
    subscribedPaths.clear();
    syncDemand();
  }

  function dispose(): void {
    disposed = true;
    cancelHistory();
    recorder.stop();
    if (subscribedPaths.size > 0) {
      deps.unsubscribe([...subscribedPaths]);
      subscribedPaths.clear();
    }
  }

  return {
    get open() {
      return open;
    },
    get selectedIds() {
      return selectedIds;
    },
    get selected() {
      return selected;
    },
    get catalog() {
      return catalog;
    },
    get charts() {
      return charts;
    },
    get focusedId() {
      return focusedId;
    },
    get focusedTransient() {
      return focusedTransient;
    },
    get discovering() {
      return deps.getDiscovering();
    },
    get loading() {
      return loading;
    },
    get history() {
      return history;
    },
    get historyState() {
      return historyState;
    },
    get providerState() {
      return deps.getHistoryProviderState();
    },
    get hasProvider() {
      return (deps.getHistoryProviders()?.ids.length ?? 0) > 0;
    },
    recorder,
    toggle,
    reorder,
    setFocus,
    setOpen,
    refreshCatalog,
    refreshHistory,
    sessionSeries,
    resubscribe,
    dispose,
  };
}
