import * as Comlink from 'comlink';
import type { Context, Delta, Path, SignalKClientApi, SKFrame, SubscribeEntry } from './types';
import { WorkerCore } from './worker-core';

class SignalKWorker implements SignalKClientApi {
  #core = new WorkerCore();

  async connect(url: string, onFrame: (frame: SKFrame) => void): Promise<void> {
    this.#core.connect(url, onFrame);
  }

  async setUrl(url: string): Promise<void> {
    this.#core.setUrl(url);
  }

  async subscribe(entries: SubscribeEntry[]): Promise<void> {
    this.#core.subscribe(entries);
  }

  async unsubscribe(paths: Path[], context?: Context): Promise<void> {
    this.#core.unsubscribe(paths, context);
  }

  async publish(delta: Delta): Promise<void> {
    this.#core.publish(delta);
  }

  async reconnect(): Promise<void> {
    this.#core.reconnect();
  }

  async disconnect(): Promise<void> {
    this.#core.disconnect();
  }
}

Comlink.expose(new SignalKWorker());
