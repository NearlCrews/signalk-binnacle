// The wet-screen lock's state: session-only by design, so a reload always comes up unlocked and a
// stuck lock can never survive a restart. The overlay owns the unlock gesture; this owns only the
// flag and the completion callback the composition root may hang follow-up work on.

export interface TouchLockController {
  readonly locked: boolean;
  lock(): void;
  unlock(): void;
}

export function createTouchLock(onUnlocked?: () => void): TouchLockController {
  let locked = $state(false);
  return {
    get locked(): boolean {
      return locked;
    },
    lock(): void {
      locked = true;
    },
    unlock(): void {
      if (!locked) return;
      locked = false;
      onUnlocked?.();
    },
  };
}
