// How many transferred frames may be awaiting the main thread before flushes pause. Two matches the
// recycle pool's depth: one frame the renderer is holding, one crossing the channel.
const MAX_OUTSTANDING_FRAMES = 2;

// Backpressure for the radar worker's flush loop. Without it the interval transfers a frame every
// tick whether or not the previous one was consumed, so a laggy main thread grows the message queue
// without bound (a full frame buffer each), empties the recycle pool, and forces a fresh allocation
// per flush. The picture is never lost by pausing: the accumulator persists per angle, so the next
// allowed flush carries everything that arrived meanwhile.
//
// The credit signal is the recycle channel, since a returned buffer is the only proof the renderer
// actually consumed a frame.
export class RadarFlushGate {
  #outstanding = 0;
  readonly #max: number;

  constructor(max: number = MAX_OUTSTANDING_FRAMES) {
    this.#max = max;
  }

  get outstanding(): number {
    return this.#outstanding;
  }

  // Whether another frame may be transferred right now.
  get ready(): boolean {
    return this.#outstanding < this.#max;
  }

  onFlush(): void {
    this.#outstanding += 1;
  }

  // Floored at zero so a stray recycle (one from a previous stream, arriving after reset) cannot
  // mint credit and defeat the backpressure.
  onConsumed(): void {
    this.#outstanding = Math.max(0, this.#outstanding - 1);
  }

  reset(): void {
    this.#outstanding = 0;
  }
}
