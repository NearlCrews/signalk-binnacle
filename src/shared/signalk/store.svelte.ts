import { sameJsonValue } from '$shared/lib';
import type { SourceTransition } from './source-trace';
import type {
  AisTargetState,
  AlarmStatus,
  ConnectionState,
  PathSource,
  PathStaleMarker,
  ServerStaleRecord,
  SKFrame,
  Value,
} from './types';
import {
  INITIAL_CONNECTION_STATE,
  isRaisedNotificationValue,
  isSoundingNotification,
  NOTIFICATIONS_PREFIX,
  notificationSeverityRank,
} from './types';

// How many distinct raised notification paths the mirror will hold. Comfortably above any
// well-formed server (Signal K alarms are per hazard, not per sample) and far below a memory
// problem. The alert list renders fewer still; this bounds what is retained, not what is shown.
const MAX_MIRRORED_NOTIFICATIONS = 1_000;

// The same bound on notification CELLS, which is a separate leak from the mirror above. The mirror
// drops a notification the moment it resolves, but the path's cell stays in #cells forever, and a
// v2 raise mints a new id per notification: one hazard alarming through a long passage leaves a
// fresh `notifications.<hazard>.<uuid>` cell behind every time. Every other subscribed path is
// finite and stable, so this is the one family that needs pruning.
const MAX_NOTIFICATION_CELLS = 1_000;

// How many source transitions a traced cell retains. A well-behaved installation sees a handful in
// a whole passage; the bound only caps a pathological alternation, whose cue reads the same at
// eight entries as at eight hundred.
const MAX_SOURCE_TRACE = 8;

// How many per-source samples a traced cell retains. Real installations run two or three sources
// on a contested path (two GPS units, a sounder and a forward scanner); the bound caps a
// misbehaving producer inventing source refs.
const MAX_SOURCES_PER_PATH = 4;

// The most recent value one source reported for a traced path. Keyed by the source's $source ref
// (the per-device identity; the display label is the BUS for hardware sources, shared by every
// device on it), and the ref is also what consumers display.
export interface SourceSample {
  value: Value;
  epoch: number;
}

// The status fields the alert list renders, so the notification dedup compares them field by field;
// serializing the status object would allocate per delta for active alarms. canClear is intentionally
// omitted: Binnacle renders no clear affordance, so a canClear-only change should not bump the version.
type Flags = Partial<Record<keyof AlarmStatus, unknown>> | undefined;
function sameFlags(a: Flags, b: Flags): boolean {
  return (
    a?.silenced === b?.silenced &&
    a?.acknowledged === b?.acknowledged &&
    a?.acknowledgedAt === b?.acknowledgedAt &&
    a?.canSilence === b?.canSilence &&
    a?.canAcknowledge === b?.canAcknowledge
  );
}

