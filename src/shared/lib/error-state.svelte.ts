// A feature controller's error message: cleared before a mutating action runs and flagged on
// failure, kept on screen until the panel dismisses it or the next action clears it. Collapses the
// clear-then-set-on-failure shape that route, waypoint, and track controllers each hand-rolled.
export class ErrorState {
  #message = $state<string | undefined>();

  get message(): string | undefined {
    return this.#message;
  }

  flag(message: string): void {
    this.#message = message;
  }

  clear(): void {
    this.#message = undefined;
  }
}
