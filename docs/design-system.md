# Binnacle design and front-end build standard

This is the authoritative guide to how Binnacle looks, feels, and is built. Read it before designing or
building any UI. If you follow it, a new panel, menu, or feature will be indistinguishable in look and
behavior from the ones already shipped. `CLAUDE.md` holds the project's hard rules and the Signal K
integration contract; this document is the design and front-end build companion to it. When the two
overlap, neither contradicts the other: CLAUDE.md is the rule, this is the how. For the step-by-step
checklist to add one menu item, panel, and its controls without re-correcting styles, follow
`docs/building-menu-items.md`, which operationalizes this standard and catalogs the pitfalls we keep
fixing.

## 1. What Binnacle is, and the design tiebreaker

Binnacle is a from-scratch marine chartplotter for Signal K, for the bluewater cruiser and the
liveaboard. The north star: Binnacle should be so good that people adopt Signal K specifically to use
it. Every design call is decided by that, in this order: first-run excellence on a stock server, polish
over feature count, "it just works" caching, one coherent design system, and gloved-hand marine UX.

Concretely, that means: a control a wet, cold hand can hit (44 px targets), a glance that lands on the
number not its label, a night mode that does not wreck dark adaptation, and a UI where every surface
looks like it was drawn by the same hand. A feature that looks or behaves differently from its siblings
is not done.

## 2. Design tokens are the only vocabulary

All geometry, type, color, depth, and timing come from CSS custom properties defined in
`src/styles/tokens.css`. Never hardcode a literal where a token exists. The sanctioned off-scale
exceptions are the hairline spacing tier (0.05 to 0.2 rem) and the specific fine values 0.3, 0.35, 0.4,
0.45, 0.55, and 0.6 rem; anything else is a token.

### Geometry and type (theme-independent)

- Radii: `--radius-sm` 0.3rem, `--radius-md` 0.5rem, `--radius-lg` 0.75rem, `--radius-pill` 999px.
- Spacing (4px-based): `--space-1` 0.25rem, `--space-2` 0.5rem, `--space-3` 0.75rem, `--space-4` 1rem,
  `--space-5` 1.5rem, `--space-6` 2rem.
- Type scale: `--text-xs` 0.72, `--text-sm` 0.8, `--text-base` 0.85, `--text-md` 0.9, `--text-lg` 1,
  `--text-xl` 1.15, `--text-readout` 1.25, `--text-readout-lg` 1.75 (rem). Fonts: `--font-ui` (Inter)
  for chrome, `--font-mono` (JetBrains Mono) for numeric readouts. Every size pairs with a role in the
  type-role table below; a new size or a new token-role pairing is a design-system change, never a
  per-component decision.
- Targets: `--control-size` 2.75rem is the action tap target (buttons, pills, icon buttons);
  `--row-size` 2.5rem is the denser list-row height (menu items, layer toggles). Lists use the denser
  size, primary actions use the full size.
- System chrome: `--system-bar-clearance` follows the browser's bottom safe area. An installed PWA
  with a coarse primary pointer keeps at least `--system-bar-fallback` below the status-strip content
  because some Android and Samsung shells report zero while the system bar still overlays the app.
  Bottom controls add the clearance in normal layout flow so the chart shrinks above them. They do
  not use device detection, fixed positioning, or a second viewport-height calculation. Bottom and
  landscape-edge chrome must also include the appropriate `safe-area-inset-*` value.
- `--tracking-caps` 0.06em for uppercase labels, `--disabled-opacity` 0.45, `--transition-fast`
  0.12s ease for every hover and press, `--active-bar-width` 3px for the lit-row inline-start bar.
- Z-order is a token ladder, never a raw number: `--z-overlay` 1, `--z-panel` 2, `--z-safety-strips`
  (panel + 2), and `--z-menu` 5. The MOB confirm is a native top-layer `<dialog>`, above everything without a z-index.

### Type roles

Pick the token by role, never by eye:

| Token | rem | Roles |
| --- | --- | --- |
| `--text-xs` | 0.72 | caps labels (`.caps-label`), units (`.tile .unit`, `.stat-grid .unit`), abbreviations (`.abbr`), badges, panel footers |
| `--text-sm` | 0.8 | button labels (`.btn`), per-field labels, `.muted-note`, `.alert-note`, menu tile labels, panel subtitles |
| `--text-base` | 0.85 | panel body baseline (`.slide-over`), strip body text |
| `--text-md` | 0.9 | card names (`.saved .name`), nested-detail titles (`.panel-title--sub`), form-control input text (`.input`), toggle-row and picker labels, all status-strip readouts (`.readout`: one size, no hierarchy) |
| `--text-lg` | 1 | rare dialog emphasis (a dialog heading, a conditions readout) |
| `--text-xl` | 1.15 | panel titles (`.panel-title`) and the MOB confirm's modal heading |
| `--text-readout` | 1.25 | the bottom-strip metrics (`.bottom-strip .metric`) and the position tile's two-line coordinates |
| `--text-readout-lg` | 1.75 | instrument tile hero values only |

