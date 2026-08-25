# Binnacle: AI assistant operating rules

Binnacle is a from-scratch, next-generation marine chartplotter for Signal K, for the
bluewater cruiser and the liveaboard. It is NOT a port of Freeboard-SK or of the earlier
signalk-open-binnacle fork; those are conceptual references only. The project name is
Binnacle, not Open Binnacle. No legacy code is carried forward.

The north star: Binnacle should be so good that people adopt Signal K specifically to use it.
That is the tiebreaker for every call: first-run excellence on a stock server, polish over
feature count, "it just works" caching, one coherent design system, and gloved-hand marine UX
are the product itself.

This file is the source of truth for project-scoped AI assistant rules. User-global memory
does not always load reliably across worktrees or fresh clones, so rules that came at the cost
of redoing work live here.

`AGENTS.md` is the tracked operational authority. For UI architecture, the tracked
`docs/design-system.md`, `docs/building-menu-items.md`, and `docs/menu-items.md` are authoritative.
The menu reference records shipped behavior and recovery states for every action. Local design notes under
`docs/superpowers/` are optional working material and must not be required to understand a fresh
clone.

The committed `docs/design-system.md` is the authoritative design and front-end build standard: the
tokens, themes, modular CSS, global utility classes, shared UI primitives, panel anatomy and field
idioms, menus, interaction and a11y conventions, coding standards, and a recipe for adding a panel
consistently. Read it before designing or building any UI, so a new panel or menu is indistinguishable
from the shipped ones.

When adding or changing a menu item, panel, or its controls, follow `docs/building-menu-items.md`: the
step-by-step build checklist, the reuse-or-rebuild decision tables, the cascade and collision traps,
the copy and accessibility checklists, and the gate. It operationalizes the design system so styles do
not have to be corrected after the fact.

## Locked product and stack decisions

- Framework: Svelte 5 (runes), Vite, TypeScript. This was a deliberate clean break from the
  Angular lineage of the prior fork; do not reintroduce Angular.
- Map: MapLibre GL JS 6.x used directly, plus a thin imperative LayerManager for dynamic
  overlays. deck.gl MapboxOverlay is an optional pluggable overlay, not the base.
- Charts: a generic ChartSourceAdapter over the Signal K `/resources/charts` API, plus a
  vector base map. S-57 to vector-tile pipeline and full S-52 styling are a later spec.
- Real-time: a dedicated Web Worker hosts the Signal K WebSocket client, bridged with Comlink,
  batching deltas into frame-rate flushes on a worker timer (never requestAnimationFrame, which
  a hidden tab suspends, so data and alarms keep flowing in a backgrounded tab), feeding a
  path-keyed fine-grained runes store.
- Fonts: Inter (UI) and JetBrains Mono (numeric readouts), self-hosted.
- Icons: @lucide/svelte for app chrome. Chart symbols derive from the S-52 Presentation
  Library and OpenBridge, not from a UI icon set.
- Themes: day, dusk, and night-red. Night-red is pure red on true black. No blue at night,
  alarms always distinguishable, brightest pixel low.
- App shell: hybrid chart-centric, structured so the three-mode shell (Watch, Anchor, Inhabit)
  drops in later without a rebuild.
- Layer control: per-layer toggle, opacity slider, and drag-to-reorder z-order.

## Toolchain (lint, format, build)

- Format and general code lint: the exact-pinned repository-local Biome dependency. It is the only
  formatter. Do not depend on a global binary, a setup action, or Prettier. Bump the dependency and
  `biome.json` schema together. `npm run format` writes formatting, and `npm run ci:biome` verifies
  formatting, lint rules, and import organization.
- Semantic lint: ESLint is deliberately narrow. `eslint-plugin-svelte` owns Svelte-specific rules,
  and typescript-eslint owns `await-thenable`, `no-floating-promises`, and
  `no-misused-promises` for all TypeScript, tests included (an unawaited async assertion is a
  test that silently passes). Do not add general, stylistic, unused-code, or
  import-boundary ESLint rules that duplicate Biome, Knip, or dependency-cruiser.
  typescript-eslint is not only those three rules: `tseslint.parser` is also the TypeScript parser
  in `eslint.config.js`, both for `**/*.ts` and inside `**/*.svelte` so eslint-plugin-svelte can
  read a `lang="ts"` script block. Dropping it costs a parser too. Biome is not a substitute here:
  as of 2.5.10 its `noFloatingPromises`, `noMisusedPromises`, and `useAwaitThenable` (the
  `await-thenable` equivalent, added in 2.3.9) are all still Nursery and run on Biome's own type
  inference rather than the TypeScript compiler, and eslint-plugin-svelte has no Biome counterpart.
- Biome's `.svelte` support is experimental (it formats and lints the script and style blocks,
  not the control-flow template syntax). It is enabled via `html.experimentalFullSupportEnabled`.
  Re-verify it round-trips Svelte files cleanly whenever `{#if}`, `{#each}`, or other control
  flow is added (Phase 6 onward); if it ever mangles a `.svelte` file, exclude `.svelte` from
  Biome and rely on `svelte-check` for correctness. Because Biome cannot see a `{#snippet}`
  parameter used in the template body, `noUnusedFunctionParameters` is turned off for `.svelte`
  files in `biome.json`; the real backstop is `noUnusedLocals` and `noUnusedParameters` in
  `tsconfig.app.json`, which svelte-check enforces (it does see template usage). On Biome 2.5.1 the
  same experimental support reports false positives on valid Svelte for three new a11y rules
  (`useValidAriaValues` on dynamic ARIA bindings, `useSemanticElements` on `role="group"` toolbars,
  and `noLabelWithoutControl` on a label wrapping a child-component control), so those three are
  turned off for `.svelte` in `biome.json`; Svelte's own compiler a11y warnings, surfaced by
  svelte-check, are the Svelte-aware backstop. Biome 2.5.2 added `noUnusedVariables` false
  positives on `.svelte` (props and module-script variables used only in the template), so that
  rule is off for `.svelte` too; `noUnusedLocals` in `tsconfig.app.json` via svelte-check remains
  the template-aware backstop. SVG assets are excluded from Biome (2.5.1 began
  parsing `.svg` and chokes on the XML prolog). Config uses the `linter.rules.preset` form
  (`recommended`), not the deprecated `recommended` boolean.
