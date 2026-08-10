import { fullJitterDelay } from './backoff';
import { appendQuery } from './origin';
import type { ConnectionPhase, ConnectionState } from './types';

interface ConnectionHandlers {
  onState: (state: ConnectionState) => void;
  onDelta: (raw: string) => void;
  onOpen?: () => void;
}

export class SkConnection {
  #url: string;
  #handlers: ConnectionHandlers;
  #ws?: WebSocket;
  #attempt = 0;
  #stopped = false;
  #reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(url: string, handlers: ConnectionHandlers) {
    this.#url = url;
    this.#handlers = handlers;
  }

  connect(): void {
    this.#stopped = false;
    // Drop any pending reconnect and any prior socket before opening a new one, so a manual
    // reconnect cannot leak the old socket or let a queued reconnect fire a duplicate connect.
    // The old socket's onclose is gated on still being the current #ws, so it stays quiet.
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#ws?.close();
    this.#emit('connecting');
    const ws = new WebSocket(appendQuery(this.#url, 'subscribe', 'none'));
    this.#ws = ws;
    // Gate every handler on still being the current socket, so a superseded socket (after a
    // reconnect) cannot inject a delta or schedule a second reconnect from its stale closures.
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#attempt = 0;
      this.#emit('open');
      this.#handlers.onOpen?.();
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this.#ws === ws) this.#handlers.onDelta(event.data as string);
    };
    ws.onclose = () => {
      if (this.#ws !== ws || this.#stopped) return;
      this.#scheduleReconnect();
    };
    ws.onerror = () => {
      if (this.#ws === ws) ws.close();
    };
  }

  // Swap the URL the next connect() call opens. The live socket is left alone: reconnect attempts
  // reopen from the stored URL, so this is how a changed auth token reaches a later reconnect.
  setUrl(url: string): void {
    this.#url = url;
  }

  send(message: unknown): void {
    // The socket may still be CONNECTING when the first subscriptions arrive.
    // Dropping the send is safe: the registry resubscribes everything on open.
    if (this.#ws?.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(message));
  }

  disconnect(): void {
    this.#stopped = true;
    // Reset the backoff so a later reconnect starts from the first delay, not the stale attempt
    // count of the prior session (onopen also zeroes it, but only once a socket actually opens).
    this.#attempt = 0;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    // Only emit 'closed' when a socket actually existed, so a disconnect before any connect does
    // not report a close that never had an open. Null the socket after closing so a repeat
    // disconnect is a no-op rather than emitting a second 'closed'.
    const had = this.#ws !== undefined;
    this.#ws?.close();
    this.#ws = undefined;
    if (had) this.#emit('closed');
  }

  #scheduleReconnect(): void {
    this.#emit('reconnecting');
    const delay = fullJitterDelay(this.#attempt);
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      if (!this.#stopped) this.connect();
    }, delay);
  }

  #emit(phase: ConnectionPhase): void {
    this.#handlers.onState({ phase, attempt: this.#attempt });
  }
}
