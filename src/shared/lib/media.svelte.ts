import { createSubscriber } from 'svelte/reactivity';

// The layout breakpoints script asks about, one name per question. CSS cannot import these, so each
// stylesheet repeats the literal; the design contract holds script to the names. At NARROW_QUERY
// panels become bottom sheets; at COMPACT_QUERY the status strip stacks, the app menu becomes a
// bottom sheet, and the instrument dock goes full screen.
export const NARROW_QUERY = '(max-width: 600px)';
export const COMPACT_QUERY = '(max-width: 900px)';
// A phone held sideways: wide enough for one strip row, too short for two. The width bound keeps a
// wide, short helm display on the desktop strip, which has room for position and labeled pills.
export const LANDSCAPE_SHORT_QUERY =
  '(orientation: landscape) and (max-height: 500px) and (max-width: 1000px)';

export interface ReactiveMediaQuery {
  readonly matches: boolean;
}

const NO_MATCH: ReactiveMediaQuery = { matches: false };

// One MediaQueryList and one reactive match per query, shared by every caller asking the same
// question. Both caches reset when matchMedia itself is replaced, which is how a test stubs a
// viewport.
const lists = new Map<string, MediaQueryList>();
const reactive = new Map<string, ReactiveMediaQuery>();
let cachedFor: typeof window.matchMedia | undefined;

export function sharedMediaList(query: string): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  if (cachedFor !== window.matchMedia) {
    lists.clear();
    reactive.clear();
    cachedFor = window.matchMedia;
  }
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

// A reactive CSS media-query match. Reading `matches` from inside an effect (a template expression
// counts) subscribes to the query's change event and releases it when the last such effect is
// destroyed, so a component asks for one and needs no mount or teardown plumbing of its own.
// Reading it outside an effect still reports the current match. An environment without matchMedia
// (server rendering, Node) reports no match rather than throwing, which is the same degrade the CSS
// media queries give: the wide layout.
export function createMediaQuery(query: string): ReactiveMediaQuery {
  const list = sharedMediaList(query);
  if (!list) return NO_MATCH;
  let match = reactive.get(query);
  if (!match) {
    const subscribe = createSubscriber((update) => {
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    });
    match = {
      get matches() {
        subscribe();
        return list.matches;
      },
    };
    reactive.set(query, match);
  }
  return match;
}