- Type-check: `npm run check` runs svelte-check with `--tsgo` against `tsconfig.app.json`, then
  `tsgo` against `tsconfig.node.json` (Vite, Playwright, Vitest setup, and E2E code; requires the
  direct `@types/node` development dependency), then `tsgo` against `tsconfig.scripts.json`
  (`checkJs` over `scripts/*.mjs`). `tsgo` is the `@typescript/native-preview` compiler, and it is
  the real check engine, so the code is ALREADY validated against TypeScript 7 semantics. The
  `typescript` dependency on 6.x is only what satisfies the peers of svelte-check and
  typescript-eslint; nothing type-checks with it. See the version note below before trying to raise
  it. svelte-check `--tsgo` writes transpiled Svelte files to
  `.svelte-check/`, which is gitignored and ESLint-ignored. A Svelte file deleted from `src/`
  leaves a stale transpiled copy there that keeps failing the check; `.svelte-check/` is a
  disposable cache, so delete it and re-run.
- Other owners: dependency-cruiser enforces Feature-Sliced Design and cycles, Knip owns unused
  files, exports, and dependencies, markdownlint and cspell own maintained prose, Vitest V8 owns
  the coverage floor, Size Limit owns built asset budgets, and publint plus
  `scripts/check-package.mjs` own package integrity.
- Workflow gates are split by what they can prove. `scripts/check-workflows.mjs` (`npm run
  ci:workflows`) owns this repository's own CI invariants: the pinned npm bootstrap, its location
  outside the checkout, and setup-node's disabled package-manager cache. zizmor owns generic GitHub
  Actions security (token persistence, injection through untrusted expressions, unpinned action
  references) and runs as its own `workflow-security` job in `ci.yml` at a medium severity floor.
  Every action reference is pinned to an immutable commit SHA with a version comment, and every
  checkout sets `persist-credentials: false` because no workflow pushes, tags, or uses the ambient
  token. The ad-hoc installs zizmor flags (the pinned npm, and the packed tarball the App Store
  simulation installs) are deliberate and carry `# zizmor: ignore[adhoc-packages]` with the reason
  at the step.
- Dependency audits are two distinct gates and stay that way: `npm run audit:runtime`
  (`--omit=dev`) is what the community registry scores, and `npm run audit:full` covers the build
  and test toolchain a maintainer still has to keep clean. `verify:release` runs both.
- `signalk-chart-sources` is the single upstream authority for a raster overlay's service URL, layer
  name, zoom range, bounds, coverage, and attribution. A feature declares only what the catalog
  deliberately does not carry: the plain-language description, the region tag, the panel category,
  and the parent. Never restate an upstream fact in a feature module; that is what let a stale NOAA
  bounding box silently drop Guam, the Northern Marianas, American Samoa, Wake, and the Pacific
  Remote Islands off the protected-area overlay.
  - Every catalog read goes through `requireCatalogSource(id)` in `$shared/map`, which also narrows
    to an upstream mode when the caller needs one. Do not hand-roll the lookup and guard; three
    modules each spelled their own and produced three different messages for one missing entry.
  - The rule covers TESTS too. A literal is load-bearing when Binnacle misbehaves if the value
    changes, and a restatement when Binnacle only passes the value through and the catalog's own
    monitor already checks it against the live TileJSON. Restated ones fail the build on a correct
    upstream release, which is what the Seascape zoom ceilings did. Assert the whole descriptor
    against the catalog instead (`expectCatalogFacts` in `$shared/testing` is the shared form), and
    keep hand-built fixtures obviously synthetic so they cannot be mistaken for upstream truth. What
    stays pinned is whatever is ours rather than upstream's, the source count and the tile extension
    an overlay type requires among them.
  - A `style` mode source cannot go through `catalogSource`, since `catalogTiles` rejects it: a
    style document is not a tile template. The catalog carries more than one. That is not license to
    hardcode them. Take a direct guarded read, and place it so a shape mismatch cannot take an
    offline fallback down with it, which for the base map means reading lazily rather than at module
    scope so a bad catalog cannot leave the map with no style at all.
  - Where a value cannot be imported at all, pin the seam with a test. `sw-caching.ts` must inline
    its hosts, because the build serializes each matcher through `Function.toString` without its
    module scope, so a matcher closing over an import throws `ReferenceError` in the worker. The
    invariant: every host inlined there that the catalog also owns must be asserted against the
    catalog, so enumerate `CHART_SOURCES` rather than pinning one matcher against one URL. The same
    seam covers the privacy erase: every `cacheName` the worker config declares must appear in
    `BINNACLE_CACHE_NAMES` from `$shared/privacy`, pinned by sw-caching's own test, or a new route's
    cache survives a device-data erase that reports success.
  - A source carrying `maxAgeSeconds` is time-dynamic (weather radar, NWS alerts, sea surface
    temperature). It must never be offered for offline pre-warm: a stored weather frame is wrong
    before anyone sails into it, and the companion cache refuses to store it anyway. `isVolatile`
    in `features/prewarm/estimate.ts` is the one gate, and its exclusion is itself pinned by a
    catalog-derived test. Time-dynamic sources the service worker does cache route to their own
    short-lived NetworkFirst cache, never the seven-day overlay one.
  - A zero-area bbox is rejected by the enumerator rather than silently expanded to worldwide
    coverage. `coveringSources` answers a degenerate box locally, because it runs inside the draw
    library's finish callback where a throw would escape into its event dispatch.
  - Whole families belong to the offline builder's Advanced bucket together. A new upstream sibling
    left off `SPECIALIST` renders as an ordinary reference layer beside its own family; the
    source-summary test derives the families from the catalog so that drift fails there.
- Additional libraries are allowed when they genuinely beat building in-house (user rule,
  2026-06-12), but only after EXTENSIVE research for the best one: compare the real candidates on
  maintenance activity, weekly downloads, bundle cost, API fit, license, and issue health, and
  record the comparison in the commit or PR description. Never adopt the first search hit; never
  add a dependency a few dozen lines of owned code would cover better.
