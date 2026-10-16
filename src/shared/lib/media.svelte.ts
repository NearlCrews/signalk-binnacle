import { createSubscriber } from 'svelte/reactivity';

// A phone held sideways: wide enough for one strip row, too short for two. The width bound keeps a
// wide, short helm display on the desktop strip, which has room for position and labeled pills. CSS
// cannot import this, so each stylesheet repeats the literal; the design contract holds every copy.
export const LANDSCAPE_SHORT_QUERY =
  '(orientation: landscape) and (max-height: 500px) and (max-width: 1000px)';

export interface ReactiveMediaQuery {
  readonly matches: boolean;
}

// A reactive CSS media-query match. Reading `matches` from inside an effect (a template expression
// counts) subscribes to the query's change event and releases it when that effect is destroyed, so
// a component constructs one of these and needs no mount or teardown plumbing of its own. Reading
// it outside an effect still reports the current match. An environment without matchMedia (server
// rendering, Node) reports no match rather than throwing, which is the same degrade the CSS media
// queries give: the wide layout.
export function createMediaQuery(query: string): ReactiveMediaQuery {
  const list =
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? undefined
      : window.matchMedia(query);
  const subscribe = createSubscriber((update) => {
    if (!list) return;
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  });
  return {
    get matches() {
      subscribe();
      return list?.matches ?? false;
    },
  };
}
