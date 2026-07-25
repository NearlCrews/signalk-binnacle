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
- Map: MapLibre GL JS 5.x used directly, plus a thin imperative LayerManager for dynamic
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
  `no-misused-promises` for non-test TypeScript. Do not add general, stylistic, unused-code, or
  import-boundary ESLint rules that duplicate Biome, Knip, or dependency-cruiser.
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
- Type-check: `npm run check` runs svelte-check against `tsconfig.app.json`, then TypeScript against
  `tsconfig.node.json`. The second pass covers Vite, Playwright, Vitest setup, and E2E code, and it
  requires the direct `@types/node` development dependency.
- Other owners: dependency-cruiser enforces Feature-Sliced Design and cycles, Knip owns unused
  files, exports, and dependencies, markdownlint and cspell own maintained prose, Vitest V8 owns
  the coverage floor, Size Limit owns built asset budgets, and publint plus
  `scripts/check-package.mjs` own package integrity.
- Additional libraries are allowed when they genuinely beat building in-house (user rule,
  2026-06-12), but only after EXTENSIVE research for the best one: compare the real candidates on
  maintenance activity, weekly downloads, bundle cost, API fit, license, and issue health, and
  record the comparison in the commit or PR description. Never adopt the first search hit; never
  add a dependency a few dozen lines of owned code would cover better.
- Keep every dependency at its latest compatible version. The stack is on Vite 8, TypeScript 6,
  Svelte 5, MapLibre GL JS 5.24 (used directly, not svelte-maplibre-gl), pmtiles 4, Comlink 4,
  and pbf 5 (its v5 rewrite is pure ESM with the old `Pbf` class split into `PbfReader` and
  `PbfWriter`, no default export; the radar protocol's decoder imports `PbfReader`, the encoder
  and test fixtures import `PbfWriter`).
  A MapLibre GL JS 6 migration was tried and reverted (2026-07-08): the `6.0.0-20` prerelease has
  an upstream bug where a vector tile source's internal load bookkeeping never flips true even
  though its tiles fetch and paint normally, so `map.loaded()` never returns true and the `'load'`
  event this app's whole chart initialization hangs off never fires, silently disabling everything
  past the bare base map (centering, the layers panel, routes, waypoints, tides, AIS, anchor
  watch). A workaround shipped and was verified working, but v6 is still too unstable this early in
  its prerelease cycle to build on; revisit once v6.0.0 ships stable.
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
  onKeydownAction focus actions, the isTabKey helper, the pickTextFile importer, the NameEntry name
  form with its defaultSaveName and resolveSaveName helpers, and the PANEL_TRANSITION_MS shared panel-transition-duration constant) and the
  global utility classes (the `.btn` system, `.icon-btn`, `.icon-pill`, `.popover-card`, the
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
  `.num`, and the `.nav-*` family (`.nav-sort`, `.nav-list`, `.nav-row`, `.nav-name`, `.nav-metrics`,
  `.nav-metric`) shared by the AIS targets and POI search panels)
  before any panel grows a scoped duplicate. Lay a panel's body out with SlideOver's `bodyFlex` prop
  rather than a hand-rolled flex column, so the section rhythm matches across panels. When the same
  markup or CSS appears in a second place, hoist it; a third copy is a review failure.
- Reuse the shared non-UI helpers before re-implementing them: `$shared/lib` (isRecord, formatPercent,
  formatFixed, formatBytes and the unit formatters including lengthUnit, the SI converters, uuidv4), `$shared/map` (featureCollection,
  emptyFeatureCollection, setSourceData, iconOffsetExpression with CENTERED_OFFSET, removeLayersAndSources,
  setLayersVisibility, createSafetyOverlay for safety-band rasters, ensureSource and removeSharedSourceIfOrphaned
  for a MapLibre source two overlays share, setPaintProp and getPaintProp for a dynamically-computed
  paint property name (casts once through MapLibre's keyed paint types instead of re-spelling `as
  keyof AllPaintProperties` / `as never` at each call site), rgbaCss), `$shared/geo`
  (latLonToLonLat and the single lat/lon-to-GeoJSON-order crossing, the Bbox4 bounding-box tuple,
  quantizeLatLonKey for a position-keyed reactive cell, VIEWPORT_FETCH_PAD_FRACTION), `$shared/signalk` resource.ts (jsonOr, sendJson, fetchKeyedResource, the authenticated fetchAuthedJson, and postResource) and meta.ts (fetchPathMeta, zoneStateFor), `$shared/companion` (companionApiUrl, the companion plugin route base), `$shared/testing` (sourceFeatures for a fake map's source data, throwing on a missing source rather than masking it with an empty array; expectBearerAuth for a captured fetch call's Authorization header), and `$entities/symbols`
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
  `createInstrumentsController`, `createRouteController`, `createWaypointsController`,
  `createTrackController`, and `createUserChartsController`. App-wide stream connection and
  notification effects live in `createStreamController` and `createNotificationsController`, which
  keep worker recovery and safety announcements out of the composition root. The panel layer lives in
  `src/views/plotter/PlotterView.svelte` behind the `$views` index (one root `section.chart-host`,
  placed explicitly in the shell grid by App). App passes Plotter four stable dependency groups,
  services, controllers, entity stores, and actions, alongside reactive view state and bindable panel
  state. This keeps `App.svelte` focused on construction and shell chrome without adding a singleton.
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
- README image paths must resolve in the Signal K admin UI README view, which resolves relative
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
  into the browser or OS trust store and mark it trusted, then reload. register.ts detects this case
  and logs an actionable info line rather than an alarming warning. Over plain http the serviceWorker
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