- Keep every dependency at its latest compatible version. The stack is on Vite 8, TypeScript 6.0.3,
  Svelte 5.56.8, MapLibre GL JS 6.6.0 (used directly, not svelte-maplibre-gl), pmtiles 4, Comlink 4,
  and pbf 5.1.2 (its v5 rewrite is pure ESM with the old `Pbf` class split into `PbfReader` and
  `PbfWriter`, no default export; the radar protocol's decoder imports `PbfReader`, the encoder and
  test fixtures import `PbfWriter`). The `typescript` package stays on 6.x, and raising it to 7 is
  NOT an upgrade to chase: it would install a second copy of a compiler this repo already runs, and
  break the two tools that still need the old API. TypeScript 7 stopped being a library. The whole
  of `typescript@7.0.2`'s default export is `lib/version.cjs`, three lines returning `version` and
  `versionMajorMinor`; there is no `lib/typescript.js`, and `lib/` holds only a binary launcher.
  The compiler API now lives behind `./unstable/*` (`unstable/ast`, `unstable/sync`, and kin) next
  to twenty platform Go binaries. So `createProgram`, the `TypeChecker`, the language service, and
  `tsserver` are all unreachable from `typescript@7`, which is why every type-reading tool peer-caps
  below it. Here that is typescript-eslint (peers `>=4.8.4 <6.1.0`) and svelte-check (4.7.4, the
  latest, peers `^5.0.0 || ^6.0.0`). Replacing typescript-eslint does NOT unblock it, so do not go
  down that road: svelte-check is the binding cap and has no substitute, since `sv` is a scaffolding
  CLI and `svelte-language-server` is an editor LSP with the same dependency. Nor is anything being
  missed meanwhile: `@typescript/native-preview` exports the exact same shape as `typescript@7.0.2`,
  because it IS that compiler, so `npm run check` already runs TypeScript 7. Note that
  `@typescript/native-preview` stopped publishing on 2026-07-07 (a frozen final snapshot; TS7
  nightlies now ship as `typescript@next`), and svelte-check's documented TS7 arrangement is the
  alias `@typescript/native@npm:typescript@7` beside `typescript@~6`, which it resolves first. The
  swap is not free here because `typescript@7` ships only a `tsc` bin (no `tsgo`, and it would
  collide with typescript 6's), while the check script invokes `tsgo -p` directly, so it stays an
  owner decision. The only prize is
  retiring one of the two package names once the API stabilizes. WATCH TRIGGER, and it is one
  command, not a calendar entry: re-check when `npm view svelte-check peerDependencies` admits `^7`.
  typescript-eslint waits on the new compiler API expected in TypeScript 7.1 (7.0 ships none). npm
  12.0.2 requires Node 22.22.2, Node 24.15.0, or Node 26.0.0 and later. Keep the Workbox
  off-main-thread override on its newest
  4.0.0-pre2 beta until Workbox adopts that line; it replaces the older EJS 3 dependency with EJS 6.
  Workbox 7.4.1 is also the latest release and still constrains `glob` to major 11, whose publisher
  marks it deprecated. Do not force a newer `glob` across that unsupported major boundary; keep the
  runtime audit clean, and remove the constraint when Workbox updates it.
  MapLibre 6 ships ESM-only, and bundlers cannot automatically discover the runtime worker
  filename it computes. `src/shared/map/maplibre-worker.ts` explicitly emits that worker through
  Vite's `?worker&url` import and calls `setWorkerUrl`; its side effect must run before every
  Map construction. Without it, the worker failure can be silent and raster-only: raster sources
  render, vector sources never parse, and the real `'load'` event never settles. That silent
  failure is tracked upstream as maplibre/maplibre-gl-js#8018. MapLibre 6 requires WebGL2, so the
  chart and weather cannot-start notices must remain. Explicit worker wiring restored the real
  load event, and the synthetic-ready race was removed after the worker-backed path was proven.
  The ES2023 production bundle requires Safari 16.4 or later. Before construction,
  `createThemedMap` probes a WebGL2 context with the same effective attributes and releases it when
  the optional cleanup extension is available. Only context creation determines support. MapLibre 6
  otherwise installs global and DOM side effects before reporting GPU initialization failure, then
  returns a partial Map that its public `remove()` cannot safely clean up. Preserve that probe and
  the chart and weather cannot-start notices. Keep `zoomLevelsToOverscale`
  explicitly `undefined`: MapLibre 6 defaults it to 4, while Binnacle preserves the v5 vector
  rendering and query behavior. Supply on-demand style images through
  `setMissingStyleImageResolver`; `styleimagemissing` is notification-only in v6. For a chart
  source with declared `maxzoom`, cap from the source specification rather than an immediate
  `getSource()` read because MapLibre temporarily reports its default 22 until asynchronous source
  loading applies the option. URL-backed sources without a declaration continue to wait for
  metadata. The independent style-arrival watchdog gives the companion and direct base-style
  attempts a full bounded timeout each, and the chart source-metadata lifecycle gate remains. Radar
  and wind custom layers use `defaultProjectionData.mainMatrix` for normalized Mercator coordinates.
  `@signalk/server-api` is never a dependency: the few wire types are mirrored from its 2.x shapes in
  `src/shared/signalk/types.ts`, since importing the package crashes the worker (see the worker note below).

## Verify before commit and push (hard rule, mechanically enforced)

Never commit or push on a red gate. A commit message must never claim "green" before the gate
has actually run and passed. This was violated repeatedly early on, so it is now enforced by git
hooks in `.githooks/`, wired via `npm run hooks` (a non-lifecycle script, never a `prepare` hook,
per the SignalK pack-banner caveat above):

- `pre-commit` runs `npm run verify:commit`, the shared formatting, lint, prose, architecture, and
  dead-code gate.
- `pre-push` runs `npm run verify:browser`, the full type, coverage, build, size, Chromium, PWA, and
  focused WebKit smoke gate without rebuilding the application for Playwright.
  A failure blocks the push.
- `pre-push` also prints a non-blocking drift report: any uncommitted tracked changes and any
  local branch besides `main`. This exists so stray work is seen at the moment of pushing, not
  rediscovered later with unknown provenance. When it fires, commit, discard, or stash the
  changes and delete merged branches before moving on; do not let the tree drift.

Follow `AGENTS.md` for commit and publishing authority. Keep significant work verified and
review-ready, but do not push, publish, tag, or release without the authorization that guide requires.

## Working-tree hygiene and the scratch directory

The project works directly on `main`, so the working tree should stay clean between commits.
Scratch artifacts (Playwright screenshots, throwaway debug scripts, captured logs) go in the
gitignored `tmp/` directory at the repo root, never loose at the root or inside `src/`. A stray
`*.png` at the repo root is also gitignored as a backstop. Real app and store screenshot sources
(`signalk.screenshots`) are not scratch: they live under `static/screenshots/`, are committed, and
are copied into the generated `public/` build output.

The working rhythm: write every file, run the gate capturing each result to a file and reading it
back (shell output on this Pi intermittently truncates, so trust the file, not a glanced line),
confirm all green, and only then commit and push. Swap covers concurrent heavy commands now, so
running several gate steps at once is fine (see "Pi memory" below).

Agent teams are allowed for Binnacle work, including `TeamCreate` (per the global rules), as are
parallel Agent-tool subagents scoped to disjoint files. Whatever the mechanism, the lead (main
thread) owns `package.json`, all git commits, and all heavy commands, and teammates are laned to
non-overlapping files so a shared file never has two editors. The lead integrates the shared and
wiring files itself, runs the gate, commits in logical chunks, and runs review subagents
(code-reviewer, silent-failure-hunter) on the integrated diff, fixing every finding. When using
`TeamCreate`, follow the global rules for the structured `shutdown_request` and verifying the tmux
panes actually closed before `TeamDelete`.

## Modularity is a first-class rule

Adding a later feature (weather, tides, routing, the CoPilot, anchor mode, the dashboard,
watch handoff) MUST be a self-contained module dropped in against stable interfaces, never
surgery on the core. The core never hardcodes knowledge of a specific feature.

- Layered structure (Feature-Sliced Design, adapted): imports flow strictly downward,
  `app -> views -> widgets -> features -> entities -> shared`. A slice may reach a same-layer sibling
  only through that sibling's `index` public API, never its internal files (the machine-enforced
  `no-cross-feature`, `no-cross-slice-shared`, and `no-cross-slice-entities` rules). Cross-feature
  data flows through an `entities` store, never feature to feature.
