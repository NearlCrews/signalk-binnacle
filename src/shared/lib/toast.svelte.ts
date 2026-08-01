// A transient message that survives the panel that raised it closing: a failed save, activate,
// stop, or delete that would otherwise vanish with the panel's local ErrorState the moment its
// panel unmounts. Auto-clears after a duration generous enough to actually read, mirroring the
// menu's blocked-tile note idiom (a state plus a reset timer). One instance is shared app-wide,
// rendered once outside any panel, so it is the right home for a failure a controller wants seen
// even if the user has already moved on to something else.
//
// This is a failure channel, not a general notification one: every message it carries is a write
// that was refused, an action that could not start, or a limit that was hit. The banner is styled
// and announced as an alert on that basis. A future informational message does not belong here
// without giving the banner a severity and a matching live-region role.
const DEFAULT_TOAST_MS = 8000;

export class Toast {
  #message = $state<string | undefined>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  get message(): string | undefined {
    return this.#message;
  }

  show(message: string, ms = DEFAULT_TOAST_MS): void {
    clearTimeout(this.#timer);
    this.#message = message;
    this.#timer = setTimeout(() => {
      this.#message = undefined;
    }, ms);
  }

  clear(): void {
    clearTimeout(this.#timer);
    this.#message = undefined;
  }

  dispose(): void {
    clearTimeout(this.#timer);
  }
}
