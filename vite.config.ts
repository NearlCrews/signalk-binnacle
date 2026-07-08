import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { runtimeCaching } from './src/shared/pwa/sw-caching';

const alias = {
  $app: fileURLToPath(new URL('./src/app', import.meta.url)),
  $views: fileURLToPath(new URL('./src/views', import.meta.url)),
  $widgets: fileURLToPath(new URL('./src/widgets', import.meta.url)),
  $features: fileURLToPath(new URL('./src/features', import.meta.url)),
  $entities: fileURLToPath(new URL('./src/entities', import.meta.url)),
  $shared: fileURLToPath(new URL('./src/shared', import.meta.url)),
};

export default defineConfig({
  // Signal K serves the webapp at /<package-name>/, so production assets resolve under /signalk-binnacle/.
  base: process.env.NODE_ENV === 'production' ? '/signalk-binnacle/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.2.0'),
  },
  optimizeDeps: {
    // MapLibre 6's worker bundling fails Vite's dependency pre-bundler with "the file does not
    // exist at .../maplibre-gl-worker.mjs"; excluding it is the workaround maplibre-gl and
    // terra-draw upstream document (terra-draw issue #912) until the optimizer handles it.
    exclude: ['maplibre-gl'],
  },
  plugins: [
    svelte(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a chartplotter must not silently reload itself underway. A new
      // build surfaces an Update control (registerPwa's onNeedRefresh) so the navigator chooses when
      // to reload, rather than the chart vanishing mid-passage.
      registerType: 'prompt',
      includeAssets: ['binnacle-icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Binnacle Chartplotter',
        short_name: 'Binnacle',
        description: 'A WebGL chartplotter for Signal K.',
        start_url: '/signalk-binnacle/',
        scope: '/signalk-binnacle/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        background_color: '#cfe0ec',
        theme_color: '#cfe0ec',
        icons: [
          {
            src: 'binnacle-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/signalk-binnacle/index.html',
        // Do not answer file-like navigation requests (a path with an extension) from the app shell;
        // they should hit the network or 404, not the HTML. The /signalk-binnacle/ scope already
        // isolates the worker from the Signal K server API and admin paths, and a /^\/signalk/ entry
        // would falsely match the app's own /signalk-binnacle/ routes and break the offline fallback.
        navigateFallbackDenylist: [/\/[^/?]+\.[^/?]+$/],
        // Sweep precache entries left by prior builds; register.ts assumes this is on.
        cleanupOutdatedCaches: true,
        // The app chunk is large (MapLibre), so raise the precache size ceiling.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // The full table lives in src/shared/pwa/sw-caching.ts, where the matchers are
        // unit-tested; the build serializes the functions into the generated worker.
        runtimeCaching: runtimeCaching as never,
      },
    }),
  ],
  resolve: { alias },
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: true,
    // Match tsconfig.app.json's target so the build output is consistent with the type-check.
    target: 'es2023',
    // Hidden sourcemaps are not served to users but allow error monitoring tools to symbolicate
    // production stack traces. Critical for field debugging on a boat where reproducing an issue
    // is not always possible.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Split the large vendor libraries into separate chunks for better cache hit rates across
        // releases (vendor code changes less often than app code) and parallel HTTP/2 download.
        manualChunks(id) {
          // Path-segment anchored (slashes on both sides), not a bare substring match: a bare
          // 'maplibre-gl' check would also catch terra-draw-maplibre-gl-adapter's own path (its
          // package name contains that substring), silently merging the adapter into the far
          // larger maplibre-gl chunk instead of its own terra-draw chunk.
          if (id.includes('node_modules')) {
            if (id.includes('/terra-draw/') || id.includes('/terra-draw-maplibre-gl-adapter/'))
              return 'terra-draw';
            if (id.includes('/maplibre-gl/')) return 'maplibre-gl';
            if (id.includes('/pmtiles/') || id.includes('/pbf/')) return 'pmtiles';
          }
        },
      },
    },
  },
  test: {
    // Vitest stubs CSS imports as empty modules by default (real CSS processing is wasted work for
    // most tests); map-theme.test.ts needs the real tokens.css text to cross-check its hand-copied
    // colors, so opt that one file back in.
    css: { include: [/tokens\.css/] },
    // ICU warm-up for every worker; see the file's comment.
    setupFiles: ['./vitest.setup.ts'],
    // Headroom for oversubscribed CI runners (the v0.6.0 Windows Node 22 machine spent 63 s just
    // importing the suite); a hung test still fails, only slower.
    testTimeout: 15_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: ['src/**/*.svelte.{test,spec}.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-svelte',
          environment: 'node',
          include: ['src/**/*.svelte.{test,spec}.ts'],
        },
      },
    ],
  },
});