- Every slice exposes a public API via `index.ts`. Named re-exports only, never `export *`.
  Nothing outside a slice imports its internal files.
- Features are self-contained slices under `features/<name>`, each exposing a public API via its
  `index.ts`. Core destinations are composed through normal public imports. Large optional panels
  expose cached dynamic-import loaders from that same public API and load only when opened. Adding a
  feature is a new slice plus its wiring in `App.svelte` and `PlotterView.svelte`. A
  `FeatureManifest`/registry that auto-collects features is a future option, not yet built.
- Services (the Signal K client, the map instance, the stores) are constructed in `app/App.svelte`
  and passed down as props, not global singletons, so they are swappable in tests.
- Boundaries are machine-enforced and fail the build: path aliases plus a dependency-cruiser gate
  (`no-circular`, the per-layer `entities-go-down-only`, `features-go-down-only`,
  `widgets-go-down-only`, and `views-go-down-only` rules, `shared-imports-nothing-above`, the
  cross-feature `no-cross-feature` rule, and the `no-cross-slice-shared` and `no-cross-slice-entities`
  rules that hold a `shared` or `entities` slice to reaching a sibling only through its `index`).
  dependency-cruiser is the single boundary enforcer, because Biome has no import-boundary rule
  equivalent to `eslint-plugin-boundaries`.
- The global stylesheet is modular too (user rule, keep this style for everything going forward):
  `src/app.css` is only an ordered `@import` manifest over `src/styles/` modules (tokens, base, text,
  buttons, forms, cards, instruments, icon-controls, scrubber, overlays, reorder, panels, strips, a11y, vendor), and the import order IS
  the cascade order. The utility vocabularies are split one concern per module (text helpers, the button
  system, form controls, the saved-card, stat grid, and `.nav-*` sortable two-line row list, the icon controls plus the lit `.is-on` state, the
  popover and modal backdrop styles) and the shell into panels and strips; the order keeps `.is-on` after the
  `.btn` and `.icon-pill` bases it overrides, so do not reorder the manifest blindly. New global styling
  goes into the right module, never back into one monolith; new shared UI behavior goes through
  the `$shared/ui` primitives (SlideOver, AnchoredMenu, InlineConfirm, UnitField, ConfirmArm, SavedList,
  VisibilityToggle, ShowOnChartToggle, and LayerToggle (the three share one VisibilityToggleProps
  contract), CustomizeToggle, the dialog dismiss stack, the createReorder drag-reorder controller, the
  rovingFocus (with Home and End support), focusOnMount, focusSelectOnMount, focusOnMountIf, and
  onKeydownAction focus actions, the createMenuFocusMachine toolbar-menu keyboard machine (one
  arrow-roving, Tab-redirect, and close-focus-restore protocol shared by OverflowActions and the
  pinned More menu; the roving index math lives once in focus.ts as nextRovingIndex, and the
  rovingFocus action, the menu-focus machine, and the app menu's tile grid all step through that one
  copy, the grid mapping its horizontal arrows onto the same forward and back), AnchoredMenu's onFocusLeft prop (the shared close-on-focus-out contract, applied
  against its own surface while open, so consumers pass their close function instead of re-deriving
  the check from a surface binding), the isTabKey helper, the pickTextFile importer, the NameEntry name
  form with its defaultSaveName and resolveSaveName helpers, NavSortControl (the generic segmented sort
  control over `$shared/nav`'s NavSortState, shared by the POI search and Waypoints panels), SearchInput
  (the filter-as-you-type field with a 44px clear button and Escape-to-clear, shared by the AIS, POI
  search, and Waypoints panels), WriteAccessNote (the write-blocked notice plus request-access button
  shared by the waypoints, tracks, and note-detail panels), and the
  PANEL_TRANSITION_MS shared panel-transition-duration constant) and the
  global utility classes (the `.btn` system, `.icon-btn`, `.icon-pill`, `.pill-count` (the small count
  chip shared by the toolbar's collapsed More pill and a menu item's live count), `.popover-card`,
  `.menu-surface` (the anchored toolbar-menu surface layered on `.popover-card`, shared by the
  overflow menu, the bottom-bar More menu, and the profile switcher; consumers declare only
  `--menu-width` and, when needed, the origin corner), the
  `.surface-elevated` floating-panel frame, `.modal-card`, `.menu-item`, the `.row-interactive`
  control-height interactive-row base composed by the weather, route, and layers-category rows (it
  carries the hover tint and the lit `.is-on` body at a high enough specificity to beat a scoped
  background, with border longhands so a row can reserve its lit border), `.card-frame` (the raised
  bordered card surface shared by the saved-list cards and the alarm rows), `.overlay-backdrop`,
  `.unavailable` (the grayed treatment for a row whose provider is absent, shared by the layer rows
  and the instrument customize list), `.bare-list` (the list-style, margin, and padding reset for a
  layout `<ul>` or `<ol>`),
  `.alert-note` and its `.alert-note--filled` tinted-banner modifier, `.muted-note`,
  `.sev-danger` and `.sev-warning`, `.segmented`, `.caps-label`, `.panel-*` (including `.panel-slot`
  and its `--end` modifier), `.saved`, `.stat-grid`,
  `.num`, `.truncate` (single-line ellipsis truncation; the span still owns its width bound), and
  the `.nav-*` family (`.nav-sort`, `.nav-list`, `.nav-row`, `.nav-name`, `.nav-metrics`,
  `.nav-metric`) shared by the AIS targets, POI search, and Waypoints panels)
  before any panel grows a scoped duplicate. Lay a panel's body out with SlideOver's `bodyFlex` prop
  rather than a hand-rolled flex column, so the section rhythm matches across panels. When the same
  markup or CSS appears in a second place, hoist it; a third copy is a review failure.
