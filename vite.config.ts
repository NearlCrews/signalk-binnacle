import { fileURLToPath } from 'node:url';
import { serwist } from '@serwist/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import packageJson from './package.json' with { type: 'json' };
import tsconfigBase from './tsconfig.base.json' with { type: 'json' };
import tsconfigPaths from './tsconfig.paths.json' with { type: 'json' };

// The tsconfig owns the path aliases; derive Vite's map from it so a new slice needs one edit.
const alias = Object.fromEntries(
  Object.entries(tsconfigPaths.compilerOptions.paths).map(([pattern, [target]]) => [
    pattern.replace('/*', ''),
    fileURLToPath(new URL(target.replace('/*', ''), import.meta.url)),
  ]),
);

// Signal K serves the webapp at /<package-name>/.
const base = `/${packageJson.name}/`;

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? base : '/',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [
    svelte(),
    // The service worker is a real module (src/sw.ts) bundled by the plugin's child build; its
    // update flow stays prompt-mode (skipWaiting false there, the Update control in the UI). The
    // web app manifest is a static file (static/manifest.webmanifest) linked from index.html. The
    // fallback navigation route and its denylist live in sw.ts beside the runtime caching table.
    serwist({
      swSrc: 'src/sw.ts',
      swDest: 'sw.js',
      globDirectory: 'public',
      // A classic worker in an iife bundle, matching the previous registration type.
      rollupFormat: 'iife',
      type: 'classic',
      // The app chunk is large (MapLibre), so raise the precache size ceiling.
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      // One glob source for the whole precache. The root-only *.png entry takes the five icon
      // PNGs without sweeping public/screenshots/, and *.webmanifest keeps the manifest available
      // offline.
      globPatterns: ['**/*.{js,css,html,svg,woff2}', '*.png', '*.webmanifest'],
    }),
  ],
  resolve: { alias },
  publicDir: 'static',
  build: {
    outDir: 'public',
    // The shared tsconfig base owns the language target so the build output always matches the
    // type-check.
    target: tsconfigBase.compilerOptions.target,
    // Hidden sourcemaps are not served to users but allow error monitoring tools to symbolicate
    // production stack traces. Critical for field debugging on a boat where reproducing an issue
    // is not always possible.
    sourcemap: 'hidden',
    rolldownOptions: {
      // rolldown 1.2.5 deliberately folds side-effect-bearing modules that only lazy chunks share
      // into the eager entry (rolldown#10645, the intended fix for rolldown#9963; there is no
      // upstream fix to wait for). In this single-entry app every on-demand panel is reachable
      // only through the entry, so the fold sweeps the lazy features (weather, instruments,
      // profiles) into the main chunk and blows its size budget. In the released 1.2.5 the fold
      // ships under avoidRedundantChunkLoads; disabling it restores per-dynamic-import splitting
      // byte-identically, while mergeCommonChunks: false alone measurably changes nothing.
      experimental: { chunkOptimization: { avoidRedundantChunkLoads: false } },
      output: {
        // Split the large vendor libraries into separate chunks for better cache hit rates across
        // releases (vendor code changes less often than app code) and parallel HTTP/2 download.
        codeSplitting: {
          // Only the matched modules join a group, mirroring the previous manualChunks behavior,
          // so a shared dependency is not silently pulled into a vendor chunk.
          includeDependenciesRecursively: false,
          groups: [
            // Path-segment anchored (a slash on both sides), not a bare substring match: a bare
            // 'maplibre-gl' test would also catch terra-draw-maplibre-gl-adapter's own path (its
            // package name contains that substring), silently merging the adapter into the far
            // larger maplibre-gl chunk instead of its own terra-draw chunk.
            { name: 'terra-draw', test: /node_modules\/terra-draw(?:-maplibre-gl-adapter)?\// },
            { name: 'maplibre-gl', test: /node_modules\/maplibre-gl\// },
            { name: 'pmtiles', test: /node_modules\/(?:pmtiles|pbf)\// },
          ],
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
    coverage: {
      provider: 'v8',
      // The gate needs only the text summary and the thresholds; the html and lcov reports are
      // hundreds of files rebuilt on every run for occasional human browsing, so they live behind
      // the test:coverage:report script instead.
      reporter: ['text'],
      include: ['src/**/*.{ts,svelte}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.{test,spec}.ts',
        'src/**/index.ts',
        'src/shared/testing/**',
        'src/shared/types/**',
      ],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 65,
        lines: 67,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: ['src/**/*.svelte.{test,spec}.ts'],
          // Keep per-file isolation: isolate: false was measured 2026-08-25 to roughly halve the
          // wall clock, but it produced nondeterministic cross-file failures (46 on one run, a
          // different file on the next), so the module graph is not order-independent.
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-svelte',
          environment: 'node',
          include: ['src/**/*.svelte.{test,spec}.ts'],
          exclude: ['src/**/*.client.svelte.{test,spec}.ts'],
        },
      },
      {
        extends: true,
        // Vite's dependency optimizer must not discover anything after the run starts. When it
        // does, it re-optimizes and reloads the browser, and whichever test modules were mid-import
        // at that moment fail with "Failed to fetch dynamically imported module" and report zero
        // tests. It hits a different file each run and only under load, so on a slow machine it is
        // indistinguishable from a real failure; it blocked a push here. The scan at startup finds
        // what these tests need, so holding the optimizer to that is enough, and anything it did not
        // find is served as source. Verified with the dependency caches deleted, the state CI and a
        // fresh clone always start from.
        optimizeDeps: {
          noDiscovery: true,
        },
        test: {
          name: 'client-svelte',
          // Browser compilation executes client-side rune lifecycle, which the Node SSR compiler
          // intentionally does not run. Keep effect-driven controller tests in this project.
          include: ['src/**/*.client.svelte.{test,spec}.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