Two nearby sizes on the same surface for the same role is drift, not hierarchy: reuse the role's
token. A component that wants a size this table does not grant its role is asking for a design-system
change, and that conversation happens here, not in the component.

### Color is semantic, not literal

Use the role, never the hex. The roles: `--text`, `--text-muted`, `--accent`, `--accent-contrast`
(text on a filled accent button), `--accent-tint` and `--accent-tint-strong` (active or lit fills),
`--select` (the highlight/picked token), `--ok` (healthy dot), `--alarm` (danger), `--warning`
(caution, one step below alarm), `--border`, `--surface` (the app base), `--surface-raised` (cards,
inputs), `--surface-overlay` (floating panels). Tints are defined per theme, never as a global
`color-mix`, so night-red never drifts toward blue or green.

Depth: `--shadow-overlay` (small floating cards), `--shadow-lg` plus `--edge-light` (the largest
surfaces: the menu popout, the weather panel, the slide-overs), `--scrim` (modal backdrop).

## 3. Themes: day, dusk, night-red

Three themes, switched by `:root[data-theme]`. Day is the `:root` default (a light theme, `color-scheme:
light`). Dusk is a calm dark theme. Night-red is the discipline: pure red on true black, no blue or
green anywhere, alarms always distinguishable, the brightest pixel kept low.

You almost never write theme-specific CSS. You write tokens, and the theme carries the value. The rules
that matter when you do touch this:

- Night-red drops `--shadow-overlay`, `--shadow-lg`, and `--edge-light` to `none` (a black shadow on
  true black is invisible; the deeper red `--border` is the only surface separation). So never rely on a
  shadow alone to separate surfaces: a border must also be present.
- Green is forbidden at night: `--ok` collapses to a dim red told from `--alarm` and `--warning` by
  brightness, not hue. If you add a status color, it must survive this: distinguish by brightness, never
  by hue alone.
- Danger and caution must stay distinguishable in every theme. `--alarm` is the brighter, `--warning`
  the dimmer; that brightness gap is the contract.

## 4. The modular CSS architecture

`src/app.css` is only an ordered `@import` manifest over `src/styles/` modules, and the import order IS
the cascade order. Do not reorder it blindly: the order keeps `.is-on` (in `icon-controls.css`) able to
light the bases that precede it, and keeps `overlays.css` and `panels.css` after the bases they extend.
The order is: maplibre, tokens, base, text, buttons, forms, cards, instruments, icon-controls,
scrubber, overlays, reorder, panels, strips, a11y, vendor. (`reorder.css` follows `overlays.css` so
the dragging state wins over a lit `.row-interactive.is-on` row at equal specificity.)

Rules:

- One concern per module. New global styling goes into the right module, never back into a monolith and
  never into a component when a global class is the right home.
- Hoist at the second copy. When the same markup or CSS appears in a second place, hoist it into a
  shared global class or a shared primitive. A third copy is a review failure.