- Reuse the shared non-UI helpers before re-implementing them: `$shared/lib` (isRecord, formatPercent,
  formatFixed, formatBytes and the unit formatters including lengthUnit, formatMonthDay, and the SI
  converters with CUBIC_METERS_TO_US_GALLONS and JOULES_PER_KWH, cleanBoundedText (trim and REJECT an
  oversized provider string, the validators' form; $shared/signalk's cleanTruncatedText is the
  clip-instead form the resource decoders use), createBusyGate (one busy flag serializing a
  controller's mutating actions, so a second tap during a write is dropped rather than racing it; a
  boolean-returning action must pass its own dropped value), uuidv4,
  the sorted-array searches lowerBound and nearestBySorted with nearestBy for unsorted callers,
  HeldFlag for a condition held continuously past a window against the reactive clock (a seeded run
  counts from construction, and reset() serves consumers with an imperative per-pass sweep, since an
  unobserved down window cannot clear the memo), withPromiseTimeout for a promise-deadline race
  (distinct from the aborting fetch withTimeout), and isUnsafeProviderKey, the one key-hygiene
  predicate for provider-controlled ids and path segments), `$shared/map` (featureCollection,
  emptyFeatureCollection, setSourceData, iconOffsetExpression with CENTERED_OFFSET, severityMatchExpression for a
    collision-graded paint value, removeLayersAndSources,
  setLayersVisibility, createSafetyOverlay for safety-band rasters, ensureSource and removeSharedSourceIfOrphaned
  for a MapLibre source two overlays share, setPaintProp and getPaintProp for a dynamically-computed
  paint property name (casts once through MapLibre's keyed paint types instead of re-spelling `as
  keyof AllPaintProperties` / `as never` at each call site), rgbaCss), `$shared/geo`
  (latLonToLonLat and the single lat/lon-to-GeoJSON-order crossing, the Bbox4 bounding-box tuple,
  wrapLongitude in its FLOORED form (an exact identity for an in-range longitude, where the modulo
  chain drifts about 3e-14 degrees; a caller needing to preserve a literal +180 restores it itself),
  unwrapEast for the antimeridian-crossing convention,
  quantizeLatLonKey for a position-keyed reactive cell, VIEWPORT_FETCH_PAD_FRACTION), `$shared/signalk` resource.ts (jsonOr, sendJson, fetchKeyedResource, the authenticated fetchAuthedJson, postResource, cleanTruncatedText, and createWriteOutcomeGate, the one place a write outcome becomes a message and, when refused, a fresh access request: the refusal arm is what a hand-rolled copy forgets, and without it a token revoked mid-passage never recovers), meta.ts (fetchPathMeta, zoneStateFor, and staleWindowMsFromTimeout, the one mapping from a declared meta.timeout to a client staleness window: zero means never stale, 'auto' and absent keep the client default), path-meta-cache.svelte.ts (createPathMetaCache, the shared per-session path-meta cache; a failed fetch reopens for retry after a paced RETRY_DELAY_MS window rather than on the next reactive visit, a changed token restores every spent attempt budget, and a cache handed the store also writes each path's declared staleness window onto its cell on settle, so grading helpers honor a slow sensor's own timeout), source-trace.ts (sourceCue and recentSourceRefs, the one definition of a recent source handoff and of a recently multi-source path over a traced cell's per-source samples), provider-probe.ts (fetchProviderIdList for the resources API's ARRAY `_providers` contract, and safeProviderId; history and weather keep their own keyed `_providers` readers, since the two APIs disagree on the response shape), and the NOTIFICATIONS_PREFIX export, `$shared/nav` (the rhumb helpers, plus the nav-rows list core shared by the POI search and Waypoints panels, and only those two: SEARCH_COLLATOR, compareNavIdentity, filterNavRows, sortNavRows, defaultNavSort, toggleSort, navMetrics, and MAX_NAV_ROWS; the AIS targets panel keeps its own sort in ais-rows.ts and shares only the `.nav-*` CSS family; plus plannedArrivalMs and crossesLocalMidnight, the route plan's planned-arrival arithmetic), `$shared/audio` (Alarm and GatedAlarm, which draw one shared AudioContext for the whole app rather than one per alarm, so a gesture on one alarm primes every alarm; GatedAlarm.restart re-articulates an already-sounding tone; AlarmCoordinator is the single audio authority every alarm registers a ranked channel with, so one alarm sounds at a time, MOB and an escalating collision interleave at the top, lower alarms rotate with bounded reminders, and courtesy channels yield; primeAlarmAudio and alarmAudioPrimed are the gesture-priming pair, and priming replaces a closed context so the Enable tap can never become a permanent no-op; AlarmAudioGate reports blocked audio past a short seeded grace, with ALARM_AUDIO_BLOCKED_NOTE as the one explanation every panel renders beside it), `$shared/companion` (companionApiUrl, the companion plugin route base), `$shared/testing` (sourceFeatures for a fake map's source data, throwing on a missing source rather than masking it with an empty array; fakeOverlayContext for the overlay-test context, the one place the `{ map, beforeIdFor }` shape is built; createFakeMap, whose map carries a triggerRepaint spy and whose canvas records its listeners for custom-layer overlays; createFrameFactory for SKFrames, including AIS vessels from plain records; expectBearerAuth for a captured fetch call's Authorization header; attribute and tag for pulling one attribute or tag out of server-rendered HTML, throwing when absent), and `$entities/symbols`
  (createOverlayIconResolver, the provided-symbol overlay glue). An overlay that hand-rolls a
  `getSource(...) as { setData }` cast or a `{ type: 'FeatureCollection', features }` literal should use
  setSourceData and featureCollection instead.
- Feature orchestration that the composition root used to hold inline is extracted into per-slice
  controllers: a `create<Feature>Controller(deps)` factory in a `*.svelte.ts` module that owns the
  feature's runes (state, derived, effects) and returns the handlers and getters the panels and chart
  read, services injected as arguments. A reactive dependency that changes over the session (the auth
  token, a feature-detection flag, even a stable store whose `.svelte.ts` identity must stay reactive in
  a `$derived`) is injected as a GETTER `() => value`, never by value: capturing a value at construction
  freezes the initial one, which is a real stale-value bug (a stale-token regression came from exactly
  this). The existing ones: `createMobController`, `createAnchorController`,
  `createMarineRadarController` (the first to own a Web Worker, the radar spokes stream),
  `createInstrumentsController`, `createTrendsController`, `createRouteController`,
  `createWaypointsController`, `createTrackController`, `createUserChartsController`, and `createHandoffController` (the
watch-handoff snapshots, whose fact getters App wires through `collectHandoffFacts`). App-wide
  stream connection and notification effects live in `createStreamController` and
  `createNotificationsController`, which keep worker recovery and safety announcements out of the
  composition root. The panel layer lives in `src/views/plotter/PlotterView.svelte` behind the
  `$views` index (one root `section.chart-host`, placed explicitly in the shell grid by App). App
  passes Plotter four stable dependency groups, services, controllers, entity stores, and actions,
  alongside reactive view state and bindable panel state. This keeps `App.svelte` focused on
  construction and shell chrome without adding a singleton.
- Whole-document settings that can be changed again while a request is in flight use
  `createLatestWriter`. It serializes requests, coalesces queued snapshots to the newest value, and
  exposes idle, saving, saved, and error states with retry. Do not fire independent writes for two
  controls that update the same server document.

### Find places contract

Find places and the Points of interest overlay consume the same merged Signal K notes resource and
must describe the same current viewport. Opening Find places reveals the notes overlay. The overlay
reports `idle`, `hidden`, `zoomed-out`, `loading`, `ready`, and `error` through a `PoiViewState` owned
by `$entities/poi`; do not infer provider health from an empty array. Offline cache is explicit.

Search covers name, category, source, and attribution, ignoring case and accents. Sorting uses stable
name and resource-id tie-breakers. Distance and true bearing use only a fresh vessel fix. Selecting a
row rings it and opens note detail without moving the chart, and closing or backing out clears both
selection and hover. Keep this behavior aligned with `docs/find-places.md`.

### Waypoints contract

Waypoints are standard Signal K resources. Read v2 first with a v1 read-only fallback, write and
delete through v2, validate and bound every provider-controlled field, and load the collection when
access resolves rather than depending on the live WebSocket. A collection response accepts at most
5,000 valid marks.

The controller is latest-result-wins and serializes mutations. Keep accepted adds, edits, and deletes
visible before the follow-up refresh. Failed add and edit writes leave the dialog and entered values in
place. The panel distinguishes loading, retained-data refresh, real empty, and failure. Disable writes
without access or while a mutation is pending. Starting Course API navigation from a waypoint requires
an inline confirmation that names the destination. Keep this aligned with `docs/waypoints.md`.

### Measure contract

Measure is transient session state and never persists or writes to Signal K. Use rhumb distance and
rhumb bearing for each leg, keep values in meters and radians, and convert through the shared unit
helpers at display time. Accept only valid coordinates, ignore consecutive duplicates, cap a
measurement at 1,000 points, and replace the point array on every accepted tap so overlay identity
checks cannot miss updates.

The overlay must draw the short antimeridian leg. The active strip guides the next tap and owns Undo,
Clear, Done, and Escape. The chart shows a crosshair while Measure owns taps. Selecting the active menu
item preserves current points, while Measure from here explicitly starts fresh. Keep this aligned with
`docs/measure.md`.

### Marine radar contract

Marine radar consumes the standard Signal K v2 Radar API at
`/signalk/v2/api/vessels/self/radars`. Discovery returns the current radar list, `/controls` hydrates
control state, and live values arrive on the existing Signal K stream as
`radars.{radarId}.controls.{controlId}`. The provider's `streamUrl`, resolved against the Signal K
origin when relative, carries protobuf spokes. Only same-origin spoke streams receive the Signal K
token.

The controller owns refresh, selection generations, latest-write-wins control generations, Web Worker
lifecycle, reconnect backoff, document and overlay visibility, transmit-state gating, and stale-picture
clearing. The worker flushes only when new spokes exist. The PPI renderer owns WebGL health separately
from stream health, uses spoke heading or the vessel's true heading, and renders nothing when neither is
available. See `docs/marine-radar.md` for provider, UI, safety, and test details.

This is a hard rule. Architectural feedback that came at the cost of redoing significant work
must not be repeatable.

## Signal K conformance: 100% compliance, always

- The foundation ships as a Signal K webapp: keywords `signalk-webapp` and
  `signalk-category-chart-plotters`, a `signalk` manifest with `appIcon`, `displayName`, and
  `screenshots`, the build emitted into the served directory, and `files` shipping it. No
  server plugin is required for the foundation.
- The README must contain no relative file links at all (docs/*.md, CHANGELOG.md, LICENSE,
  .github/*): the admin UI App Store README view renders link targets unmodified and rewrites only
  image paths, so relative links are dead there (verified in server-admin-ui ReadmeTab.tsx; cost
  the 0.17.1 patch to strip them). Name shipped guides as plain text and use absolute URLs only
  where a working link is essential. README image paths must resolve in the Signal K admin UI
  README view, which resolves relative
  image paths against the package root (the shipped npm tarball). Binnacle ships only `public/`
  (the Vite build output), not `static/` (the Vite `publicDir` source), so a README image
  reference must never point at `static/`: it 404s in the admin UI even though it renders on
  GitHub, where `static/screenshots/` is git-tracked. For the webapp the App Store screenshot
  carousel is driven entirely by `signalk.screenshots` (paths resolved against the served webapp
  root `public/`, populated from `static/screenshots/` at build), so Binnacle does not duplicate
  screenshots in the README the way the sibling plugins do (they ship `assets/` at the package
  root and reference `assets/screenshots/` in both the README and `signalk.screenshots`). Keep
  `signalk.screenshots` as is; it is correct and working.
- Consume the v1 streaming WebSocket. Connect with `subscribe=none` and issue explicit
  subscriptions: own vessel at high rate (`policy: instant`, heading near 200 ms, others near
  1000 ms), and AIS at a controlled rate (`vessels.*`, `policy: fixed`, period near 5000 ms,
  rendered paths only). Read `self` from `hello` and filter self out of `vessels.*`.
- Server-declared staleness (the meta.timeout enforcement's value-null delta carrying
  `state.timedOut` and `lastValue`, off by default, self context only, emitted once per timeout
  per path and `$source`) is consumed as a first-class channel: the worker routes it beside
  values in `SKFrame.selfStales` so a declaration can never refresh a freshness signal or read as
  data flow, the store retains the last good value beside a per-cell `serverStale` record, a
  declaration applies per SOURCE (a dead GPS must not mark a path its twin keeps feeding; a
  mismatched ref only retires that source's sample), any later self value, null included, clears
  the record, and the record latches across reconnects. The vessel entity's stale predicates
  treat a declaration as a fact rather than a window, which is how the status strip, orientation,
  follow, collision, MOB, anchor, shallow watch, and tiles all inherit it. A server without the
  enforcement sees byte-identical behavior, and the enforcer's own deltas carry only `$source`,
  which is why the reconciler falls back to `$source` for the source label and ref.
- All values are SI in the store (radians, meters, m/s, Kelvin). The two sanctioned exceptions are
  `navigation.position` in decimal degrees and Open-Meteo's preceding-hour precipitation in
  millimeters. Signal K provider precipitation is converted from meters to millimeters at ingestion.
  Convert all other values only at the display edge in a separate pure module.
- CPA and TCPA are not computed by the server core. Read `navigation.closestApproach` when a
  provider populates it, degrade gracefully when absent.
- Charts: discover at `GET /signalk/v2/api/resources/charts` (fall back to v1), branch on
  chart `type`, honor `bounds` and zoom limits. Layering order, visibility, and opacity are
  Binnacle's job.
- Course data (the v2 Course API) DOES stream over the v1 WebSocket as deltas: the server emits
  `navigation.course.*` and `navigation.course.calcValues.*` to delta-stream subscribers. But because
  those deltas carry the `SKVersion.v2` flag, they are NOT in the v1 full data model, so under
  `subscribe=none` the server sends no cached value until the next change. The pattern is therefore
  hydrate the snapshot via a v2 REST GET (`GET /signalk/v2/api/vessels/self/navigation/
  course` and `/calcValues`) on every connect and reconnect (so an active course survives a page
  reload and a course started or cleared from another station is picked up), then keep it live from
  the stream. Course
  MUTATIONS (activate a route, advance, clear) are v2 REST PUT and DELETE; the stream is read-only for
  course. The course state machine is built into the server core (present on any 2.x server); the
  derived `calcValues` (XTE, VMG, DTW, BTW, ETA) come from a separate course-provider plugin that
  ships by default but can be absent, so compute them client-side as a fallback (the
  `navigation.closestApproach` degrade pattern). Autopilot (v2) is still a later spec.
- Bundle the app's own assets locally (fonts, icons, worker): no CDN for code. The MAP base is
  the deliberate exception: it is an online vector tile source (OpenFreeMap), because shipping a
  world basemap inline is not feasible. Offline operation is achieved by CACHING that source through
  the browser service worker and, when Chart Locker is installed, through server-managed saved areas
  and automatic caching. Do not replace the base map with a flat inline style to satisfy "offline":
  that yields a blank map. Verify reachability before assuming a host is unreachable; OpenFreeMap
  resolves and returns 200 from the boat network.
- The offline/PWA caching (vite-plugin-pwa service worker) only activates in a SECURE CONTEXT:
  HTTPS or `http://localhost`. The Signal K server serves Binnacle over plain HTTP on the LAN by
  default, where the browser disables the entire serviceWorker and CacheStorage APIs, so offline
  caching is inert. The app must DEGRADE CLEANLY there (registerSW no-ops, OnlineStatus falls back
  to navigator.onLine, zero errors), which it does. To activate offline, enable SSL in the Signal K
  server (Server > Settings > SSL). Do not chase "the service worker is not registering" as a code
  bug without first checking `window.isSecureContext`.
- Chart Locker saved areas and automatic caching are server-side offline chart preparation, separate
  from the browser service worker. They work over the boat's ordinary Signal K connection and do not
  require HTTPS. HTTPS and a trusted certificate are still required for the browser's runtime cache.
  Keep these two cache layers distinct in UI copy, health checks, and troubleshooting.
- A SECURE CONTEXT alone is NOT enough: the browser must also TRUST the server's certificate. A
  self-signed certificate (including one the signalk-ssl plugin generates, issued by a local
  "SignalK Local CA") is not trusted by default, and browsers refuse to register a service worker
  from an origin whose certificate they do not trust, even after the user clicks through the page's
  certificate warning. The symptom is `onRegisterError` firing with a SecurityError whose message is
  "An SSL certificate error occurred when fetching the script", and offline caching staying off while
  the page itself loads. The fix is environmental, not code: install the certificate (or its CA root)
  into the browser or OS trust store and mark it trusted, then reload. register.svelte.ts detects
  this case, logs an actionable info line rather than an alarming warning, and surfaces a reactive
  status ('untrusted-certificate' among others) that the Offline charts landing page renders as a
  notice with the install-and-trust fix. Over plain http the serviceWorker
  API is absent so registerSW no-ops; over https with an untrusted cert the API is present so
  registration is attempted and fails on the cert, which is a different path from the plain-http one.
- Never import `@signalk/server-api` in browser or worker code, not even as a type-only import.
  Its entry barrel re-exports `FullSignalK`, which extends Node's `EventEmitter`; bundled into the
  worker with `events` externalized, the base class is `undefined` and the worker dies at load with
  "Class extends value undefined". Mirror the few wire types the client needs in
  `src/shared/signalk/types.ts` instead. The "events externalized for browser" build warning is the
  tell. The package may be a dev-only dependency for server-side code, but the foundation has none.
- Guard every WebSocket `send` on `readyState === WebSocket.OPEN`. The first subscriptions can be
  issued while the socket is still CONNECTING; dropping the send is safe because the subscription
  registry resubscribes everything on open.
- Server APIs over local-only storage, always (user rule): when a capability has a Signal K API
  (resources, course, notifications, applicationData), Binnacle integrates with it even when that
  requires read-write authorization rather than read-only. Local storage is the graceful degrade
  for older servers or missing auth, never the primary design. The access-request UX should tell
  the admin that Binnacle needs read-write approval (routes, waypoints, tracks, course, alarms,
  profiles all write).
- Every release must hold 100% Signal K compliance, and project files must be written per the
  Signal K spec to achieve it.

## Tracks contract

- Feed the recorder only fresh, valid vessel positions. Track points and settings remain SI.
- Treat pauses, fix outages, and implausible jumps as segment boundaries. Distance, rendering, route
  conversion, and retrace must never bridge a boundary.
- Save tracks as Signal K resource `MultiLineString` Features. IndexedDB is only the active-recording
  persistence layer, and memory-only degradation must be visible in the Tracks panel.
- Saved-resource loading is independent of the live WebSocket. Keep confirmed writes visible through
  refresh failures, reject stale refresh results, serialize server mutations, and preserve fixes that
  arrive while a save is pending.
- Retrace is a navigation action. Require confirmation, use only the latest continuous segment, and
  keep all navigation output advisory. See `docs/tracks.md`.

## Leverage mature plugins before building features

Binnacle does not need to build every capability itself. When a mature Signal K plugin already
produces the data (alarms, anchor watch, course calcValues, weather providers, symbols, history),
Binnacle's job is to CONSUME and surface it well, with a graceful client-side degrade when the
plugin is absent (the navigation.closestApproach pattern). Build a feature in-app only when no
maintained plugin covers it or when it is core chartplotter interaction (rendering, editing,
touch UX). Evaluate plugin maturity before depending on one: published on npm, active within the
last year, and a stable API surface.

## Plugin assumptions, caching, and coherence (user rules, 2026-06-12)

- NEVER assume a plugin is installed just because the owner's boat server has it. Other users
  have a STOCK signalk-server (bundled plugins only: the built-in resources-provider and
  course-provider class of things). Every plugin integration detects (the /signalk/v2/features
  endpoint or a probe) and degrades gracefully to a built-in or client-side path. Where the
  upstream API is still a proposal (the Anchor API) or pre-1.0 (symbol-manager), build against
  the current shape anyway; the weekly Signal K watch routine flags changes and the code gets
  updated then.
- A user-relevant optional capability may remain discoverable while unavailable. Offline charts is
  the canonical contract: expose one menu entry and one landing page, detect Chart Locker, and explain
  how to install, start, or authenticate to it instead of hiding the feature. Saved areas, automatic
  caching, installed charts, and storage stay grouped under that landing page.
- Provider health is not passage readiness. A compact status may report cached bytes, access state,
  reachability, or errors, but only a saved area's coverage, included charts, completion state, and
  update time support a readiness decision.
- Caching is a first-class product goal: the gold standard is "it just works" with nothing extra
  to install, including when charts and tiles are served by another plugin. Repeat visits and
  offline-degraded operation must be seamless for every tile and data source Binnacle renders
  (base map, plugin-served charts, weather, tides, notes), within sensible quotas and expiry.
- One coherent design system, not disjointed widgets: every new surface uses the shared tokens
  (src/styles/), the shared UI primitives ($shared/ui), the established interaction patterns
  (SlideOver, InlineConfirm, armed confirms, the dismiss stack, 44px targets), and the same API
  conventions (detect-and-degrade clients in the slice, SI store, display-edge conversion). A
  feature that looks or behaves differently from its siblings is not done.

## Release policy: version changes are the owner's call

Do not change the package version, publish to npm, create a release, or tag a commit without explicit
owner approval. The owner chooses whether a release is a patch, minor, or major version. The full
release verification checklist applies regardless of version size.

`docs/releasing.md` is the operational checklist. Release preparation may update metadata, notes,
documentation, tests, and workflows, but it never authorizes the final tag, published GitHub release,
or npm publication. The npm workflow runs only when a GitHub release is intentionally published.

## Build policy (every major step)

- Agent team: each major step may use an agent team of up to 6 expert agents, with at least one
  Signal K expert on steps that touch the integration. Give each a distinct, non-overlapping
  lens to avoid file conflicts.
- Cleanup gate: each major step finishes with the `/cleanup` skill.
- Fix everything: fix every finding from review, cleanup, linters, and human review, including
  low and nit. The only acceptable skip is factually refuted or by-design after honest
  scrutiny, with a one-line reason.
- Verification: after fixing, run type-check, tests, lint, and build, and confirm green before
  claiming a step done.
- Each numbered step in the spec's build order is a major step under this policy.

## Pi memory: swap covers concurrent heavy commands

This runs on a Raspberry Pi 5 (8 GB RAM, 4 cores) with 9 GB of swap configured, so concurrent
heavy verification commands (type-check, lint, test, build) no longer OOM-kill the session: the
earlier one-heavy-command-at-a-time restriction is lifted. Running several at once is fine when it
saves wall-clock; expect swap to slow each one under memory pressure, so do not fan out so wide
that thrashing costs more than it saves. `NODE_OPTIONS="--max-old-space-size=2048"` is no longer
required, though it remains a harmless backstop on a memory-heavy run.

## Style rules (override defaults)

- American English everywhere (color, behavior, center, gray), not British. Code, docs,
  commits, comments, and any text passed to subagents.
- No em dashes anywhere. Use a colon, a comma, or two sentences.
- Always use the Oxford (serial) comma in lists of three or more.
- No "&" in human-readable text (UI labels, headings, prose, comments); always write "and". The
  "&" is fine only where syntax requires it: URL query separators, HTML entities, code operators,
  and TypeScript intersection types.
- Default to no comments. Keep only non-obvious why comments. Delete what comments.
- These apply to text I write and to instructions passed to subagents; brief them on the same
  rules so their output does not reintroduce violations.

## Workflow

- Brainstorming artifacts live in `.superpowers/brainstorm/`, gitignored.
- Design specs live in `docs/superpowers/specs/` and build plans in `docs/superpowers/plans/`.
  These are local-only working notes: `docs/superpowers/` is gitignored and is NOT committed to the
  repo. Each differentiator gets its own brainstorm, spec, and plan: active-safety CoPilot, weather
  and routing, anchor intelligence, the liveaboard dashboard, and multi-station watch handoff. The
  offline and PWA pipeline is the spec immediately after the foundation.
