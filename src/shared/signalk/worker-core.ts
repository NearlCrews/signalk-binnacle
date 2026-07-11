import * as Comlink from 'comlink';
import { FrameBatcher } from './batcher';
import { SkConnection } from './connection';
import { reconcileDelta } from './reconcile';
import { SubscriptionRegistry } from './subscription-registry';
import {
  type ConnectionState,
  type Context,
  type Delta,
  INITIAL_CONNECTION_STATE,
  type Path,
  type PathSource,
  SELF_CONTEXT,
  type SKFrame,
  type SubscribeEntry,
  type Value,
} from './types';

// The hello handshake carries the self identifier; the rest of a frame is a Delta. Widen the parse
// to read that one optional field without a named one-field interface.
type DeltaOrHello = Delta & { self?: string };

type FrameCallback = ((frame: SKFrame) => void) & { [Comlink.releaseProxy]?: () => void };

export class WorkerCore {
  #connection?: SkConnection;
  // Constructed with the core, not per connect(): a feature controller restoring persisted state
  // (the instrument dock) subscribes BEFORE the stream connects, and a per-connect registry made
  // that a silent no-op and dropped every demand subscription on reconnect. The send closure reads
  // the connection lazily, and resubscribeAll on every open replays whatever registered early.
  #registry = new SubscriptionRegistry((message) => this.#connection?.send(message));
  #batcher = new FrameBatcher();
  #onFrame?: FrameCallback;
  #connectionState: ConnectionState = INITIAL_CONNECTION_STATE;
  #selfContext?: string;

  connect(url: string, onFrame: (frame: SKFrame) => void): void {
    // Release the previous connect()'s callback proxy before replacing it, so a page that calls
    // connect() again (a remount, a fresh reconnect flow) does not leak a MessagePort. Mirrors
    // RadarWorker#teardown's release of its own callback proxies in radar-worker.ts.
    this.#onFrame?.[Comlink.releaseProxy]?.();
    this.#onFrame = onFrame as FrameCallback;
    this.#connection = new SkConnection(url, {
      onState: (state) => {
        this.#connectionState = state;
        // Push the new phase to the store immediately, not piggybacked on the next data frame. A
        // dropped socket produces no data, so without this the batcher (which only flushes when a
        // value buffered) never delivers the reconnecting or closed phase and the connection badge
        // keeps reading "Connected" through the whole outage. An empty-self frame just updates the
        // connection field; it stamps no cells and bumps no AIS version.
        this.#onFrame?.({ self: new Map(), connection: state, epoch: Date.now() });
      },
      onDelta: (raw) => this.#ingest(raw),
      onOpen: () => this.#registry.resubscribeAll(),
    });
    this.#batcher.onFlush = (self, ais, epoch, selfSources) => {
      this.#onFrame?.({
        self,
        selfSources,
        ais,
        connection: this.#connectionState,
        epoch,
        selfContext: this.#selfContext,
      });
    };
    this.#connection.connect();
  }

  subscribe(entries: SubscribeEntry[]): void {
    this.#registry.add(entries);
  }

  unsubscribe(paths: Path[], context?: Context): void {
    this.#registry.remove(paths, context);
  }

  // Send a client delta to the server. The connection drops the send when the socket is not
  // open. Unlike subscriptions, a published delta has no transport-level replay on reconnect,
  // so a delta sent mid-reconnect is lost until the producer next publishes a changed value.
  publish(delta: Delta): void {
    this.#connection?.send(delta);
  }

  // Reconnect immediately, resetting the backoff. SkConnection.connect drops any pending reconnect
  // timer and the old socket, so calling it while down skips the remaining backoff delay; the
  // subscription registry resubscribes everything on open. A no-op before the first connect.
  reconnect(): void {
    this.#connection?.connect();
  }

  disconnect(): void {
    // Drop any flush the batcher had scheduled before tearing the socket down, so a queued frame
    // cannot fire into the store after disconnect and leave the worker non-idempotent.
    this.#batcher.reset();
    this.#connection?.disconnect();
  }

  #isSelf(context: string): boolean {
    return context === SELF_CONTEXT || context === this.#selfContext;
  }

  // One routing callback for the life of the core, not a fresh closure per #ingest: reconciling
  // runs on the hottest path, once per incoming delta frame.
  #route = (context: Context, path: Path, value: Value, source?: PathSource): void => {
    if (this.#isSelf(context)) {
      this.#batcher.put(path, value, source);
    } else {
      this.#batcher.putVessel(context, path, value);
    }
  };

  #ingest(raw: string): void {
    let message: DeltaOrHello;
    try {
      message = JSON.parse(raw) as DeltaOrHello;
    } catch {
      // A malformed frame indicates a real server or transport fault. Log it in dev
      // and drop it: one bad frame must not tear down the stream.
      if (import.meta.env?.DEV) console.warn('[signalk] dropped a malformed delta frame');
      return;
    }
    if (!message.updates) {
      // The hello handshake carries the self identifier but no updates. A Signal K server always
      // sends hello first on /signalk/v1/stream, so #selfContext is set before any vessels.<self>
      // delta arrives. If that ordering were ever violated, a self delta would be misrouted into the
      // AIS bucket under its own urn and only cleared after the AIS TTL; we rely on the hello-first
      // contract rather than reconciling it.
      if (typeof message.self === 'string') this.#selfContext = message.self;
      return;
    }
    reconcileDelta(message, this.#route);
  }
}
