import type { AisTargetState, ConnectionState, PathSource, SKFrame, Value } from './types';
import {
  INITIAL_CONNECTION_STATE,
  isSoundingNotification,
  NOTIFICATIONS_PREFIX,
  notificationState,
} from './types';

// The four v2 status flags the alert list renders, so the notification dedup compares them field by
// field; serializing the status object would allocate per delta for active alarms. canClear is
// intentionally omitted: Binnacle renders no clear affordance, so a canClear-only change should not
// bump the version.
type Flags =
  | { silenced?: unknown; acknowledged?: unknown; canSilence?: unknown; canAcknowledge?: unknown }
  | undefined;
function sameFlags(a: Flags, b: Flags): boolean {
  return (
    a?.silenced === b?.silenced &&
    a?.acknowledged === b?.acknowledged &&
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

  // Grows as new paths arrive and is never pruned: this is safe because the subscribed path set is
  // finite and stable, so cells reach a fixed size. A misbehaving server emitting novel paths every
  // delta would grow this without bound, but that is out of scope for a well-formed stream.
  #cells = new Map<string, PathCell>();

  cell(path: string): PathCell {
    let cell = this.#cells.get(path);
    if (!cell) {
      cell = new PathCell();
      this.#cells.set(path, cell);
    }
    return cell;
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
    }
    if (!this.selfContext && frame.selfContext) this.selfContext = frame.selfContext;
    for (const [path, value] of frame.self) {
      const cell = this.cell(path);
      if (
        path.startsWith(NOTIFICATIONS_PREFIX) &&
        !isSoundingNotification(cell.value) &&
        isSoundingNotification(value)
      ) {
        cell.activation += 1;
      }
      cell.value = value;
      cell.source = frame.selfSources?.get(path);
      cell.epoch = frame.selfEpochs?.get(path) ?? frame.epoch;
      cell.generation = generation;
      cell.streamed = true;
      if (path.startsWith(NOTIFICATIONS_PREFIX)) this.#mirrorNotification(path, value);
    }
    if (frame.ais) {
      for (const [context, incoming] of frame.ais) {
        let target = this.#aisTargets.get(context);
        if (!target) {
          target = {
            values: new Map(),
            epochs: new Map(),
            generations: new Map(),
            lastUpdate: frame.epoch,
          };
          this.#aisTargets.set(context, target);
        }
        for (const [path, value] of incoming) {
          const receivedAt = frame.aisEpochs?.get(context)?.get(path) ?? frame.epoch;
          target.values.set(path, value);
          target.epochs.set(path, receivedAt);
          target.generations.set(path, generation);
          target.lastUpdate = Math.max(target.lastUpdate, receivedAt);
        }
      }
      // Bump only when a context actually updated. The worker emits an `ais` Map on every frame
      // (empty when only self moved), so guarding on size keeps the version stable when nothing
      // moved and the consumers' version guards still hold.
      if (frame.ais.size > 0) this.aisVersion += 1;
    }
    // The worker sends a fresh connection object on every frame; assigning it unconditionally
    // would re-run every connection-derived consumer once per animation frame.
    const incoming = frame.connection;
    if (incoming.phase !== this.connection.phase || incoming.attempt !== this.connection.attempt) {
      this.connection = incoming;
    }
    return true;
  }

  // A null value or one without a state string is a cleared notification (raw v1 producers
  // publish null to clear); it leaves the mirror so only raised notifications are listed.
  #mirrorNotification(path: string, value: Value): void {
    const state = notificationState(value);
    // A cleared, normal, or nominal notification leaves the mirror rather than accumulating in
    // it: the alert list only ever shows raised states, and servers can republish normal-state
    // values every cycle for telemetry paths under notifications.*.
    if (typeof state !== 'string' || state === 'normal' || state === 'nominal') {
      if (this.#notifications.delete(path)) this.notificationsVersion += 1;
      return;
    }
    // Bump only on a real change: a persistent alarm republished identically every delta cycle
    // must not rebuild every consumer's list per frame. State, message, id, position, and the four
    // status flags carry everything the list renders.
    const previous = this.#notifications.get(path);
    if (previous && typeof previous === 'object' && typeof value === 'object' && value) {
      const a = previous as {
        state?: unknown;
        message?: unknown;
        id?: unknown;
        position?: unknown;
        status?: Flags;
      };
      const b = value as {
        state?: unknown;
        message?: unknown;
        id?: unknown;
        position?: unknown;
        status?: Flags;
      };
      if (
        a.state === b.state &&
        a.message === b.message &&
        a.id === b.id &&
        samePosition(a.position, b.position) &&
        sameFlags(a.status, b.status)
      ) {
        // Structurally identical to the stored value: leave the mirror untouched. Re-storing the
        // fresh-but-equal object would write the Map every delta cycle for a persistent alarm.
        return;
      }
    }
    this.#notifications.set(path, value);
    this.notificationsVersion += 1;
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
