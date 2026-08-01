import * as Comlink from 'comlink';
import { RadarFlushGate } from './radar-flush-gate';
import { type RadarFrame, RadarFrameCore } from './radar-frame-core';
import { MAX_RADAR_MESSAGE_BYTES } from './radar-limits';
import type { RadarStreamStatus } from './radar-worker-client';

type Releasable = { [Comlink.releaseProxy]?: () => void };

class RadarWorker {
  #socket: WebSocket | undefined;
  #timer = 0;
  // The current stream's frame core, kept so recycle() can return spent transfer buffers to its
  // pool. Replaced on each open(); a late recycle against the wrong core is dropped by its size
  // guard.
  #core: RadarFrameCore | undefined;
  // The Comlink callback proxies for the current open(), released on the next open() or on close() so
  // their MessagePorts do not accumulate across radar switches.
  #callbacks: Releasable[] = [];
  // Backpressure: pauses the flush loop while the main thread is behind on the frames already sent.
  readonly #flushGate = new RadarFlushGate();

  #stopTimer(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = 0;
    }
  }

  #teardown(): void {
    this.#stopTimer();
    this.#flushGate.reset();
    if (this.#socket) {
      // Detach the handlers before closing so an intentional teardown (a new open() or a close()) does
      // not fire onStatus('closed'), which the controller would map to an error and flash on the panel.
      this.#socket.onopen = null;
      this.#socket.onmessage = null;
      this.#socket.onerror = null;
      this.#socket.onclose = null;
      this.#socket.close();
      this.#socket = undefined;
    }
    for (const cb of this.#callbacks) cb[Comlink.releaseProxy]?.();
    this.#callbacks = [];
  }

  async open(
    url: string,
    spokesPerRev: number,
    maxSpokeLen: number,
    initialRange: number,
    flushHz: number,
    onFrame: (frame: RadarFrame) => void,
    onStatus: (status: RadarStreamStatus) => void,
  ): Promise<void> {
    this.#teardown();
    if (!Number.isFinite(flushHz) || flushHz < 1 || flushHz > 15) {
      throw new RangeError('invalid radar flush rate');
    }
    this.#callbacks = [onFrame as Releasable, onStatus as Releasable];
    const core = new RadarFrameCore(spokesPerRev, maxSpokeLen, initialRange);
    this.#core = core;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.warn('[marine-radar] could not open spokes WebSocket', error);
      onStatus('error');
      throw error;
    }
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => onStatus('open');
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) {
        console.warn('[marine-radar] ignoring a non-binary stream message');
        return;
      }
      if (event.data.byteLength > MAX_RADAR_MESSAGE_BYTES) {
        console.warn('[marine-radar] ignoring an oversized stream message');
        return;
      }
      try {
        // hasData flips only once a message actually decodes to >= 1 spoke, so a stream of undecodable
        // or empty messages never starts flushing and the controller never reports a false "live".
        core.ingest(new Uint8Array(event.data));
      } catch (error) {
        // One malformed or truncated frame must not kill the stream: drop it and keep integrating.
        console.warn('[marine-radar] dropped a malformed radar frame', error);
      }
    };
    socket.onerror = (event) => {
      console.warn('[marine-radar] spokes WebSocket error', event);
      onStatus('error');
    };
    socket.onclose = () => {
      this.#stopTimer();
      onStatus('closed');
    };
    this.#socket = socket;
    // A worker-thread interval, never requestAnimationFrame, so a backgrounded tab keeps sweeping. The
    // flush is skipped until the first message decodes to a real spoke; each flushed frame carries the
    // spoke count since the last flush so the controller can tell painting from connected-but-no-data.
    this.#timer = setInterval(
      () => {
        if (!core.hasPendingSpokes) return;
        // Hold the sweep here rather than queueing another frame the renderer has not asked for.
        // Spokes keep integrating into the accumulator either way.
        if (!this.#flushGate.ready) return;
        const frame = core.flush();
        this.#flushGate.onFlush();
        onFrame(Comlink.transfer(frame, [frame.buffer]));
      },
      Math.max(1, Math.round(1000 / flushHz)),
    );
  }

  // Take back a spent transfer buffer from the main thread so the next flush reuses it. This is
  // also the flush credit: returning a buffer is what proves the renderer consumed a frame.
  async recycle(buffer: ArrayBuffer): Promise<void> {
    this.#flushGate.onConsumed();
    this.#core?.recycle(buffer);
  }

  async close(): Promise<void> {
    this.#teardown();
    this.#core = undefined;
  }
}

Comlink.expose(new RadarWorker());
