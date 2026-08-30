import {
  type CompanionReport,
  fetchCompanionReports,
  type RunAnalyzerAck,
  runAnalyzer,
} from './companion-client';

export const COMPANION_REFRESH_MS = 60_000;
// An ack answers the tap that asked, not the record; it clears itself so a stale "run started"
// cannot outlive the run it described.
export const ACK_NOTE_MS = 15_000;

export type CompanionAvailability = 'unknown' | 'available' | 'absent' | 'unavailable';

export interface CompanionAiDeps {
  origin: () => string;
  token: () => string | undefined;
  fetchReports?: typeof fetchCompanionReports;
  run?: typeof runAnalyzer;
}

export interface CompanionAiController {
  readonly reports: readonly CompanionReport[];
  readonly availability: CompanionAvailability;
  readonly loading: boolean;
  readonly busyAnalyzerIds: ReadonlySet<string>;
  ackNoteFor(analyzerId: string): string | undefined;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  runNow(analyzerId: string): Promise<void>;
}

function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

function ackNoteText(ack: RunAnalyzerAck): string {
  switch (ack.kind) {
    case 'started':
      return 'Run started. The report updates here when it completes.';
    case 'completed':
      return ack.message ? sentence(`Run complete: ${ack.message}`) : 'Run complete.';
    case 'refused':
      return ack.message
        ? sentence(`The server declined the run: ${ack.message}`)
        : 'The server declined the run.';
    case 'access-denied':
      return 'Signal K refused the run. Read and write access is needed to run an analyzer from here.';
    case 'unavailable':
      return 'Run on demand is not enabled for this analyzer on the server.';
    case 'unreachable':
      return 'The run request did not reach the server. Check the connection and try again.';
  }
}

function newestFirst(reports: readonly CompanionReport[]): CompanionReport[] {
  return [...reports].sort(
    (a, b) =>
      (b.timestampMs ?? 0) - (a.timestampMs ?? 0) || a.analyzerId.localeCompare(b.analyzerId),
  );
}

// Owns hydration, the open-panel refresh cadence, per-analyzer run-now serialization, and the
// transient ack notes. Reports are retained across panel closes and through transient failures, so
// a dropped poll never blanks an advisory the navigator was reading.
export function createCompanionAiController(deps: CompanionAiDeps): CompanionAiController {
  const fetchReports = deps.fetchReports ?? fetchCompanionReports;
  const run = deps.run ?? runAnalyzer;

  let reports = $state<CompanionReport[]>([]);
  let availability = $state<CompanionAvailability>('unknown');
  let loading = $state(false);
  let busyAnalyzerIds = $state<ReadonlySet<string>>(new Set());
  let ackNotes = $state<ReadonlyMap<string, string>>(new Map());

  let loadGeneration = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const ackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function refresh(): Promise<void> {
    const generation = ++loadGeneration;
    loading = true;
    const result = await fetchReports(deps.origin(), deps.token());
    if (generation !== loadGeneration) return;
    loading = false;
    if (result.state === 'ok') {
      availability = 'available';
      reports = newestFirst(result.reports);
      return;
    }
    availability = result.state;
    // A 404 branch is a real empty; a transport failure keeps the retained reports visible.
    if (result.state === 'absent') reports = [];
  }

  function setAckNote(analyzerId: string, note: string | undefined): void {
    const timeout = ackTimers.get(analyzerId);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      ackTimers.delete(analyzerId);
    }
    const next = new Map(ackNotes);
    if (note === undefined) {
      next.delete(analyzerId);
    } else {
      next.set(analyzerId, note);
      ackTimers.set(
        analyzerId,
        setTimeout(() => {
          ackTimers.delete(analyzerId);
          const cleared = new Map(ackNotes);
          cleared.delete(analyzerId);
          ackNotes = cleared;
        }, ACK_NOTE_MS),
      );
    }
    ackNotes = next;
  }

  async function runNow(analyzerId: string): Promise<void> {
    if (busyAnalyzerIds.has(analyzerId)) return;
    busyAnalyzerIds = new Set(busyAnalyzerIds).add(analyzerId);
    setAckNote(analyzerId, undefined);
    try {
      const ack = await run(deps.origin(), deps.token(), analyzerId);
      setAckNote(analyzerId, ackNoteText(ack));
      // A synchronous completion may have published a fresh report; pull it now rather than
      // waiting a cadence. A pending run lands through the ordinary cadence when it finishes.
      if (ack.kind === 'completed') void refresh();
    } finally {
      const next = new Set(busyAnalyzerIds);
      next.delete(analyzerId);
      busyAnalyzerIds = next;
    }
  }

  function start(): void {
    if (timer !== undefined) return;
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    }, COMPANION_REFRESH_MS);
    void refresh();
  }

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    for (const timeout of ackTimers.values()) clearTimeout(timeout);
    ackTimers.clear();
    ackNotes = new Map();
  }

  return {
    get reports() {
      return reports;
    },
    get availability() {
      return availability;
    },
    get loading() {
      return loading;
    },
    get busyAnalyzerIds() {
      return busyAnalyzerIds;
    },
    ackNoteFor(analyzerId) {
      return ackNotes.get(analyzerId);
    },
    start,
    stop,
    refresh,
    runNow,
  };
}