function samePosition(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const left = a as { latitude?: unknown; longitude?: unknown };
  const right = b as { latitude?: unknown; longitude?: unknown };
  return (
    Object.hasOwn(left, 'latitude') === Object.hasOwn(right, 'latitude') &&
    Object.hasOwn(left, 'longitude') === Object.hasOwn(right, 'longitude') &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

// True when a cell's retained value was written before the current connection: the store bumps
// its generation on reconnect, so a cell still carrying an older generation (and a real epoch)
// holds pre-reconnect data. Four stores spelled this inline before it was hoisted.
export function predatesReconnect(
  cell: { epoch: number; generation: number },
  storeGeneration: number,
): boolean {
  return cell.epoch > 0 && cell.generation !== storeGeneration;
}

export class PathCell {
  value = $state<Value | undefined>(undefined);
  source = $state<PathSource | undefined>(undefined);
  // The wall-clock epoch of the most recent stream update, for staleness checks. Zero until the
  // first value arrives. Reactive so a consumer comparing it against a ticking clock re-renders
  // when a fresh value lands. Seeded cells (the course REST hydration writes value directly, not
  // through applyFrame) leave this at zero, which is correct: those are not stream-aged.
  epoch = $state(0);
  generation = $state(0);
  // True only when the current value came from the delta stream. REST hydration uses the same cell
  // but must not make a same-millisecond later hydration look like a competing stream write.
  streamed = $state(false);
  // Recent source transitions, oldest first, populated only for paths opted in via traceSources.
  // The first entry is the first source observed and not a handoff; repeats of the same label
  // append nothing, and a reconnect generation clears the trace so old transitions cannot leak
  // into the disagreement cue. Raw: always replaced wholesale, and the per-frame tail read in
  // #recordTraced must not pay deep-proxy traps.
  sourceTrace = $state.raw<readonly SourceTransition[]>([]);
  // Set while the server's meta.timeout enforcement declares this path timed out; the last good
  // value stays in `value`. Cleared by any later self value for the path, null included, and
  // deliberately latched across reconnect generations: a declaration stands until data flows.
  // Raw: the record is always replaced wholesale, never mutated.
  serverStale = $state.raw<ServerStaleRecord | undefined>(undefined);
  // The path's declared staleness window in ms, from the server's meta.timeout, written by
  // whichever consumer fetched the path's meta (Infinity when the server declares it never
  // stale). Grading helpers prefer it over their client default. Derived from server data, so
  // concurrent writers always agree.
  staleWindowMs = $state<number | undefined>(undefined);
  // Per-source last values for traced paths, keyed by source ref, mutated in place on the hot
  // path. Deliberately a PLAIN map: the one renderer re-reads current values through the 1 Hz
  // reactive clock (its age column), and the revision below covers structural changes.
  sourceSamples: Map<string, SourceSample> | undefined;
  // Bumped only when the sample KEY SET changes (insert or evict), never on an in-place value
  // update, so a consumer is not invalidated per delta frame.
  sourceSamplesRevision = $state(0);
  // Notification activation sequence. It increments only on quiet-to-sounding transitions, so
  // acknowledgments survive repeated emergency deltas but reset after a clear and re-raise.
  activation = $state(0);
}

export class SignalKStore {
  connection = $state<ConnectionState>(INITIAL_CONNECTION_STATE);
  generation = $state(0);
  // The own-vessel context from hello (vessels.urn:...), once the stream has connected; plain,
  // not reactive: consumers read it at fetch time, never render from it.
  selfContext: string | undefined;
  // Exposed as ReadonlyMap so a consumer cannot mutate past applyFrame and pruneAis, the only
  // write paths that keep the version counters honest; the mutable Maps stay private.
  #aisTargets = new Map<string, AisTargetState>();
  get aisTargets(): ReadonlyMap<string, AisTargetState> {
    return this.#aisTargets;
  }

  // Bumped on every AIS change, so a consumer can skip rebuilding when nothing moved.
  // Reactive so a $derived or $effect consumer is notified, not only the rAF poll.
  aisVersion = $state(0);

  // Mirror of every raised self notifications.* value, keyed by path, mirroring the AIS
  // pattern: a non-reactive Map plus a version bump so list consumers rebuild only on change.
  // The per-path cells still update for the keyed consumers (anchor drag, MOB).
  #notifications = new Map<string, Value>();
  get notifications(): ReadonlyMap<string, Value> {
    return this.#notifications;
  }
  notificationsVersion = $state(0);

  // The receipt epoch of the last frame that carried data (self values or AIS targets), zero until
  // one arrives. Connection-only frames do not stamp it, so an open socket delivering nothing lets
  // this age against the clock: the app derives its "Connected, no data" cue from exactly that.
  // Plain like selfContext, not $state: the one consumer re-derives on the 1 Hz clock tick and
  // reads the current value then, and a reactive write here would re-schedule that derived on
  // every flushed data frame (up to 60 a second) for a 30 second threshold.
  lastDataEpoch = 0;

  // Grows as new paths arrive and is never pruned: this is safe because the subscribed path set is
  // finite and stable, so cells reach a fixed size. The one unbounded family, notifications.*, is
  // pruned separately below. A misbehaving server emitting other novel paths every delta would grow
  // this without bound, but that is out of scope for a well-formed stream.
  #cells = new Map<string, PathCell>();

  // The notification paths that have a cell, in creation order, so the oldest can be dropped at the
  // cap without scanning #cells. A dropped cell only loses a resolved notification's last value and
  // its sounding-activation count; the raised set the alert list renders lives in #notifications.
  #notificationCellPaths = new Set<string>();

  // The watch-critical paths whose cells keep a bounded source-transition trace. Opt-in, so the
  // hundreds of untraced paths pay nothing per frame.
  #tracedPaths = new Set<string>();

  traceSources(paths: readonly string[]): void {
    for (const path of paths) this.#tracedPaths.add(path);
  }

  cell(path: string): PathCell {
    let cell = this.#cells.get(path);
    if (!cell) {
      cell = new PathCell();
      this.#cells.set(path, cell);
      if (path.startsWith(NOTIFICATIONS_PREFIX)) this.#trackNotificationCell(path);
    }
    return cell;
  }

  #trackNotificationCell(path: string): void {
    this.#notificationCellPaths.add(path);
    if (this.#notificationCellPaths.size <= MAX_NOTIFICATION_CELLS) return;
    const oldest = this.#notificationCellPaths.values().next();
    if (oldest.done || oldest.value === path) return;
    this.#notificationCellPaths.delete(oldest.value);
    this.#cells.delete(oldest.value);
  }

  // Pre-create the cells a consumer reads. cell() creates a PathCell lazily on first access; if that
  // first access is a reactive template read, the freshly created $state source is not tracked and
  // later updates do not re-render. Pre-creating the fixed path set at construction means every read
  // finds an existing, tracked cell.
  ensureCells(paths: readonly string[]): void {
    for (const path of paths) this.cell(path);
  }

  applyFrame(frame: SKFrame): boolean {
    const generation = frame.generation ?? this.generation;
    // Worker messages are normally ordered, but an old callback can still complete after a client
    // replacement. Never let an older connection generation restore telemetry or connection state.
    if (generation < this.generation) return false;
    if (generation > this.generation) {
      this.generation = generation;
      // Retain values and safety latches for continuity, but force AIS consumers to rebuild and
      // reject path samples whose generation no longer matches.
      this.aisVersion += 1;
      // A reopened socket restarts the data-stall window: the outage itself already had its own
      // cue, so the stalled badge must not fire the instant the stream reopens. Zero still means
      // no data ever arrived.
      if (this.lastDataEpoch > 0) this.lastDataEpoch = frame.epoch;
      // Transitions and samples recorded under the old connection must not feed the source cue or
      // the per-source rows after a reconnect: the new generation starts from the first source it
      // observes.
      for (const path of this.#tracedPaths) {
        const traced = this.#cells.get(path);
        if (traced === undefined) continue;
        if (traced.sourceTrace.length > 0) traced.sourceTrace = [];
        if (traced.sourceSamples !== undefined && traced.sourceSamples.size > 0) {
          traced.sourceSamples.clear();
          traced.sourceSamplesRevision += 1;
        }
      }
    }
    // No first-wins latch: a reconnect can land on a different vessel context (a server restored
    // from another boat's backup, a station repointed at a different server), and the frame's own
    // context is always the current connection's answer.
    if (frame.selfContext) this.selfContext = frame.selfContext;
    if (frame.self.size > 0 || (frame.ais !== undefined && frame.ais.size > 0)) {
      this.lastDataEpoch = frame.epoch;
    }
    for (const [path, value] of frame.self) {
      // Tested once, read twice: this runs per path per flushed frame, and the sounding-activation
      // branch and the mirror ask the same question of the same string.
      const isNotification = path.startsWith(NOTIFICATIONS_PREFIX);
      const cell = this.cell(path);
      if (isNotification && !isSoundingNotification(cell.value) && isSoundingNotification(value)) {
        cell.activation += 1;
      }
      cell.value = value;
      const source = frame.selfSources?.get(path);
      // Assigned only on change: cell.source is $state, and a same-source republish (the common
      // case, every frame, for every path) would otherwise wake every consumer that reads it.
      if (cell.source !== source) cell.source = source;
      const at = frame.selfEpochs?.get(path) ?? frame.epoch;
      if (this.#tracedPaths.has(path)) this.#recordTraced(cell, source, value, at);
      cell.epoch = at;
      cell.generation = generation;
      cell.streamed = true;
      // Any accepted value clears a server stale declaration, null included: the server clears
      // its own record on any accepted delta (a resumed sounder reporting no bottom is live).
      if (cell.serverStale !== undefined) cell.serverStale = undefined;
      if (isNotification) this.#mirrorNotification(path, value);
    }
    if (frame.selfStales) {
      for (const [path, marker] of frame.selfStales) this.#applyStaleMarker(path, marker);
    }
    if (frame.ais) {
      // Whether any path carried a value different from the one already mirrored. A target at
      // anchor republishes the same position on its own schedule, and every version bump makes the
      // list, the collision assessment, and the traffic overlays rebuild and re-clone the whole
      // fleet. Freshness still advances on an identical republish (the epoch is what keeps the
      // target from aging out), so only the value comparison gates the bump.
      let changed = false;
      for (const [context, incoming] of frame.ais) {
        let target = this.#aisTargets.get(context);
        if (!target) {
          target = {
            values: new Map(),
            epochs: new Map(),
            generations: new Map(),
            lastUpdate: frame.epoch,
            revision: 0,
          };
          this.#aisTargets.set(context, target);
          changed = true;
        }
        let targetChanged = false;
        // One Map lookup for the whole target rather than one per path: aisEpochs is keyed by
        // context, and a target reports a dozen paths a frame.
        const contextEpochs = frame.aisEpochs?.get(context);
        for (const [path, value] of incoming) {
          const receivedAt = contextEpochs?.get(path) ?? frame.epoch;
          const previous = target.values.get(path);
          targetChanged ||=
            (previous === undefined && !target.values.has(path)) ||
            target.generations.get(path) !== generation ||
            !sameJsonValue(previous, value);
          target.values.set(path, value);
          target.epochs.set(path, receivedAt);
          target.generations.set(path, generation);
          target.lastUpdate = Math.max(target.lastUpdate, receivedAt);
        }
        if (targetChanged) target.revision += 1;
        changed ||= targetChanged;
      }
      if (changed) this.aisVersion += 1;
    }
    // The worker sends a fresh connection object on every frame; assigning it unconditionally
    // would re-run every connection-derived consumer once per animation frame.
    const incoming = frame.connection;
    if (incoming.phase !== this.connection.phase || incoming.attempt !== this.connection.attempt) {
      this.connection = incoming;
    }
    return true;
  }

  // Record a traced path's source-transition trace and per-source sample. The source is passed
  // rather than read back off cell.source, so the per-frame path pays no reactive getter.
  #recordTraced(cell: PathCell, source: PathSource | undefined, value: Value, at: number): void {
    // The trace compares against its own last label, not cell.source: a frame that carries no
    // source metadata clears cell.source, and the same source reappearing must stay quiet rather
    // than read as a handoff.
    const label = source?.label;
    if (label !== undefined && label !== cell.sourceTrace.at(-1)?.label) {
      const trace = [...cell.sourceTrace, { label, epoch: at }];
      cell.sourceTrace = trace.length > MAX_SOURCE_TRACE ? trace.slice(-MAX_SOURCE_TRACE) : trace;
    }
    // Samples key by the per-device ref, falling back to the bus label for a source-object-only
    // producer; a device on such a producer cannot be told apart from its bus mates.
    const key = source?.ref ?? label;
    if (key === undefined) return;
    let samples = cell.sourceSamples;
    if (samples === undefined) {
      samples = new Map();
      cell.sourceSamples = samples;
    }
    const existing = samples.get(key);
    if (existing !== undefined) {
      existing.value = value;
      existing.epoch = at;
      return;
    }
    if (samples.size >= MAX_SOURCES_PER_PATH) {
      // Least-recently-heard eviction, scanned only at the cap. evictOldestKey drops the
      // insertion-order oldest instead, which is wrong once in-place updates refresh recency.
      let oldestKey: string | undefined;
      let oldestEpoch = Number.POSITIVE_INFINITY;
      for (const [candidate, sample] of samples) {
        if (sample.epoch < oldestEpoch) {
          oldestEpoch = sample.epoch;
          oldestKey = candidate;
        }
      }
      if (oldestKey !== undefined) samples.delete(oldestKey);
    }
    samples.set(key, { value, epoch: at });
    cell.sourceSamplesRevision += 1;
  }

  // Apply one server stale declaration. Staleness is declared per SOURCE (the enforcer keys
  // context, path, and $source), so a declaration for a source that is not the cell's current one
  // must not mark the whole path: on a dual-GPS boat the dead unit's timeout arrives while the
  // live unit keeps publishing. When the same frame carried the live source's value, the self
  // loop has already applied it, so the ref comparison below sees the surviving source and skips.
  // The marker never touches source, epoch, generation, streamed, or sourceTrace: a declaration
  // is not data, and the seed below fills only a cell that never held a value.
  #applyStaleMarker(path: string, marker: PathStaleMarker): void {
    const cell = this.cell(path);
    const currentRef = cell.source?.ref;
    if (
      currentRef !== undefined &&
      marker.sourceRef !== undefined &&
      currentRef !== marker.sourceRef
    ) {
      // A different source than the cell's current one went quiet: the path stays live, and only
      // that source's per-source sample is retired.
      if (cell.sourceSamples?.delete(marker.sourceRef)) cell.sourceSamplesRevision += 1;
      return;
    }
    // Prefer the client's own receipt clock when it streamed the value itself; the marker's
    // parsed provider timestamp covers only the never-streamed replay case.
    const lastValueEpoch = cell.epoch > 0 ? cell.epoch : marker.lastValue?.epoch;
    // A replayed declaration (reconnect, cache bootstrap) rebuilds an equivalent record; skip the
    // write so it does not invalidate every staleness consumer for nothing.
    const previous = cell.serverStale;
    if (
      previous !== undefined &&
      previous.sourceRef === marker.sourceRef &&
      previous.lastValueEpoch === lastValueEpoch
    ) {
      return;
    }
    const record: ServerStaleRecord = {};
    if (marker.sourceRef !== undefined) record.sourceRef = marker.sourceRef;
    if (lastValueEpoch !== undefined) record.lastValueEpoch = lastValueEpoch;
    // Seed a never-streamed cell from the declaration's last good value (a late subscriber whose
    // cache replay holds only the staleness shape), leaving epoch at zero so nothing reads it as
    // a stream-aged update.
    if (cell.value === undefined && marker.lastValue !== undefined) {
      cell.value = marker.lastValue.value;
    }
    cell.serverStale = record;
  }

  // A null value or one without a state string is a cleared notification (raw v1 producers
  // publish null to clear); it leaves the mirror so only raised notifications are listed.
  #mirrorNotification(path: string, value: Value): void {
    // A cleared, normal, or nominal notification leaves the mirror rather than accumulating in
    // it: the alert list only ever shows raised states, and servers can republish normal-state
    // values every cycle for telemetry paths under notifications.*.
    if (!isRaisedNotificationValue(value)) {
      if (this.#notifications.delete(path)) this.notificationsVersion += 1;
      return;
    }
    // Bump only on a real change: a persistent alarm republished identically every delta cycle
    // must not rebuild every consumer's list per frame. State, message, id, position, method,
    // createdAt, and the status fields carry everything the list and the audible gate read.
    const previous = this.#notifications.get(path);
    if (previous && typeof previous === 'object' && typeof value === 'object' && value) {
      const a = previous as {
        state?: unknown;
        message?: unknown;
        id?: unknown;
        position?: unknown;
        method?: unknown;
        createdAt?: unknown;
        status?: Flags;
      };
      const b = value as {
        state?: unknown;
        message?: unknown;
        id?: unknown;
        position?: unknown;
        method?: unknown;
        createdAt?: unknown;
        status?: Flags;
      };
      if (
        a.state === b.state &&
        a.message === b.message &&
        a.id === b.id &&
        a.createdAt === b.createdAt &&
        samePosition(a.position, b.position) &&
        // The delivery-method list feeds the audible gate, so escalating ['visual'] to
        // ['visual', 'sound'] is a real change; sameJsonValue's array compare is order-sensitive,
        // which is the cheap direction (a reordered list re-renders, never goes missed).
        sameJsonValue(a.method, b.method) &&
        sameFlags(a.status, b.status)
      ) {
        // Structurally identical to the stored value: leave the mirror untouched. Re-storing the
        // fresh-but-equal object would write the Map every delta cycle for a persistent alarm.
        return;
      }
    }
    if (!previous && !this.#admitNewNotification(value)) return;
    this.#notifications.set(path, value);
    this.notificationsVersion += 1;
  }

  // Whether a notification path Binnacle is not already mirroring may be added. Resolved
  // notifications already leave the mirror, but nothing bounded the number of distinct paths a
  // server can hold raised at once, so a buggy or hostile producer could grow memory and the
  // list's per-change sort without limit. At the cap a newcomer is admitted only by displacing a
  // strictly less severe entry, so an emergency always gets in and a flood of low-grade alerts
  // cannot crowd one out. Only reached once the cap is hit, which a well-formed server never does.
  #admitNewNotification(value: Value): boolean {
    if (this.#notifications.size < MAX_MIRRORED_NOTIFICATIONS) return true;
    const rank = notificationSeverityRank(value);
    if (rank === undefined) return false;
    let worstPath: string | undefined;
    let worstRank = rank;
    for (const [candidatePath, candidate] of this.#notifications) {
      const candidateRank = notificationSeverityRank(candidate) ?? Number.POSITIVE_INFINITY;
      if (candidateRank > worstRank) {
        worstRank = candidateRank;
        worstPath = candidatePath;
      }
    }
    if (worstPath === undefined) return false;
    this.#notifications.delete(worstPath);
    return true;
  }

  // Drop mirrored notifications the server no longer holds raised, from a REST snapshot taken on
  // the reconnect edge. Deltas are the only other removal path, and a notification cleared or
  // reaped while the socket was down never sends one, so without this the alert list shows a
  // raised alarm the server has forgotten for the rest of the session. The caller passes the full
  // set of currently raised paths and the epoch it requested the snapshot at; a failed snapshot
  // fetch must not reach here at all, so the fail-safe direction (keep alarms on doubt) stays
  // with the caller.
  // Restore or repair one mirrored notification from the same reconnect snapshot: a raise or a
  // status change (a silence, an acknowledgment, the v2 id) that happened while the socket was
  // down sends no delta on the new connection when the producer is transition-only. The same
  // freshness rule as the deletion pass applies: a streamed value at or after the snapshot
  // outranks it. Cells are not created here; the notification family is unbounded and only the
  // path-keyed mirror carries it, but an existing cell (the anchor drag grade reads one) gets
  // the restored value, mirroring how the deletion pass writes the clearing null.
  upsertReconciledNotification(path: string, value: Value, snapshotEpoch: number): void {
    const cell = this.#cells.get(path);
    if (cell?.streamed && cell.epoch >= snapshotEpoch) return;
    this.#mirrorNotification(path, value);
    if (cell !== undefined) cell.value = value;
  }

  reconcileNotifications(paths: ReadonlySet<string>, snapshotEpoch: number): void {
    let changed = false;
    for (const path of this.#notifications.keys()) {
      if (paths.has(path)) continue;
      // A delta that arrived at or after the snapshot request outranks it: in that race the
      // snapshot is the stale party, and deleting the fresh raise would silently drop a live
      // alarm no later delta restores (transition-only producers never republish).
      const cell = this.#cells.get(path);
      if (cell?.streamed && cell.epoch >= snapshotEpoch) continue;
      this.#notifications.delete(path);
      changed = true;
      // The keyed cells feed their own consumers (the anchor drag grade reads the raw cell), so
      // a reaped notification must clear there too, or the anchor strip alarms forever while
      // the alert list shows nothing. Mimic the clearing delta the server never sent.
      if (cell !== undefined && isRaisedNotificationValue(cell.value)) cell.value = null;
    }
    if (changed) this.notificationsVersion += 1;
  }

  pruneAis(now: number, ttlMs: number): number {
    let removed = 0;
    for (const [context, target] of this.#aisTargets) {
      if (now - target.lastUpdate > ttlMs) {
        this.#aisTargets.delete(context);
        removed += 1;
      }
    }
    if (removed > 0) this.aisVersion += 1;
    return removed;
  }

  pruneAisPaths(paths: readonly string[], now: number, ttlMs: number): number {
    let removed = 0;
    for (const target of this.#aisTargets.values()) {
      for (const path of paths) {
        const epoch = target.epochs.get(path);
        if (epoch === undefined || now - epoch <= ttlMs) continue;
        target.values.delete(path);
        target.epochs.delete(path);
        target.generations.delete(path);
        removed += 1;
      }
    }
    if (removed > 0) this.aisVersion += 1;
    return removed;
  }
}