- Same purpose, same control. A control that does the same job on two surfaces carries the identical
  accessible-label pattern, variant, and box everywhere ("Customize toolbar" and "Customize
  instruments" are the same ghost button). Backdrop tint may differ, since a ghost inherits its
  surface; the control itself may not. Judged at the second copy, like CSS.
- A component's scoped `<style>` is for layout that is genuinely local to that component. It composes
  global classes and tokens; it does not re-implement them. A panel that re-declares the row chrome, the
  card frame, the alert banner, or the field shape that a global class already provides is wrong.
- Svelte injects scoped CSS after the global sheet, so at equal specificity a component's scoped rule
  wins. When composing a global class whose state you need to win (the lit `.is-on`, a hover tint), the
  component must not set the competing property (background, border-color) in its scoped base, or it
  will defeat the shared state. See `.row-interactive` in `overlays.css` for the worked pattern,
  including the border-longhand technique for reserving a lit border.

## 5. Global utility classes (the shared vocabulary)

Reach for these before writing scoped CSS. Each lives in the named module.

- Base (`base.css`): `.bare-list` (list-style, margin, and padding reset for a `<ul>` or `<ol>` used
  as a layout container, not a semantic list).
- Buttons (`buttons.css`): `.btn` (the base bordered button, 44px), `.btn-primary` (filled accent),
  `.btn-danger`, `.btn-ghost`, `.btn--grow` (flex-fill), `.segmented` (a joined row of `.btn` for a
  binary or small-enum choice; the active segment carries `.is-on`).
- Icon controls (`icon-controls.css`): `.icon-btn` (square icon button), `.icon-btn--accent`,
  `.icon-btn--danger`, `.icon-pill` (a pill-shaped icon toggle), the `.panel-close` and
  `.panel-minimize` panel header controls, and the shared `.is-on` lit state (accent color, accent
  border, accent-tint fill) that lights any composing control.
- Forms (`forms.css`): `.input` (text inputs and selects, 44px, raised fill), `.range` (the live
  slider, paired with a `.num` readout), `.panel-controls` (a row of action buttons under a header).
- Text (`text.css`): `.caps-label` (the uppercase, tracked, muted SECTION heading), `.muted-note` (a
  quiet hint for empty states and inline guidance), `.alert-note` (an outline alarm banner) and its
  `.alert-note--filled` tinted variant, `.sev-danger` and `.sev-warning` (severity text coloring),
  `.panel-title` and `.panel-title--sub` (the panel header title and subtitle), `.num` (mono tabular
  numerals for any aligned readout). The status strip's own `.readout` spans (StatusStrip.svelte,
  component-scoped, not a global class) follow one idiom throughout: a bare-word label with no colon
  (SOG, COG, HDG, Depth, Vessel, Time), then the value wrapped in `.num`. A trailing physical unit
  (kn, °T, ft, m) stays outside the `.num` span as plain text. The Time readout uses local time, and
  any qualifier that is part of reading a value itself, such as AM or PM, stays inside the `.num` span
  with that value.
- Cards (`cards.css`): `.card-frame` (the raised bordered card surface, border + radius-sm +
  surface-raised), `.saved` plus its card list (used through the SavedList primitive), `.stat-grid`
  (the label/value stat readout), the `.nav-*` family (`.nav-sort`, `.nav-list`, `.nav-row`,
  `.nav-name`, `.nav-metrics`, `.nav-metric`) for the AIS and POI two-line sortable lists. A selected
  row uses `aria-current="true"`, an accent border, an accent tint, and a leading inset accent line;
  hover or keyboard preview alone must not claim selection.
- Instruments (`instruments.css`): the `.tile` vocabulary on the `.card-frame` surface, shared by
  NumericTile and WindTile: the `--text-readout-lg` hero `.num`, the `--text-xs` `.unit` and `.abbr`,
  the zone tints (`.tile--warning`, `.tile--alarm`, `.tile--stale`), `.tile--wide`, and `.tile--empty`.
  Tiles in one grid stay equal height in every state: the `.value` slot reserves the hero line box
  (`--hero-leading`), and a no-sensor tile renders its `.muted-note` gloss inside that slot, centered,
  never collapsing shorter than its value siblings. Tile content centers on both axes (the gauge-face
  read); instrument tiles are the one centered numeric family, and list rows, stat grids, and
  nav-metrics stay start-aligned. Tile marks (the `viz` field on a TileDef) are quiet inline SVG in
  `currentColor`, never brighter than the value: `Sparkline` (recent-history polyline for continuous
  numerics), `BatteryBar` (charge fraction, zone-tinted), and `RotNeedle` (turn-rate half-dial);
  circular and stepped values carry no mark. The
  position tile is the one hero-size exception (`--text-readout`, the secondary readout), because two
  coordinate lines at hero size would double the tile. The dock grid fills its column: rows share the
  full dock height (`grid-auto-rows: minmax(min-content, 1fr)`, falling back to min-content and the
  dock scroll when the tile set outgrows it), tile content centers vertically in a stretched row, an
  empty tile is never full width (`.tile--empty` overrides the full-row modifiers back to a single
  column), and `grid-auto-flow: row dense` keeps the grid hole-free, allowed to deviate from the
  customize order only where a hole would otherwise sit. Instrument tiles are buttons: selecting one
  opens an in-dock detail view with value, status, zone, source, update age, and the Signal K paths
  behind the reading. The button's accessible name includes the value, unit, freshness, alarm zone,
  and action. Warning, Alarm, and Stale also render as visible text badges, never color alone.
  Customize groups available instruments by category, and its Rescan action reruns instance discovery
  for batteries, engines, tanks, solar, and cabin sensors. Discovery unions the live Signal K model
  with concrete paths recorded during the preceding year by registered history providers within a
  bounded scan. A previously seen reading remains enabled for configuration and carries the visible
  "Previously seen, no live data" status.
  Every dynamic tile label leads with the reading and then names its source, such as "RPM · Port
  engine" or "Level · Fresh Water Main tank." Customize resolves any remaining repeated catalog
  label with its abbreviation, description, and stable id in that order, so every visible and
  accessible option stays distinct when another reading family is added.
  The status remains in Shown and instrument detail until a live sample arrives. Scan progress and
  provider failures use a status message while retaining live and previously accepted results.
  Context-scoped value checks prevent another vessel's catalog paths from appearing. Stored samples
  never populate a live instrument tile.
