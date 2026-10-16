import { vi } from 'vitest';

interface FakeMediaQueries {
  readonly listeners: Set<() => void>;
  // Replace the answer and notify every listener, the way a viewport change would.
  set(matches: (query: string) => boolean): void;
}

// A scripted matchMedia: the real one cannot be driven from a test. Each stub is a new function, so
// $shared/lib's shared media lists reset for it. Imported by *.test.ts files only.
export function stubMatchMedia(matches: (query: string) => boolean): FakeMediaQueries {
  let answer = matches;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    onchange: null,
    get matches() {
      return answer(query);
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  return {
    listeners,
    set(next) {
      answer = next;
      for (const listener of listeners) listener();
    },
  };
}
