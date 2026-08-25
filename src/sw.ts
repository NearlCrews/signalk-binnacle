/// <reference lib="webworker" />
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';
// The direct file import deliberately bypasses the $shared/pwa barrel: the barrel re-exports
// register.svelte.ts, whose virtual:serwist import and runes cannot resolve in the plugin's
// plugin-less child build that bundles this worker.
import { type RuntimeCacheRoute, runtimeCaching } from '$shared/pwa/sw-caching';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope & WorkerGlobalScope;

// The caching table stays pure data in $shared/pwa/sw-caching (unit-tested without service worker
// machinery); this entry alone turns it into serwist strategy instances.
function toStrategy(route: RuntimeCacheRoute) {
  const { cacheName, networkTimeoutSeconds, expiration, cacheableResponse } = route.options;
  const plugins = [
    new ExpirationPlugin({ ...expiration }),
    new CacheableResponsePlugin({ statuses: [...cacheableResponse.statuses] }),
  ];
  switch (route.handler) {
    case 'NetworkFirst':
      return new NetworkFirst({ cacheName, networkTimeoutSeconds, plugins });
    case 'StaleWhileRevalidate':
      return new StaleWhileRevalidate({ cacheName, plugins });
    case 'CacheFirst':
      return new CacheFirst({ cacheName, plugins });
    default:
      // Exhaustive: a handler added to RuntimeCacheRoute must fail the build here rather than
      // silently become a seven-day cache.
      throw new Error(`Unhandled cache handler ${route.handler satisfies never}`);
  }
}

const routes: RuntimeCaching[] = runtimeCaching.map((route) => ({
  matcher: route.urlPattern,
  handler: toStrategy(route),
}));

// In dev the plugin serves this worker without a precache manifest (self.__SW_MANIFEST stays
// undefined). navigateFallback must then be omitted: the Serwist constructor resolves it against
// the precache and throws non-precached-url for any URL it does not hold, an empty precache
// included, killing the whole worker at evaluation.
const precacheEntries = self.__SW_MANIFEST;
if (import.meta.env.PROD && !precacheEntries?.length) {
  // A production worker with no precache would register fine and silently lose the app shell;
  // fail loudly instead, so the offline charts page shows its cache-off note.
  throw new Error('The production service worker was built without a precache manifest.');
}

const serwist = new Serwist({
  precacheEntries,
  // Prompt-mode updates: the new worker waits until the navigator accepts (Serwist itself
  // listens for the SKIP_WAITING message that messageSkipWaiting() posts).
  skipWaiting: false,
  // Unlike the previous worker, the first-ever install takes control immediately, so the first
  // visit starts filling runtime caches without a reload. The window side reloads only for an
  // update, an external activation, or a surfaced waiting worker, so this cannot reload a first
  // visit.
  clientsClaim: true,
  precacheOptions: {
    // Also sweeps the retired workbox-precache-v2 cache on upgraded installations: the cleanup
    // deletes any cache whose name carries -precache- plus this scope, whatever the prefix. The
    // runtime caches keep their names and entries across the migration; pre-migration entries
    // have no expiration records yet, which is deliberate (a one-time sweep would defeat the
    // cached-charts-survive-the-upgrade promise), and they self-heal on first use.
    cleanupOutdatedCaches: true,
    ...(!precacheEntries?.length
      ? {}
      : {
          navigateFallback: 'index.html',
          // Do not answer file-like navigation requests (a path with an extension) from the app
          // shell; they should hit the network or 404, not the HTML.
          navigateFallbackDenylist: [/\/[^/?]+\.[^/?]+$/],
        }),
  },
  runtimeCaching: routes,
});

serwist.addEventListeners();