- Overlays (`overlays.css`): `.popover-card` (the small anchored floating-card frame), `.surface-elevated`
  (the larger floating-panel frame: surface + border + radius-lg + shadow-lg + edge-light, used by the
  app-menu launcher and the weather panel), `.menu-item` (the flat control-height interactive menu row),
  `.row-interactive` (the shared control-height transparent interactive row that tints on hover and
  lights via `.is-on`; composed by the weather and route menu rows, the icon picker, and the layers
  category header), `.overlay-backdrop` (the transparent dismiss backdrop), `.unavailable` (the
  grayed-out treatment for a row whose provider is absent, shared by the layer rows and the
  instrument customize list).
- Panels (`panels.css`): `.slide-over` and `.slide-over--dock-{left,right}` (the docked panel frame),
  `.panel-header`, `.panel-body`, `.panel-body--flex` (the bodyFlex column), `.panel-footer`, and
  `.panel-slot` plus its `--end` modifier (the absolute-positioned dock slot for a docked panel,
  shared by App.svelte and PlotterView.svelte).
- Overlays, modals: `.modal-card`.

## 6. Shared UI primitives (`$shared/ui`)

Shared behavior lives here. Compose these; do not re-implement them.

- `SlideOver`: the docked panel shell. Props: `title`, `subtitle`, `ariaLabel`, `dock` (left default),
  `bodyFlex` (lay the body out as a 0.6rem gapped column; pass it on any panel whose body is a stack of
  controls), `closeLabel`, `onClose`, `onBack` (when set, a leading back arrow returns to the menu via
  the App's `backToMenu`; omit on panels opened from the chart), `headerExtra`, `footer`, and `minimize`
  (a phone collapse-to-header control). Use `minimize` when a phone workflow needs a chart gesture:
  collapse before enabling the gesture, then restore the panel when it finishes or is canceled.
  Offline area drawing is the canonical example. Every left-docked panel is a SlideOver.
- `PanelHeader`: the header triad, a back arrow, the title and subtitle heading with an optional
  interleaved `headerExtra`, a minimize control, and the close button. SlideOver renders its header
  through it, and the floating weather map panel and the instruments dock reuse it (the dock passes
  its compact "Customize" entry through `headerExtra`, with "Customize instruments" retained as the
  accessible name), so the headers cannot drift apart. Do not
  hand-roll a panel header.
- `AnchoredMenu`: the popover primitive (a backdrop plus a positioned surface with a scale transition
  and the dismiss-stack registration). Use it for any anchored menu (the app-menu launcher, the
  bottom-bar More menu, the opacity popover). Pass it a `surfaceClass` to position and frame the
  surface, a `role` (`group` by default, `menu` for a true menu with roving focus), and a `surfaceStyle`
  for an inline clamp position.
- `OverflowActions`: a labeled More button and keyboard-focused anchored menu for secondary saved-card
  actions. Keep one primary action visible, then move dense secondary actions here instead of wrapping
  five or six icon-only controls across a phone card.
- `CustomizeToggle`: the edit-mode entry control (see "Edit modes" below). Props: `object` (the
  label's object noun), `editing`, and `onToggle`. Render it, never a hand-written ghost button.
- `createReorder`: the shared pointer and keyboard reorder controller. Use it when a list can be
  reordered outside the Layers panel, such as the app menu's toolbar editor. Pass a stable row
  attribute and handle selector; keep the persisted order in the owning feature, not in the UI row.
- `InlineConfirm` and `ConfirmArm`: the armed two-step confirm for destructive actions and immediate
  navigation handoffs. Never a blocking `window.confirm`. The prompt names the effect and, for derived
  guidance, the data scope. Retrace track names the latest continuous segment.
- Edit modes: a surface with a customize mode gets exactly one entry control, the `CustomizeToggle`
  primitive (a `.btn btn-ghost` text button at intrinsic width trailing in its header row), with the
  accessible name "Customize <object>" (as in "Customize toolbar" and "Customize instruments"). A
  constrained header that already names the object may display the compact text "Customize" while
  retaining that full accessible name. The label swapping to "Done" is the entire state story: never
  aria-pressed or is-on. The mode opens with one leading `.muted-note` line stating what a tap now
  does. The instrument dock and the menu's toolbar editor are the two shipped examples; both render
  the primitive, never a hand-written copy.
- `ArmedRow`: a keyed one-at-a-time delete confirm for a list of rows (the routes, tracks, waypoints,
  profiles, and Chart Locker saved-area panels): arming one row disarms the rest. Use it instead of a
  per-panel `confirmingDelete` id. `ConfirmArm` stays the single timed strip.
- `UnitField`: the labeled number-input-with-unit row for stored SI thresholds (commit on blur, snaps
  back to the effective value). Use it for a single number field with a unit; do not use it for a live
  drag (that is a `.range` slider).
- `SavedList`: the saved-item card list (used by routes, tracks, waypoints, profiles). Renders the
  `.saved` card frame and the actions row, plus the caps heading and the `empty` state; the panel
  supplies the card body. Do not also render your own `<h3>` for the same list. A server-backed list
  must distinguish loading, refresh with retained cards, real empty, and failure outside the
  primitive. Disable conflicting mutations while one is pending.
- `createPanelMinimize`: the shared reactive controller passed to `SlideOver` as `{minimize}`. Use its
  `collapse`, `expand`, and `onToggle` methods instead of creating panel-local collapse state.
- `SubViewHeader`: the back header for an in-panel sub-view drilled into inside one SlideOver (the
  Layers panel opening a chart-source detail). The parent suppresses its own panel-level back while
  it is open, so only one back control shows.
- `TextField`: the labeled text-input row (inline or stacked variant), a controlled value that
  commits on blur or Enter. It also offers a live `onInput` (validate while typing), a `focusOnOpen`,
  an `onEnter` submit, `disabled`, `maxLength`, and a `large` deck-glove size. Use it for any labeled
  text field; never a raw `<input type="text">`.
- `NameEntry`: the inline name form that replaces `window.prompt` (Enter saves, Escape cancels, the
  seeded default starts selected). Seed it with `defaultSaveName`.
- `Disclosure`: the labeled collapsible section for a "Customize" or "Advanced" group. The prop is
  `expanded` (bindable), never `open` (which collides with `window.open`).
- `LayerToggle`: the layer or chart toggle row, with a `description` that becomes the hover and focus
  tooltip. Set a plain-language `description` on every toggle row.
- `VisibilityToggle`: the show/hide eye toggle for a saved overlay item.
- `IconPicker`: the waypoint and note symbol chooser. Pass `disabled` with the enclosing mutation
  state so a pending dialog cannot change fields while its accepted values are in flight. Its list
  chooses the roomier vertical direction and clamps to the live viewport.
- `ShowOnChartToggle`: the full-width "Show X on chart" `.btn` toggle in a panel body that mirrors a
  layer's visibility, with the Layers eye as the source of truth.
- `UnavailableHint`: the grayed hover tooltip and screen-reader text for a capability whose provider
  is absent (used by the app menu, the status strip, and the layer rows).
- `createReorder`: the pointer-and-keyboard drag-reorder controller (the layer rows and the
  instrument customize list). Three contracts are load-bearing. First, render the rows in the same
  order as the `getItems` movable list, not some fixed source order; if the visible rows and the
  movable list diverge, a drag commits but the rows never appear to move, which reads as broken.
  Second, compose the shared `.reorder-row` class (`styles/reorder.css`) on each row and feed it the
  drag feedback: `class:dragging={dragId === id}` and `class:drop-before`/`class:drop-after` from
  `indicatorFor(id)`, so the carried row lifts, an accent line marks the drop edge, and the grip
  lifts on hover, identically in every list. A row that wires the commit but omits the feedback
  snaps to its new spot with no animation, which reads as inconsistent. Third, the grip carries
  `touch-action: none` (provided by `.reorder-row .handle`), or a touchscreen claims the gesture as
  a scroll and the drag never fires.
- `PANEL_TRANSITION_MS`: the shared panel fly and slide duration in milliseconds, used by SlideOver
  and the weather panel so the two transitions stay in sync. JS transition timings sit outside the
  CSS token contract.
- Focus and dialog helpers: `rovingFocus`, `focusOnMount`, `onKeydownAction`, `isTabKey`,
  `dialog`, and `registerDismiss` (the Escape dismiss stack that peels the topmost surface first).
- `pickTextFile` and `readErrorMessage` for file import; `defaultSaveName` to seed a save name, and
  `resolveSaveName(value, kind)` to fall a blank entry back to that default. The old `window.prompt`
  wrappers were removed; collect or rename a name with the `NameEntry` primitive.
- `THEMES`, `ThemeController`, `createThemeController` for the theme switch.

## 7. Panel anatomy and the field idioms

A left-docked panel is a `SlideOver` whose body is a column of sections. The conventions, learned from
every shipped panel (alarms, anchor, tracks, weather, routes, the radar controls):

- Lay the body out with `bodyFlex`, never a hand-rolled `display: flex; flex-direction: column`
  wrapper, so the 0.6rem section rhythm matches across panels.
- A section is a `<section>` with a leading `.caps-label` heading and a column of controls beneath, the
  alarm-thresholds `.group` pattern. Use a section heading to title a group; do not use `.caps-label` as
  a per-field label.
- Two label idioms, used deliberately:
  - Section headings: `.caps-label` (uppercase, tracked, muted). One per group, never per field.
  - Per-field labels: sentence case, muted, `--text-sm`, the `UnitField` `.name` style. A column of
    sentence-case field labels reads as fields; a column of uppercase labels reads as a stack of
    headings, which is noise.
- Field layout, by control mix:
  - A simple number field with a unit is `UnitField`: label on the left (flex-fill), input and unit on
    the right, at control-size height.
  - A panel that mixes wide live sliders with selects (the radar controls) puts the label on its own
    line above a full-width control, so every slider track and select box shares one left and right
    edge. For a slider, the live value sits on the label row, right-aligned, in a `.num` span. This is
    the only layout that keeps a long label and a usable-width slider from fighting for one row.
- Control patterns:
  - Live, dragged value (gain, opacity, range): `<input type="range" class="range">` with a `.num`
    readout. Never `UnitField` (that is a commit-on-blur text field).
  - Binary or tiny-enum choice: the `.segmented` group of two or more `.btn`, the active carrying
    `.is-on` and `aria-pressed`. A lone "Off" button is ambiguous; the segmented pair makes the state
    self-evident.
  - A larger enum: `<select class="input">`, full width in a label-on-top field.
  - A toggle list row (a layer, a weather overlay): `.row-interactive` with `.is-on` for the lit state.
  - A saved-item list: `SavedList` over `.card-frame` cards.
  - A destructive or immediate navigation action: `InlineConfirm` (armed), never a blocking confirm.
  - A row of panel actions (Save, Cancel, New): `.panel-controls`.
- Display values are SI in the store; convert only at the display edge. This includes provider-defined
  controls such as radar range in meters, angles in radians, and durations in seconds. Convert both the
  value and its capability bounds for the widget, then convert the committed value back to SI.
- A live-data panel reports transport, data freshness, and renderer health separately when they can fail
  independently. Never label an open connection as live until usable data arrives, and clear a stale
  safety-relevant picture instead of leaving it frozen on screen.
- Empty and degraded states are first-class: a `.muted-note` for "none yet", an `.alert-note` for an
  error, a grayed unavailable row with a tooltip (via `UnavailableHint`) when a provider is absent.
  Never a blank panel.
- Reserve `.alert-note` with `role="alert"` for actionable failures and safety state changes. Access
  guidance and ordinary degraded capability explanations use `.muted-note` with `role="status"` when
  a live announcement is useful. Loading and saving copy uses the single ellipsis character `…`.
- Determinate progress always has both a visual bar and visible progress text, such as a percentage,
  byte count, or item count. Give the bar `role="progressbar"`, numeric aria values, and matching
  `aria-valuetext`; never rely on an unlabeled thin track.

## 8. Menus

- The app menu is the `AppMenu` launcher: a `.surface-elevated` frame holding a grid of tiles grouped by
  helm intent. A menu entry is a `MenuItem` (`id`, `label`, `shortLabel` for the bottom-bar pill,
  `icon` a lucide component, `group` a section heading, `pressed` for a toggle's lit state,
  `disabled` plus `disabledLabel`, `available` plus `unavailableHint`, `onSelect`). Groups today:
  Map, Navigate, Safety, Weather, Instruments, Offline charts, and Settings.
  Safety stays before Weather and Instruments; Settings stays last. Adding a menu option is one more
  `MenuItem`, never a change to the menu component. A capability whose provider is absent sets
  `available: false` with an `unavailableHint`: the launcher and bottom bar render it grayed and
  non-interactive with the hint as a tooltip and screen-reader text, rather than dropping it from the
  menu. (`disabled` plus `disabledLabel` is the transient block for an action that is momentarily
  unavailable, such as a chart still loading.)
- A user-relevant optional feature never disappears merely because its provider is missing. Offline
  charts is the canonical case: its one menu entry remains visible with `available: false`, and its
  `unavailableHint` explains how to install, start, or sign in to Signal K as an administrator. When
  available, that entry opens one landing page for saved areas, automatic caching, installed charts,
  and storage, rather than exposing provider internals as separate menu tiles.
- A compact subsystem status reports only what it knows. The Offline header control may report cached
  bytes, required access, an unreachable service, or an error. It must never turn provider health into
  a claim that a passage is ready. Coverage, included charts, completion state, and update time belong
  on the saved-area card where the navigator can verify them together. Its access-needed state links
  directly to Signal K administrator sign-in in the current PWA window, with a redirect back to the
  current Binnacle route. A non-administrator session and an administrator session refused by Chart
  Locker are separate states. The latter offers retry instead of another sign-in prompt.
- Chart Locker management clients authenticate with the browser's Signal K administrator session.
  They must not attach Binnacle's device bearer token because it can mask a valid administrator
  cookie. Use `/skServer/loginStatus` to classify a management-route 401 or 403.
- An anchored menu (a popover hung off a control) is `AnchoredMenu`. A modal is the rare exception
  (a native `<dialog class="modal-card">` opened via the `dialog` action, which calls `showModal()`),
  used for the waypoint editor and the MOB confirm.
- The bottom bar renders the pinned `MenuItem`s in stored order (using `shortLabel`) plus a More
  overflow. The app menu's toolbar edit mode owns membership, order, reset, and the live reorder
  announcement; the bar only renders the resolved list.
- The Layers and charts panel opens on chart sources first. The Charts view lists server and user chart
  sources, opens chart detail from the row gear, shows bounds when known, and keeps "Add a chart" for
  user PMTiles URLs. The Overlays view is for overlay visibility, opacity, and stacking controls.

## 9. Interaction and accessibility

- 44 px (`--control-size`) for every action target; the denser `--row-size` for list rows.
- Destructive actions and derived-guidance navigation handoffs arm with `InlineConfirm`. They do not
  fire on a single tap.
- Escape peels the topmost surface via the shared dismiss stack (`registerDismiss`), in last-opened
  order, not a raw window listener.
- A temporary chart-tap mode changes the chart cursor where a pointer exists, keeps a live strip with
  the next gesture, and restores the prior cursor and interaction state on exit. The Measure tool is
  the reference.
- A visible label must be associated with its control: a `<label for>` for a single control, or
  `aria-labelledby` pointing at the label span for a control or a `role="group"` (the radar field
  pattern). Do not lean on a redundant `aria-label` when a visible label exists.
- A live status uses `role="status"` and `aria-live="polite"`; the one assertive collision channel is
  owned by `App` and never duplicated.
- The lit state is `.is-on` (accent color, accent border, accent-tint fill). Hover tints to
  `--accent-tint`. Both come from the shared classes; do not invent a per-component lit style (the MOB
  alarm-tint and the instrument tile's zone tint, `.tile--warning` and `.tile--alarm` from the global
  `styles/instruments.css` vocabulary driven by Signal K meta.zones and raised notifications, are the
  two sanctioned exceptions).
- Reduced motion is honored: SlideOver and AnchoredMenu zero their transitions under
  `prefers-reduced-motion`.

## 10. Icons

- App chrome uses `@lucide/svelte` components, sized in px (`size={18}` for inline, `size={20}` for a
  control), always `aria-hidden="true"` when a text label is present. Pick an icon that reads true:
  AIS targets is a ship, the radar is the radar sweep glyph, an anchor is an anchor.
- Chart symbols are a separate system: they derive from the S-52 Presentation Library and OpenBridge,
  not from the UI icon set. That pipeline is a later spec.

## 11. Front-end coding standards

- Svelte 5 runes only: `$state`, `$derived`, `$derived.by`, `$effect`, `$props`. No Svelte 4 stores or
  idioms. A reactive dependency injected into a controller is passed as a getter `() => value`, never by
  value, or it freezes at construction (a real stale-value bug class).
- Feature-Sliced Design: imports flow strictly downward, `app -> views -> widgets -> features ->
  entities -> shared`. No same-layer slice-to-slice imports. Every slice exposes a public API via
  `index.ts` with named re-exports only, never `export *`. Cross-feature data flows through an
  `entities` store, never feature to feature. These boundaries are machine-enforced by dependency-cruiser
  and fail the build.
- Feature orchestration lives in a `create<Feature>Controller(deps)` factory in a `*.svelte.ts` module
  that owns the feature's runes and returns the handlers and getters the panels and chart read. Services
  (the Signal K client, the map, the stores) are constructed in `app/App.svelte` and passed down as
  props, not global singletons, so they are swappable in tests.
- Signal K REST orchestration should receive a narrow injected client rather than constructing its own
  transport. Read credentials through a getter because tokens can change after construction. Keep
  write-outcome handling instance-scoped in new code; compatibility functions exist only for
  incremental migration.
- `SaveStatus` renders the shared saving, saved, and retryable-error feedback for persisted controls.
  Pair it with `$shared/lib` `createLatestWriter` when several controls update one server document.
  The writer serializes requests and coalesces pending snapshots so stale responses cannot restore an
  older setting.
- Destructive privacy actions use `InlineConfirm`, state exactly which local owners are cleared, and
  state which server resources remain. A blocked safety check is an alert, a partial erase names the
  failures, and any successful deletion reloads immediately so live stores cannot repopulate it.
  Browser Web Locks extend the safety guard across open Binnacle tabs when the browser supports them.
- Persisted UI state enters through a bounded codec. Invalid stored data repairs to the documented
  fallback, and known legacy shapes migrate to a clean literal. A record codec must rebuild the fields
  it owns when unknown fields should be removed; a predicate-only codec validates the accepted shape
  but does not rewrite it.
- Units: all values are SI in the store (radians, meters, m/s, Kelvin). The two sanctioned
  exceptions are `navigation.position` (decimal degrees) and Open-Meteo's preceding-hour
  precipitation in millimeters, read only at the display edge and labeled as an hourly rate. Signal
  K provider precipitation is converted from meters to millimeters at ingestion. Convert all other
  values only at the display edge, in a separate pure module.
- Plugins are detected and degraded, never assumed: a capability backed by a Signal K plugin detects the
  provider (the `/signalk/v2/features` endpoint or a probe) and falls back to a built-in or client-side
  path when it is absent. See CLAUDE.md for the full Signal K integration contract.
- Reuse the shared non-UI helpers (`$shared/lib`, `$shared/map`, `$shared/geo`, `$shared/signalk`,
  `$entities/symbols`) before re-implementing them.

## 12. Writing and copy rules

These apply to UI text, headings, labels, comments, commits, and docs.

- No em dashes anywhere. Use a colon, a comma, or two sentences. Keep regular dashes to a minimum.
- Always use the Oxford comma in a list of three or more.
- No "&" in human-readable text; write "and". The "&" is fine only where syntax requires it (URL query
  separators, HTML entities, code operators).
- American English (color, behavior, center, gray).
- Default to no comments. Keep only non-obvious why-comments; delete comments that restate what the code
  does.
- Never describe the AI or review process in any user-facing or repo-facing writing (changelogs,
  commits, release notes, READMEs, PRs). Title and describe by what changed.

## 13. Recipe: add a new panel consistently

For the full step-by-step with the reuse decision tables, the cascade and collision traps, the copy
and accessibility checklists, and the pre-flight list, follow `docs/building-menu-items.md`. The
short version:

1. Create the feature slice under `features/<name>` with an `index.ts` public API. If it orchestrates
   runes or a service, add a `create<Name>Controller(deps)` in a `*.svelte.ts` module.
2. Build the panel as a `SlideOver` with `bodyFlex`. Title it, give it a `closeLabel`, wire `onClose`,
   and add `onBack` if it is reached from the menu.
3. Lay the body out as `<section>`s with `.caps-label` headings. Use the field idioms in section 7:
   UnitField for SI number fields, `.range` plus `.num` for live sliders, `.segmented` for binary
   choices, `select.input` for enums, `SavedList` for saved items, InlineConfirm for destructive or
   immediate navigation actions, and `.panel-controls` for the action row.
4. Use only tokens and shared classes. If you need a shape twice, hoist it into a shared class or
   primitive, not a second scoped copy.
5. Wire it in `app/App.svelte`: construct the controller and services there and pass them down, render
   the SlideOver in the panel slot, and add a `MenuItem` to open it. If a user-relevant provider is
   optional, keep the item visible with `available` and an actionable `unavailableHint`; do not hide
   it conditionally.
6. Run `npm run verify`, all green. Run `npm run verify:browser` when app-shell, layout, map,
   interaction, or browser behavior changes. CI adds WebKit, package, and runtime audit coverage
   through `npm run verify:release`. See `docs/building-menu-items.md` section 0 for the per-file
   loop and tooling traps.
