// Serialize a controller's mutating actions against one busy flag, so a second tap while a write is
// in flight is dropped rather than racing it. The idiom (guard, set, try/finally clear) was spelled
// by hand in five controllers; a hand-rolled copy is one `finally` away from latching busy forever.
//
// Generic over the result so an action that reports success (a save whose form must stay open on
// failure) keeps reporting it. `dropped` is what a call resolves to when another action is already
// running, so the wrapper's return type stays the action's own and no wiring site has to normalize
// a sentinel: for a save, a dropped call did not save, so pass `false`. The default is `undefined`,
// which is the whole value for a void action and the natural "nothing came back" for an optional
// one. A boolean-returning action MUST pass its own `dropped`, or a dropped call reports undefined
// where the caller reads a boolean.
export function createBusyGate(read: () => boolean, write: (busy: boolean) => void) {
  return function withBusy<Args extends unknown[], Result = void>(
    action: (...args: Args) => Promise<Result>,
    dropped: Result = undefined as Result,
  ): (...args: Args) => Promise<Result> {
    return async (...args) => {
      if (read()) return dropped;
      write(true);
      try {
        return await action(...args);
      } finally {
        write(false);
      }
    };
  };
}
