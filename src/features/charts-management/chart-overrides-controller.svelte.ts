import type { ManagedChart } from './charts-management-client';

export type ChartOverrideField = 'name' | 'description';
export type ChartOverrideSaveState = 'saving' | 'saved' | 'error';

interface Deps {
  getChart: (id: string) => ManagedChart | undefined;
  updateOverride: (id: string, override: ManagedChart['override']) => void;
  write: (id: string, override: ManagedChart['override']) => Promise<boolean>;
  schedule?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

const FIELDS: readonly ChartOverrideField[] = ['name', 'description'];
const SAVED_DURATION_MS = 2_000;

// Serializes complete override documents per chart. Each edit is applied locally before it is queued,
// so a description edit made while a name save is in flight includes both values. The queue then sends
// that merged snapshot last, preventing an older response from restoring stale chart metadata.
export function createChartOverridesController(deps: Deps) {
  const schedule = deps.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel = deps.cancel ?? clearTimeout;
  let states = $state<Record<string, ChartOverrideSaveState>>({});
  const generations = new Map<string, number>();
  const pending = new Map<string, Set<ChartOverrideField>>();
  const running = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;

  const stateKey = (id: string, field: ChartOverrideField): string => `${id}:${field}`;

  function setState(key: string, state: ChartOverrideSaveState | undefined): void {
    const next = { ...states };
    if (state === undefined) delete next[key];
    else next[key] = state;
    states = next;
  }

  function clearTimer(key: string): void {
    const timer = timers.get(key);
    if (timer !== undefined) cancel(timer);
    timers.delete(key);
  }

  function showSaved(key: string, generation: number): void {
    clearTimer(key);
    setState(key, 'saved');
    timers.set(
      key,
      schedule(() => {
        timers.delete(key);
        if (!disposed && generations.get(key) === generation && states[key] === 'saved') {
          setState(key, undefined);
        }
      }, SAVED_DURATION_MS),
    );
  }

  async function drain(id: string): Promise<void> {
    if (running.has(id) || disposed) return;
    running.add(id);
    try {
      while ((pending.get(id)?.size ?? 0) > 0 && !disposed) {
        const fields = pending.get(id) ?? new Set<ChartOverrideField>();
        pending.delete(id);
        const chart = deps.getChart(id);
        if (!chart) return;
        const snapshot = { ...chart.override };
        const snapshotGenerations = new Map(
          FIELDS.map((field) => {
            const key = stateKey(id, field);
            return [field, generations.get(key) ?? 0] as const;
          }),
        );
        const ok = await deps.write(id, snapshot);
        if (disposed) return;
        // A queued edit is the authoritative next request, so defer feedback until it finishes.
        if ((pending.get(id)?.size ?? 0) > 0) continue;
        for (const field of FIELDS) {
          const key = stateKey(id, field);
          const generation = snapshotGenerations.get(field) ?? 0;
          if (generations.get(key) !== generation) continue;
          if (snapshot[field] !== deps.getChart(id)?.override[field]) continue;
          if (ok) showSaved(key, generation);
          else if (fields.has(field) || states[key] === 'saving') setState(key, 'error');
        }
      }
    } finally {
      running.delete(id);
      if ((pending.get(id)?.size ?? 0) > 0 && !disposed) void drain(id);
    }
  }

  function save(chart: ManagedChart, field: ChartOverrideField, value: string): void {
    if (disposed) return;
    const current = deps.getChart(chart.identifier) ?? chart;
    const override = { ...current.override, [field]: value };
    deps.updateOverride(chart.identifier, override);
    const key = stateKey(chart.identifier, field);
    clearTimer(key);
    generations.set(key, (generations.get(key) ?? 0) + 1);
    setState(key, 'saving');
    const fields = pending.get(chart.identifier) ?? new Set<ChartOverrideField>();
    fields.add(field);
    pending.set(chart.identifier, fields);
    void drain(chart.identifier);
  }

  function retry(id: string, field: ChartOverrideField): void {
    if (disposed || !deps.getChart(id)) return;
    const key = stateKey(id, field);
    clearTimer(key);
    generations.set(key, (generations.get(key) ?? 0) + 1);
    setState(key, 'saving');
    const fields = pending.get(id) ?? new Set<ChartOverrideField>();
    fields.add(field);
    pending.set(id, fields);
    void drain(id);
  }

  return {
    save,
    retry,
    dispose(): void {
      disposed = true;
      pending.clear();
      for (const timer of timers.values()) cancel(timer);
      timers.clear();
    },
    get states() {
      return states;
    },
  };
}
