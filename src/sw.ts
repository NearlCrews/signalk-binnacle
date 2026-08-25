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
    default:
      return new CacheFirst({ cacheName, plugins });
  }
}

const routes: RuntimeCaching[] = runtimeCaching.map((route) => ({
  matcher: route.urlPattern,
  handler: toStrategy(route),
}));

// In dev the plugin serves this worker without a precache manifest (self.__SW_MANIFEST stays
// undefined). navigateFallback must then be omitted: the Serwist constructor resolves it against
// the precache and throws non-precached-url for a URL it does not hold, killing the whole worker
// at evaluation.
const precacheEntries = self.__SW_MANIFEST;

const serwist = new Serwist({
  precacheEntries,
  // Prompt-mode updates: the new worker waits until the navigator accepts (Serwist itself
  // listens for the SKIP_WAITING message that messageSkipWaiting() posts).
  skipWaiting: false,
  // Unlike the previous worker, the first-ever install takes control immediately, so the first
  // visit starts filling runtime caches without a reload. The window side gates its post-update
  // reload on isUpdate, so this cannot reload a first visit.
  clientsClaim: true,
  precacheOptions: {
    // Also sweeps the retired workbox-precache-v2 cache on upgraded installations: the cleanup
    // deletes any cache whose name carries -precache- plus this scope, whatever the prefix.
    cleanupOutdatedCaches: true,
    ...(precacheEntries === undefined
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
