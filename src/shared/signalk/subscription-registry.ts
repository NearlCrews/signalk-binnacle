import {
  type Context,
  type Path,
  SELF_CONTEXT,
  type SubscribeEntry,
  type SubscribePolicy,
} from './types';

const DEFAULT_PERIOD = 1000;
// signalk-server supports only 'instant' and 'fixed' (it warns and ignores anything else), so the
// default is a supported value. Every production subscription sets policy explicitly regardless.
const DEFAULT_POLICY: SubscribePolicy = 'instant';

interface Resolved {
  context: Context;
  path: Path;
  period: number;
  minPeriod?: number;
  policy: SubscribePolicy;
}

interface Demand {
  count: number;
  entry: Resolved;
}

interface SubscribeMessage {
  path: string;
  policy: SubscribePolicy;
  period?: number;
  minPeriod?: number;
}

export class SubscriptionRegistry {
  #demand = new Map<string, Demand>();
  #send: (message: unknown) => void;

  constructor(send: (message: unknown) => void) {
    this.#send = send;
  }

  add(entries: SubscribeEntry[]): () => void {
    const keys: string[] = [];
    for (const entry of entries) {
      const resolved = this.#resolve(entry);
      const key = `${resolved.context}|${resolved.path}`;
      const existing = this.#demand.get(key);
      if (existing) {
        existing.count += 1;
        // The first subscriber's parameters stand for the key's lifetime; a differing later
        // demand is silently coalesced, so flag it in dev where it is a real mistake.
        if (
          import.meta.env?.DEV &&
          (existing.entry.period !== resolved.period ||
            existing.entry.minPeriod !== resolved.minPeriod ||
            existing.entry.policy !== resolved.policy)
        ) {
          console.warn(
            `[signalk] subscription ${key} is already active with different parameters; the new period, minPeriod, or policy is ignored`,
          );
        }
      } else {
        this.#demand.set(key, { count: 1, entry: resolved });
        this.#sendSubscribe(resolved);
      }
      keys.push(key);
    }
    // The release closure is deliberate API surface for future per-feature subscriptions: today
    // only tests exercise it (Comlink cannot return a closure across the worker boundary, so
    // production removal flows through remove()).
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#release(keys);
    };
  }

  // Drop demand by path and context, the same refcounted accounting as the closure
  // returned by add(). The worker core routes unsubscribe through here so a dropped
  // path also leaves #demand and is not resurrected by resubscribeAll on reconnect.
  remove(paths: Path[], context?: Context): void {
    const ctx = context ?? SELF_CONTEXT;
    this.#release(paths.map((path) => `${ctx}|${path}`));
  }

  resubscribeAll(): void {
    // Batch by context so a reconnect re-sends one subscribe message per context, not one per path.
    const byContext = new Map<Context, SubscribeMessage[]>();
    for (const { entry } of this.#demand.values()) {
      const list = byContext.get(entry.context);
      if (list) list.push(this.#subscription(entry));
      else byContext.set(entry.context, [this.#subscription(entry)]);
    }
    for (const [context, subscribe] of byContext) this.#send({ context, subscribe });
  }

  #release(keys: string[]): void {
    let removed = false;
    for (const key of keys) removed = this.#drop(key) || removed;
    if (!removed) return;
    // Stock Signal K only supports removing every subscription on this socket. Replace the
    // complete demand set once per release, preserving the surviving contexts and parameters.
    this.#send({ context: '*', unsubscribe: [{ path: '*' }] });
    this.resubscribeAll();
  }

  #drop(key: string): boolean {
    const demand = this.#demand.get(key);
    if (!demand) return false;
    demand.count -= 1;
    if (demand.count > 0) return false;
    this.#demand.delete(key);
    return true;
  }

  #resolve(entry: SubscribeEntry): Resolved {
    return {
      context: entry.context ?? SELF_CONTEXT,
      path: entry.path,
      period: entry.period ?? DEFAULT_PERIOD,
      minPeriod: entry.minPeriod,
      policy: entry.policy ?? DEFAULT_POLICY,
    };
  }

  // Build the wire message to match what the server's subscription manager accepts: 'fixed' is
  // driven by period, 'instant' by minPeriod. Sending period with an 'instant' policy makes the
  // server log "period assumes policy 'fixed'", so each policy carries only its own throttle field.
  #subscription(entry: Resolved): SubscribeMessage {
    const msg: SubscribeMessage = { path: entry.path, policy: entry.policy };
    if (entry.policy === 'fixed') msg.period = entry.period;
    else if (entry.minPeriod !== undefined) msg.minPeriod = entry.minPeriod;
    return msg;
  }

  #sendSubscribe(entry: Resolved): void {
    this.#send({ context: entry.context, subscribe: [this.#subscription(entry)] });
  }
}
