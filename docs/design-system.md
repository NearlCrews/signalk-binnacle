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

### Equal, aligned, and consistent

The owner's standing layout rule, and the test every surface is judged by: things that repeat are the
same size, sit on shared lines, and look the same.

- **Equal.** Repeated items in one row or grid share one module. Every cell, tile, or button in it is
  the same width, and an item that needs more takes a whole multiple (the vessel position takes two
  status-bar columns), never an odd size of its own.
- **Aligned.** Lines run across the whole surface, not per item: every label on one line, every value
  on one baseline, and every related row (a caution line, a wrapped second row) snapped to the same
  column edges as the row it belongs to.
- **Consistent.** The same kind of thing gets the same treatment everywhere on the surface: one value
  size, one label style, a qualifier (unit, datum, reference) in the same slot, and one divider rule.
- **Stable.** A row never changes shape to report a problem. A problem that belongs to one item shows
  inside that item; anything else goes on a separate line that appears only while something is wrong.
  Spare slots stay reserved, so an optional item appears without shifting its neighbors.
- **Whole items give way.** When space runs out, a whole item moves (into More, or onto a wrapped row
  of whole cells on the same columns), never a squeezed, clipped, or misaligned one.
- **Proved with guides.** Alignment is checked against drawn guides or measured boxes in a real
  browser, not by eye: a mockup draws its grid and shared lines, and a browser check measures that
  nothing overflows its column.

The status bar (section 5, Data cells) is the reference implementation.

## 2. Design tokens are the only vocabulary

All geometry, type, color, depth, and timing come from CSS custom properties defined in
`src/styles/tokens.css`. Never hardcode a literal where a token exists. The sanctioned off-scale
exceptions are the hairline spacing tier (0.05 to 0.2 rem) and the specific fine values 0.3, 0.35, 0.4,
0.45, 0.55, and 0.6 rem; anything else is a token unless a documented component dimension applies.
Shared compact controls may use the physical 44px target floor without reducing text size. A `@media`
or `@container` condition must carry a literal length: a custom property cannot be read inside a query
condition, and one used there drops the whole block.

### Geometry and type (theme-independent)

- Radii: three, by role. `--radius-md` 0.5rem (8 px) for panel controls and cards (buttons,
  inputs, segmented ends, saved cards, popovers, menu tiles), `--radius-lg` 0.75rem for dialogs and
  menu surfaces, and `--radius-pill` 999px for chrome and toggles. There is no smaller panel tier;
  a fourth radius is what made panels read as older than the chrome around them.
- Spacing (4px-based): `--space-1` 0.25rem, `--space-2` 0.5rem, `--space-3` 0.75rem, `--space-4` 1rem,
  `--space-5` 1.5rem, `--space-6` 2rem.
- Type scale: `--text-xs` 0.75, `--text-sm` 0.8, `--text-base` 0.85, `--text-md` 0.9, `--text-lg` 1,
  `--text-xl` 1.15, `--text-readout` 1.25, `--text-readout-lg` 1.75 (rem). Night-red floors the two
  smallest at 0.8 and 0.85: dim red on black needs larger glyphs. Fonts: `--font-ui` (Inter)
  for chrome, `--font-mono` (JetBrains Mono) for numeric readouts. Every size pairs with a role in the
  type-role table below; a new size or a new token-role pairing is a design-system change, never a
  per-component decision. Text-entry controls use the adaptive aliases `--text-input` and
  `--text-input-large`; both resolve to at least 1rem on phone-width or coarse-pointer displays to
  prevent focus zoom on iOS.
- Line spacing: running text (paragraphs, `.muted-note`, `.alert-note`) uses `--leading-prose` 1.4
  and `text-wrap: pretty`; panel, dialog, and empty-state titles use `text-wrap: balance`. Controls,
  readouts, and single-line labels keep the font's own spacing.
- Targets: `--control-size` defaults to 2.75rem for action tap targets (buttons, pills, icon buttons);
  `--row-size` is the list-row height (menu items, layer toggles) and is defined as
  `var(--control-size)` at the root, where both default to 2.75rem. WCAG 2.5.5 sets 44px as the
  touch-target minimum, and pinning them together keeps a list row from drifting below it. A row reads denser through
  tighter padding and smaller type, never through a smaller target.
- Short screens, at 600px high or less, use `:root` geometry overrides in `tokens.css`: `--control-size` is
  44px, `--space-1` and `--space-2` are 4px, and `--space-3` and `--space-4` are 8px. Text sizes
  remain unchanged, including enlarged text. The shared root gives the app shell and native dialogs
  the same density, and dependent tokens such as `--row-size` and `--system-bar-fallback` resolve
  from those values. Use these tokens rather than shrinking type or adding a separate compact
  target size inside a feature.
- Script asks layout questions through the named queries in `$shared/lib`: `NARROW_QUERY`
  (600px, where panels become bottom sheets), `COMPACT_QUERY` (900px, where the status strip stacks,
  the app menu becomes a bottom sheet, and the instrument dock goes full screen), and
  `LANDSCAPE_SHORT_QUERY`. CSS cannot import them, so stylesheets repeat the literals; the design
  contract fails on a breakpoint literal in script and on any other spelling of the landscape one.
  `createMediaQuery` shares one list and one change listener per query across every caller.
- A phone held sideways is the one height-keyed layout: `LANDSCAPE_SHORT_QUERY`,
  `(orientation: landscape) and (max-height: 500px) and (max-width: 1000px)`. Under it the status
  strip keeps one row while three readout columns fit beside the pinned tiles (a 34rem container
  query, in rem, so at very large text the tiles drop back onto their own row and the readouts keep
  the full width): the readouts take the leading space on their own equal-column grid (wrapping whole
  cells onto a second line of the same columns rather than running under the tiles), the pinned tiles
  sit icon-only at the trailing edge with their accessible names and 44px targets, and the position
  and time cells hide, including the last-fix coordinates and age, as they already do under 900px;
  the No GPS fix notice stays on the caution line above. Tile capacity there is the responsive
  maximum, because the bar is sized to its own tiles, and a blocked tile's note anchors to the bar's
  end with the shared `.transient-note--end` modifier. The width bound keeps a wide, short window or
  bar-type helm display on the desktop strip, with position, time, and labeled tiles.
- System chrome: `--system-bar-clearance` follows the browser's bottom safe area. An installed PWA
  with a coarse primary pointer keeps at least `--system-bar-fallback` below the status-strip content
  because some Android and Samsung shells report zero while the system bar still overlays the app.
  Bottom controls add the clearance in normal layout flow so the chart shrinks above them. They do
  not use device detection, fixed positioning, or a second viewport-height calculation. Bottom and
  landscape-edge chrome must also include the appropriate `safe-area-inset-*` value. A landscape
  phone is wider than the 600 px phone breakpoint, so it lays out with the wide rules: the top bar,
  the docked `.panel-slot`, and the instrument dock reserve the inline insets there too, not only in
  the phone branch.
- `--tracking-caps` 0.06em for uppercase labels, `--disabled-opacity` 0.45, `--transition-fast`
  `120ms var(--ease-out)` for every hover and press, where `--ease-out` is
  `cubic-bezier(0.33, 1, 0.68, 1)`, the CSS form of Svelte's `cubicOut` that every surface
  transition uses, and `--active-bar-width` 3px for the lit-row inline-start bar.
- Component dimensions no scale covers live in `tokens.css` when the value is shared across
  components, so a size used in more than one place stays visible in one token rather than repeated
  as a literal at each site. A dimension only one component ever uses, such as a dialog's own
  inline-size, can stay a scoped literal with a why comment beside it instead: `tokens.css` is for
  what is shared, not every non-scale size in the UI. Shared so far: `--data-cell-min` 6.9rem (the
  narrowest status-bar column, shared by the strip's grid and the pinned tiles), `--data-label-line`
  0.875rem and `--data-value-line` 1.5rem (the bar's two shared line heights), `--panel-width` 22rem (the docked slide-over), `--panel-state-min-height`
  8rem (a panel's loading and error block), `--strip-max-width` 28rem (the centered bottom strips),
  `--tile-min-height` 4rem (the instrument tile floor), `--btn-compact-min-width` 3rem
  (`.btn-compact`), `--scrubber-track-min-width` 4rem (the scrubber track once its narrow-container
  grid takes over), `--checkbox-size` 1.25rem (the drawn checkbox box), `--switch-width` 2.75rem and `--switch-height`
  1.6rem (the switch track), `--stat-unit-min-width`
  1.25rem (the stat-grid unit column), and `--weather-panel-height` (the Forecast panel, composed by
  both the panel and the bottom stack that clears it).
- Viewport height goes through `--dvh`, one percent of the viewport height: `1dvh` where the browser
  supports it, `1vh` everywhere else, resolved once in `tokens.css` behind an `@supports` query. Any
  size measured against the viewport multiplies it, `block-size: calc(100 * var(--dvh))` or
  `max-block-size: min(calc(60 * var(--dvh)), 24rem)`. Never write a `vh`-then-`dvh` declaration pair
  at the site; that idiom carried a duplicate-property lint suppression and a repeated comment at
  every copy.
- Plotter publishes the measured chart area as `--chart-height`. At phone widths, slide-overs cap
  their height at the smaller of 60% of the viewport height and that chart height, keeping their
  frame within the chart area below the global header and MOB action. This is an outer bound, not
  proof that the panel's body or actions fit. Check actual controls after the header and footer
  take their space.
- Layout-dependent panel-slot height uses `observeClientHeight`, which coalesces measurements into
  an animation frame so layout reads occur outside ResizeObserver delivery and reports only changed
  heights. Its teardown cancels queued measurements and disconnects the observer. The measured slot
  also reserves room above a minimized Routes header so its Close control remains reachable while
  the route-edit strip is present.
- Z-order is a token ladder, never a raw number: `--z-overlay` 1, `--z-panel` 2, `--z-safety-strips`
  (panel + 2), and `--z-menu` 5. The MOB confirm is a native top-layer `<dialog>`, above everything without a z-index.

### Type roles

Pick the token by role, never by eye:

| Token | rem | Roles |
| --- | --- | --- |
| `--text-xs` | 0.75 | caps labels (`.caps-label`, `.data-cell-label`), units (`.tile .unit`, `.stat-grid .unit`, the status bar's units and datums), the bar's tile labels, badges, panel footers |
| `--text-sm` | 0.8 | button labels (`.btn`), per-field labels, `.muted-note`, `.alert-note`, menu tile labels, panel subtitles, and the instrument tile's loud abbreviation (`.abbr`, bold at body contrast) |
| `--text-base` | 0.85 | panel body baseline (`.slide-over`), strip body text |
| `--text-md` | 0.9 | card names (`.saved .name`), nested-detail titles (`.panel-title--sub`), toggle-row and picker labels, and the status bar's caution line |
| `--text-input` | adaptive | ordinary text-entry controls: `--text-sm` on precise desktop layouts and `--text-lg` on phone-width or coarse-pointer displays |
| `--text-input-large` | adaptive | stepped-up text-entry controls such as `UnitField` numerals and `.text-field.large`: `--text-md` on precise desktop layouts and `--text-lg` on phone-width or coarse-pointer displays |
| `--text-lg` | 1 | rare dialog emphasis (a dialog heading, a conditions readout), and a status bar word value (Paused, Standby, Course up), set on the numerals' baseline |
| `--text-xl` | 1.15 | panel titles (`.panel-title`) and the MOB confirm's modal heading |
| `--text-data` | 1.125 | every status bar value (`.data-cell-value .num`) at every width: one size across the whole bar, instruments, position, and time alike, so the bar reads as one instrument row |
| `--text-readout` | 1.25 | the bottom strips' metric values (their data cells, set through `--data-value-size` on `.bottom-strip`) and the position tile's two-line coordinates; the collision strip alone steps its CPA and TCPA values up to `--text-readout-lg`, since the top alert's decision numbers outrank an ordinary numeral, and every alarm-grade strip sets its title at `--text-base` weight 700 |
| `--text-readout-lg` | 1.75 | instrument tile hero values, and the collision strip's decision numbers above |

Two nearby sizes on the same surface for the same role is drift, not hierarchy: reuse the role's
token. A component that wants a size this table does not grant its role is asking for a design-system
change, and that conversation happens here, not in the component.

### Color is semantic, not literal

Use the role, never the hex. The roles: `--text`, `--text-muted`, `--accent`, `--accent-contrast`
(text on a filled accent button), `--accent-tint` and `--accent-tint-strong` (active or lit fills),
`--select` (the highlight/picked token), `--ok` (healthy dot), `--alarm` (danger), `--warning`
(caution, one step below alarm), `--border` (dividers and cards), `--border-control` (the boundary of
every interactive control: inputs, selects, checkboxes, switches, and slider rails, at least 3:1 in
day and dusk and deliberately dim at night), `--surface` (the app base), `--surface-raised` (cards,
inputs), `--surface-overlay` (floating panels). The switch reads `--switch-on-track`,
`--switch-on-border`, and `--switch-on-thumb`, which night-red sets to a tint, an accent border, and
an accent thumb so a column of lit switches never paints a block of bright red. Tints are defined per theme, never as a global
`color-mix`, so night-red never drifts toward blue or green.

Depth: `--shadow-overlay` (small floating cards), `--shadow-lg` plus `--edge-light` (the largest
surfaces: the menu popout, the weather panel, the slide-overs), `--scrim` (modal backdrop).

## 3. Themes: day, dusk, night-red

Three themes, switched by `:root[data-theme]`. Day is the `:root` default (a light theme, `color-scheme:
light`). Dusk is a calm dark theme. Night-red is the discipline: pure red on true black, alarms always
distinguishable, the brightest pixel kept low. Every app-owned night-red token carries a zero blue
channel (blue luminance is folded into green so the WCAG contrast ratios hold exactly), and green is
minimized: the only nonzero green channels are the bounded ones AA contrast requires, each documented
in `tokens.css` with its rationale and pinned by the night-red token test.

The chart follows the theme too. Every theme recolors the OpenFreeMap base map from its palette in
`src/shared/map/map-theme.ts`: day is a paper chart whose land and shallow water match the NOAA chart
overlay, dusk and night-red are dark charts, and the bright-sun variant is day's high-contrast cream
palette. The base layers take the palette the moment the style arrives, so the first frame never
shows the source style's own colors. A new base-map color goes into those palettes, and the recolor
maps each base layer to a palette key by its source layer, never a color to a layer id. The one
synthetic layer, the offline fallback, maps to the water key.

You almost never write theme-specific CSS. You write tokens, and the theme carries the value. The rules
that matter when you do touch this:

- Night-red drops `--shadow-overlay`, `--shadow-lg`, and `--edge-light` to `none` (a black shadow on
  true black is invisible; the deeper red `--border` is the only surface separation). So never rely on a
  shadow alone to separate surfaces: a border must also be present.
- Green is not a status hue at night: `--ok` collapses to a dim red told from `--alarm` and `--warning`
  by brightness, not hue. If you add a status color, it must survive this: distinguish by brightness,
  never by hue alone. A new night-red token must keep the zero-blue channel rule and justify any
  nonzero green against an AA contrast need in `tokens.css`.
- Danger and caution must stay distinguishable in every theme. `--alarm` is the brighter, `--warning`
  the dimmer; that brightness gap is the contract.
- The theme has two controls on one `ThemeController`: the toolbar button (tap to cycle, hold for
  night) and Display's Day, Dusk, and Night choice. At large text sizes a phone top bar fits only one
  chip beside MOB, so the toolbar button yields to an Update or collision mute chip. Display is the
  path that is always reachable; keep it when changing either control. Both read their names from
  `THEME_LABELS`.
- The top bar shows no brand at any width; the `h1` stays for assistive technology, and the app name
  and version live in the menu footer.

## 4. The modular CSS architecture

`src/app.css` is only an ordered `@import` manifest over `src/styles/` modules, and the import order IS
the cascade order. Do not reorder it blindly: the order keeps `.is-on` (in `icon-controls.css`) able to
light the bases that precede it, and keeps `overlays.css` and `panels.css` after the bases they extend.
The order is: maplibre, tokens, base, text, buttons, forms, cards, badges, instruments, data-cells,
icon-controls, scrubber, overlays, reorder, panels, strips, a11y, vendor. (`reorder.css` follows `overlays.css` so
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

`vendor.css` owns the MapLibre chrome contract, coupled to vendor class names (re-verify at
night-red on any MapLibre upgrade):

- Vendor glyphs never keep their baked colors: the attribution "i" and the zoom plus and minus are
  masked and recolored with `--text-muted` (the attribution through a pseudo-element because its
  compact background repeats; the zoom by masking the icon span directly, which keeps the vendor's
  disabled dimming), so every control glyph follows the theme instead of vanishing at dusk and
  night-red.
- The scale control is a classic open-bracket bar: side and bottom hairlines, block-end radius
  only, a mono `--text-xs` label with tabular numerals, no label word, and a faint surface wash so
  the text survives bright day charts without reading as a form card.
- Floating chart chrome shares one `--space-3` edge gutter, and everything in the bottom band (the
  chart badge, the bottom-right vendor controls, the bottom strip stack, and the full-screen
  dock's scroll padding) yields to `--rail-clearance`, the measured safety-rail height published
  on the chart host and mirrored onto the app shell root. It resolves to `0px` while no alerts are
  up, so consumers apply it unconditionally, and lifted chrome stays below the strips in z: a
  safety card may never be painted over, and may never half-cover the chrome underneath it either.
  At extreme text zoom, the rail caps itself to the chart viewport and scrolls with the emergency
  response actions first. A container query removes decorative card inset and tightens the action
  gutter before any action label can cross the rail edge.

## 5. Global utility classes (the shared vocabulary)

Reach for these before writing scoped CSS. Each lives in the named module.

- Base (`base.css`): `.bare-list` (list-style, margin, and padding reset for a `<ul>` or `<ol>` used
  as a layout container, not a semantic list).
- Buttons (`buttons.css`): `.btn` (the base bordered button, 44px), `.btn-primary` (filled accent),
  `.btn-danger`, `.btn-ghost`, `.btn--grow` (flex-fill), `.action-group` (a surface's cluster of
  actions, as on a banner: equal buttons sized to the widest label that stay together and wrap below
  the words as one; the action that fixes the state is `.btn-primary` and Dismiss is `.btn-ghost`,
  both at the panel-control radius), `.segmented` (a joined row of `.btn` for a
  binary or small-enum choice; the active segment carries `.is-on`; the control fills its row and
  its segments share it equally, never below the 44px target, so no consumer scopes its own segment
  widths), and `.pill-count` (the small
  count chip shared by the toolbar's collapsed More pill and a menu item's live count, rendered
  through the menu slice's `MenuItemCount`).
- Icon controls (`icon-controls.css`): `.icon-btn` (square icon button), `.icon-btn--accent`,
  `.icon-btn--danger`, `.icon-pill` (a pill-shaped icon toggle), the `.panel-close` and
  `.panel-minimize` panel header controls, and the shared `.is-on` lit state (accent color, accent
  border, accent-tint fill) that lights any composing control.
- Forms (`forms.css`): `.control-error` (a control's own validation message, the alarm-voiced
  counterpart to `.muted-note--xs`, sitting directly under the field it refuses), `.input` (text
  inputs and selects, 44px, raised fill, `--border-control` boundary; `select.input` draws its own
  token chevron) with `.input--large` (one step up, applied to every text-entry field of a form that
  steps up any, so one surface never mixes two input sizes), `.field-label` (one field's label,
  sentence case at `--text-sm`, muted; caps labels are for section headings), the drawn checkbox and radio (no browser control, so night-red never shows a gray
  box), the switch (`input[type="checkbox"][role="switch"]`), the Windows high-contrast fallback to
  the native control, `.range` (the live
  slider, paired with a `.num` readout), `.panel-controls` (a row of action buttons as equal
  cells that share the row and wrap as whole buttons; a lone action fills its row, like a lone `.btn`
  in a section column, and no panel keeps a compact natural-width action of its own),
  and `.search-input` (the full-width search field with its 44px clear affordance, applied through
  the `SearchInput` primitive in the AIS, Find places, and Waypoints panels).
- Text (`text.css`): `.caps-label` (the uppercase, tracked, muted SECTION heading), `.muted-note` (a
  quiet hint for empty states and inline guidance) plus its `--xs` modifier (the same voice one step
  down, for a note sitting under a control rather than beside body text: an input's format hint, a
  privacy line, a radar control's description), `.alert-note` (an outline alarm banner) and its
  `.alert-note--filled` tinted variant, `.icon-note` (a note led by a status icon, with the text
  wrapping under itself rather than under the icon; composed over the note's own look and severity
  color by the weather warning banners and the degraded-monitor notes), `.action-note` plus its
  `--wrap` modifier (a note that carries its own action inline, so the label and its control share
  one row: a `.btn` is a block-level flex box, so a control set beside inline text otherwise stacks a
  full 44px target under its own label, which costs a strip an entire row off the chart and stretches
  a banner's buttons to the banner's width; apply it per element and never to a family of elements
  whose words are separate text runs, which would get the gap between their own words, and note
  that a control living inside flowing prose uses AuthBanner's scoped `inline-flex` with
  `vertical-align: middle` instead), `.sev-danger` and
  `.sev-warning` (severity text coloring),
  `.panel-title` and `.panel-title--sub` (the panel header title and subtitle), `.num` (mono tabular
  numerals for any aligned readout), `.stale-cue` (on a readout or tile holding a value that is no
  longer live: a dashed underline on its `.num` numerals, so staleness reads by shape and not only by
  the muted or warning color, which night-red cannot separate by brightness), and `.truncate`
  (single-line ellipsis truncation; the span still owns its width bound, a `max-inline-size` or a flex
  `min-inline-size: 0`, or the clip never engages). The status bar's readouts are data cells, below.
- Data cells (`data-cells.css`): the readout vocabulary of the status bar and the bottom strips,
  composed by the status strip, the autopilot cell, and every strip's metrics row. A host sets the
  value size for its role through `--data-value-size` (and `--data-value-line` for a larger size):
  the status bar uses `--text-data`, the strips `--text-readout`, and the collision strip's CPA and
  TCPA `--text-readout-lg`. A `.data-cell` is one bar column, the control size tall, holding two fixed
  lines at the shared `--data-label-line` and `--data-value-line` heights: a `.data-cell-label`
  (bare caps words, no colon: SOG, COG, HDG, Depth, Vessel, Time, Chart · COG, AP · Auto) over a
  `.data-cell-value` (the value in `.num` at `--text-data`, then the unit, datum, or hemisphere as
  plain text at the label size; a word value in `.word` at `--text-lg`). Time uses local time, and a
  qualifier that is part of reading the value itself, such as AM or PM, stays inside its `.num`. A
  zero-width numeral strut leads every value line (`.data-baseline` gives a tile label the same
  line), so words and numbers share one baseline across the bar. `.data-cell--warning` and
  `.data-cell--alarm` recolor the whole cell and pair with a warning icon in the label, so a grade
  never rests on color alone; `.data-cell--wide` spans two columns (the vessel position, set close as
  42.6154°N so it fits). The value and its unit never shrink; a trailing `.data-cell-qualifier` (a
  datum, an unassessed count) is the one part that may, and it and an overlong label end in an
  ellipsis, never a silent cut. Neighboring cells are divided by a hairline, which the host clears
  beside an empty column. The status strip lays the cells on one grid of equal columns, in four
  layouts:
  - Stacked by default: a wrapping grid of equal columns at least `--data-cell-min` wide (5.75rem at
    900 px and below, where the position leaves and no two-column cell remains), the pinned tiles on
    their own row beneath.
  - The helm row once the strip holds fourteen columns (`@container status-strip (min-width:
    98.6rem)`, derived from `--data-cell-min` and the gutters and pinned by the design contract): five
    instrument columns, four tile columns at the true center (fewer tiles start at the first tile
    column, so every edge stays on the grid), two spare columns, two for the position, and one for
    the time. The optional cells own fixed columns so one appearing never moves another: chart
    orientation the first spare, the anchor watch the second, and the autopilot the second unless the
    anchor holds it, when it takes the time column and Time steps aside. `reading-flow: grid-rows`
    keeps focus order in the visual order.
  - The sideways phone row (section 2).
  - Very large text on a narrow phone, where not even two columns fit (`max-width: 13rem`, in rem so
    it never applies at the default size): the cells set their label beside the value at the
    physical 44 px floor and wrap as whole items, so the strip never stacks one readout per row and
    pushes a safety strip off the screen.

  A problem that belongs to one readout shows inside its cell (dashed SOG and COG in the caution
  voice, Depth Paused, Chart north up); every other problem goes on the caution line above, which
  appears only while something is wrong and snaps each notice to whole columns of the same grid
  through the `spanColumns` action. A phone carries no AIS cell, so degraded AIS assessment there is a
  caution-line notice rather than an inserted cell. The alarm-sound notice offers an action only where
  a tap can help: Enable while the browser blocks audio, Try again after the device failed, and no
  action at all where Web Audio is unsupported. Every tappable cell and notice is a full 44px target.
- Cards (`cards.css`): `.card-frame` (the raised bordered card surface, border + radius-md +
  surface-raised), `.saved` plus its card list (used through the SavedList primitive), `.empty-state`
  (the dashed empty-list block, used through the EmptyState primitive), `.stat-grid`
  (the label/value stat readout: every row emits its label and exactly two value cells, the value
  and its unit, so a missing cell never shifts the rows below; a text value takes `.stat-text` for
  the value column's alignment and weight without the mono face), the `.nav-*` family (`.nav-sort`, `.nav-list`, `.nav-row`,
  `.nav-name`, `.nav-metrics`, `.nav-metric`) for the AIS, POI, and Waypoints two-line sortable lists.
  The AIS list sets each row's readouts in fixed slots (Distance, Bearing, Speed, then CPA, TCPA, and
  HDG, with a dash where a target has no value) and its risk badge on the trailing edge, so the
  collision numbers stack in columns down the list.
  POI search and Waypoints also share the `$shared/nav` list core behind that presentation
  (`filterNavRows`, `sortNavRows`, `navMetrics`, and friends), so the two can never search, sort, or
  measure differently; AIS targets keeps its own sort in `ais-rows.ts` and shares only the CSS. A
  selected
  row uses `aria-current="true"`, an accent border, an accent tint, and a leading inset accent line;
  hover or keyboard preview alone must not claim selection.
- Badges (`badges.css`): `.badge`, the one status pill for any small label that states a condition
  (Active, Stale, Warning, Alarm, an alarm grade, a layer region, a place hazard flag), with
  `--accent`, `--warning`, `--alarm`, `--select`, and `--strong` color modifiers and `--caps` for
  uppercase. Colors come only from tokens, so every variant stays in the night-red band. Never draw
  a status pill in a component's scoped style.
- Instruments (`instruments.css`): the `.tile` vocabulary on the `.card-frame` surface, shared by
  NumericTile and WindTile: the `--text-readout-lg` hero `.num`, the `--text-xs` `.unit`, and the
  loud leading `.abbr` (the abbreviation is the tile's scanned name: SOG, HDG, AWS at `--text-sm`
  weight 700, with the long name as the quiet gloss beside it),
  the zone tints (`.tile--warning`, `.tile--alarm`, `.tile--stale`), `.tile--wide`, and `.tile--empty`.
  Tiles in one grid stay equal height in every state, and a state badge's line is held while the
  tile is calm, so Stale, Warning, or Alarm appearing never moves the numeral: the `.value` slot reserves the hero line box
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
  and action. Warning, Alarm, and Stale render as tinted badges (`.badge--warning`,
  `.badge--alarm`), never color alone and never a third muted caps line; the chip colors
  itself by what it says, Alarm outranks Stale, and Stale outranks Warning, since a zone verdict
  computed from an untrusted value is not a live warning. A stale tile keeps its retained value at
  muted contrast WITH its age in the secondary line: the tile has a badge channel, so a retained
  number plus its age is more honest than dashes, while the status strip, which has no badge
  channel, dashes the same value; that divergence is deliberate and the Help panel's "When
  something looks wrong" section explains it in prose, since no tooltip reaches a gloved hand.
  While the Signal K link itself is down or silent, the strip subordinates its downstream
  consequence readouts (fix, speed, course, heading, depth) to a dimmed treatment so one failure with
  one action does not read as five, without ever hiding or recoloring them. Radar health is
  excluded from that rule: it rides the radar provider's own stream, not the Signal K link. The wind tile's angle freshness
  folds into the same chip line (Angle stale, Angle unavailable) rather than stacking a second
  fragment.
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
- Data trends uses the same instrument catalog through neutral trend descriptors. Only readings with
  explicit aggregate, fallback, display, and precision semantics are eligible. A profile owns zero to
  eight trend IDs independently of the instrument dock. Customize keeps the saved order, groups
  options by instrument category, leaves unavailable saved IDs removable, and uses the shared
  `createReorder` pointer and keyboard behavior with `ReorderActions` for individual taps. At eight
  selections, every unselected option stays visible and disabled with the instruction to remove a
  trend first.
  Opening Data trends triggers live and historical discovery even when the instrument dock has never
  opened. Rescan retains previously accepted live and historical-only options while reporting
  provider degradation. Only the eight saved descriptors and one optional focused descriptor keep
  stream demand and recorder buffers.
  Each chart selects one candidate path for its whole history series and one provider for that chart.
  An empty history column falls back to the bounded session recorder instead of hiding useful live
  data. The recorder samples selected instruments, plus one focused instrument, every 30 seconds,
  retains at most 2,880 samples per series, and never persists those samples. A focused chart opened
  from instrument detail does not change the profile selection. Back reconstructs that detail, while
  Close returns to the chart.
  Trend charts must not require hover. Each includes a 44 px timeline range control with touch,
  Arrow keys, Home, End, visible time and value, and `aria-valuetext`, plus a textual latest, minimum,
  maximum, start, and end summary. Labels, source paths, and readouts wrap at 320 px. Canvas colors
  resolve from tokens and redraw on theme changes, with no blue or bright stray pixels in night-red.
  The phone sheet traps keyboard focus while it is open.
- Overlays (`overlays.css`): `.popover-card` (the small anchored floating-card frame), `.menu-surface`
  (the anchored toolbar-menu surface layered on `.popover-card`: column layout, `--z-menu`, the
  `--menu-width` clamp, and the grow origin, shared by the overflow menu, the bottom-bar More menu,
  and the profile switcher; a consumer declares only its width and, when it opens upward or
  right-aligned, its origin corner), `.surface-elevated`
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
  shared by App.svelte and PlotterView.svelte), and `.panel-loading` and `.panel-load-error` (what a
  lazily-loaded panel shows in place of its module, the error block in the alarm color). Those two
  carry layout only, so the surface comes from where the placeholder sits: inside an open panel's
  body it needs nothing, standing in a bare `.panel-slot` it composes `.slide-over` and the dock
  modifier of the panel it replaces so it holds the same frame, and the `--cover` modifier fills the
  chart area for a panel that owns the whole viewport. Docked lazy panels use `LazyPanelState`, which
  retains their title, Back, Close, Escape, and Retry behavior while the module loads or fails.
  `createRetryableLazyUiLoader` times out retryable user-interface imports instead of caching an
  unresolved request for the rest of the session. One-shot feature registration without a recovery
  action uses the unbounded `createRetryableLazyLoader`, so a slow import can still complete.
- Overlays, modals: `.modal-card` supplies the frame. Native point editors also compose
  `.editor-dialog`, `.dialog-header`, `.dialog-body`, `.dialog-footer`, and `.dialog-field`. The shared
  editor frame replaces the browser's font-relative dialog size cap with a viewport bound; the
  editor's body scrolls while its header and wrapping action footer remain in the flex layout. The
  header, body, and footer share one `--space-3` inset, and the footer's actions are equal cells that
  wrap as whole buttons, all at the panel-control radius (no pill in a dialog). Fields and buttons may
  shrink and wrap inside the body instead of widening it at enlarged text.
- Strips (`strips.css`): `.bottom-strip` (the pinned bottom action row, composed by ten strips:
  Nav guidance, Measure, MOB, Anchor watch, the collision Danger strip, Shallow water, Alarm, Route
  edit, History playback, and the top-level plotter shell), with `.bottom-strip--accent` and `.bottom-strip--wide`
  (a strip whose controls need the room, Measure's leg table among them) as modifiers. Strip
  actions are the shared button system: `.btn .btn-pill .btn-strip` (the strip's larger text and
  accent color, pushed to the trailing edge), with `.btn-warning` for a consequence-bearing tap (the
  anchor Raise, the MOB and route-edit Cancels), `.btn-danger` for a destructive one, and
  `.btn-alarm` (alarm-colored and bold) for the strip's one obvious next action (Steer to MOB). An
  acknowledged strip (`.is-ack`) keeps its color and full contrast and steps down to a dashed
  border and the plain surface; never dim a live condition with opacity. Alarm and caution strips
  (`.bottom-strip--alarm`, `.bottom-strip--warning`) outweigh the informational ones: a 2 px border,
  a 10 percent wash of the grade color over the strip surface (`--strip-fill`), and the
  `--text-base` weight-700 title. Night-red keeps the plain overlay surface, because night body
  text falls under AA on any red wash. A strip's readouts are `.metrics`: data cells on equal
  columns, the first label on the title's edge, so a wrapped second line keeps the same columns and
  a cell that does not apply right now names its state in place (the shallow strip's Limit reads
  Server zone, a passed contact's TCPA reads Passed) rather than leaving the row. The collision
  strip sets each contact on the same three columns, so CPA and TCPA stack down the list, and the
  nav strip's XTE is a double cell that holds its deviation track and steer cue whether or not the
  boat is off track. `.actions` clusters a tool strip's trailing buttons. An alarm
  strip's safety actions are an `.action-group` instead: equal buttons sized to the widest label,
  one slot for each action the alarm offers, which holds its place once used. A done action leaves
  its word in its own slot (Acknowledged, Silenced, Muted here), a slot whose action stops applying
  mid-alarm stays as an empty `.slot-empty`, and acknowledging never removes the strip's other
  actions (Raise anchor, Mute, Cancel stay where they were), so nothing slides under the thumb. An armed confirm reserves
  its other label's width with `.label-reserve` and `data-reserve`, so arming changes only the
  words. On a phone the group takes its own full-width row of equal cells. `.actions--safety`
  widens the gutter between paired safety buttons so a wrong tap in a seaway is less likely.

## 6. Shared UI primitives (`$shared/ui`)

Shared behavior lives here. Compose these; do not re-implement them.

- `SlideOver`: the docked panel shell. Props: `title`, `subtitle`, `ariaLabel`, `dock` (left default),
  `bodyFlex` (lay the body out as a 0.6rem gapped column; pass it on any panel whose body is a stack of
  controls), `closeLabel`, `onClose`, `onBack` (when set, a leading back arrow returns to the menu via
  the App's `backToMenu`; omit on panels opened from the chart), `focusTrap`, `headerExtra`, `footer`,
  and `minimize` (a phone collapse-to-header control). Use `minimize` when a phone workflow needs a
  chart gesture: collapse before enabling the gesture, then restore the panel when it finishes or is
  canceled. The body is hidden while collapsed, but the pinned `footer` remains visible. Put the
  active step and Stop action in that footer when a multi-step chart gesture must remain understandable
  and cancelable on a phone. The independently scrolling panel body is keyboard-focusable so Safari
  users can scroll it even when its current content contains no control. `focusTrap` changes dialog
  semantics and focus behavior on the existing
  shell. A breakpoint change must not replace the stable panel container or remount its child snippet because scroll,
  focus, and child-local state belong to that stable panel instance. Offline area drawing and
  radar-area placement are the canonical minimize examples. Every left-docked panel is a SlideOver.
- `PanelHeader`: the header triad, a back arrow, the title and subtitle heading with an optional
  interleaved `headerExtra`, a minimize control, and the close button. SlideOver renders its header
  through it, and the floating weather map panel and the instruments dock reuse it (the dock passes
  its compact "Customize" entry through `headerExtra`, with "Customize instruments" retained as the
  accessible name), so the headers cannot drift apart. Do not hand-roll a panel header. At narrow
  widths or enlarged text, titles and secondary actions reflow into separate rows. Keep Back and
  Close reachable and reserve usable body space; clipping a tall header is not a reflow strategy.
  The heading keeps a usable minimum text width, and the shared narrow-container rule holds icon
  controls at 44px while text continues to scale. Do not let growing controls squeeze the title into
  a single-letter column.
  Verify that a real body control can be reached and operated, including after scrolling. An
  on-screen panel rectangle or a positive body height alone does not establish that the task works.
- `ErrorBoundary`: the render boundary around every resolved lazy component. Its fallback receives
  the error and a one-use reset function. Render the same contextual Back, Close, Exit, or Done
  controls as the import-failure state, plus Retry. Update any local state that caused the failure
  before calling reset. Use it for nested lazy charts and dialogs as well as docked panels so a
  successful import cannot leave the surrounding workflow trapped after a render or effect failure.
- `AnchoredMenu`: the popover primitive (a backdrop plus a positioned surface with the shared surface
  transition and the dismiss-stack registration). Its `motion` prop is `grow` by default (the
  dropdown grows from its anchor corner) or `below` for a full-width bottom sheet, which the app menu
  passes at 900px and under. Use it for any anchored menu (the app-menu launcher, the
  bottom-bar More menu, the opacity popover). Pass it a `surfaceClass` to position and frame the
  surface, a `role` (`group` by default, `menu` for a true menu with roving focus), and a `surfaceStyle`
  for a bespoke coordinate system. Pass `anchor`, `preferredPlacement`, and `anchorAlign` for shared
  viewport-fixed placement that flips and clamps at every screen edge. Placement and ResizeObserver
  notifications coalesce into an animation frame. `onPositioned` runs once after the visible surface
  has a measured, nonempty layout box, not merely after its style attribute changes. Use that callback
  for initial focus; do not add a separate focus timer. Teardown and stale, disconnected, or inert
  surfaces cancel it. Menus with their own point-based placement must bound and scroll their content
  within the viewport too. Pass `onFocusLeft` with the close function for the shared close-on-focus-out
  contract: the primitive applies it against its own surface while open and ignores a transient focus
  loss to the body, so an in-place content swap
  (the chart menu's confirm step) never self-closes. Do not re-derive that check from a `surfaceRef`
  binding in a consumer. Focus-out waits for the DOM update before checking the current active
  element, so replacement forms retain focus and outgoing surfaces cannot read an inert owner.
- `OverflowActions`: a labeled More button and keyboard-focused anchored menu for secondary saved-card
  actions. It uses viewport-fixed, collision-aware positioning so the menu stays on-screen at every
  card position and while its panel scrolls. Keep one primary action visible, then move dense secondary
  actions here instead of wrapping five or six icon-only controls across a phone card.
- `CustomizeToggle`: the edit-mode entry control (see "Edit modes" below). Props: `object` (the
  label's object noun), `editing`, and `onToggle`. Render it, never a hand-written ghost button.
- `ReorderActions`: the labeled reorder menu with Move up and Move down. Pass `label`, `canMoveUp`,
  `canMoveDown`, and `onMove`. Pair it with `createReorder` so single taps, Arrow keys, and dragging
  share the same constraints, persisted order, focus destination, and live announcement.
- `InlineConfirm` and `ConfirmArm`: the armed two-step confirm for destructive actions and immediate
  navigation handoffs. Never a blocking `window.confirm`. The prompt names the effect and, for derived
  guidance, the data scope. Retrace track names the latest continuous segment.
- Edit modes: a surface with a customize mode gets exactly one entry control, the `CustomizeToggle`
  primitive (a `.btn btn-ghost` text button at intrinsic width trailing in its header row), with the
  accessible name "Customize <object>" (as in "Customize toolbar" and "Customize instruments"). A
  constrained header that already names the object may display the compact text "Customize" while
  retaining that full accessible name. The label swapping to "Done" is the entire state story: never
  aria-pressed or is-on. The mode opens with one leading `.muted-note` line stating what a tap now
  does. The instrument dock, Data trends, and the menu's toolbar editor are the shipped examples; all
  render the primitive, never a hand-written copy.
- `ArmedRow`: a keyed one-at-a-time delete confirm for a list of rows (the routes, tracks, waypoints,
  profiles, and Chart Locker saved-area panels): arming one row disarms the rest. Use it instead of a
  per-panel `confirmingDelete` id. `ConfirmArm` stays the single timed strip.
- `UnitField`: the labeled number-input-with-unit row for stored SI thresholds (commit on blur, snaps
  back to the effective value). Use it for a single number field with a unit; do not use it for a live
  drag (that is a `.range` slider). Pass `ariaDescribedBy` when a safety or validation note describes
  the field. Invalid entries leave the effective value unchanged and expose a visible, associated
  explanation through `aria-invalid` and `aria-describedby`. Reverting a value silently is not
  validation feedback. The default step is `any`; set a numeric step only when that display-unit
  increment is part of the setting's contract. Convert bounds and values at the display edge rather
  than accidentally applying a meter increment to a feet entry.
- `PositionFields`: bounded decimal-degree latitude and longitude fields for a chart-point workflow.
  Pass `position`, `onChange`, and optional `disabled`. Latitude is bounded to -90 through 90 and
  longitude to -180 through 180, with signed directions explained in the accessible names. The
  caller owns the draft and the explicit operation that applies it. Use them alongside a chart-center
  action when a point can also be placed with a pointer. Route and measurement point lists keep the
  same order and limits for both input paths.
- `SavedList`: the saved-item card list (used by routes, tracks, waypoints, profiles). Renders the
  `.saved` list and card frame, optional caps label, and the `empty` state; the panel supplies each
  card's content and actions. Omit `heading` when the panel owns a semantic `<h3>` for that list, and
  pass `ariaLabel` when the list has no internal label. A server-backed list must distinguish loading,
  refresh with retained cards, real empty, and failure outside the
  primitive. Disable conflicting mutations while one is pending.
- `NavSortControl`: the generic segmented sort control over `$shared/nav`'s `NavSortState`. Pass the
  sort keys and labels, the current `state`, and `onChoose`; it renders the active segment and its
  ascending or descending indicator itself. Used by the POI search and Waypoints panels, so the two
  cannot drift on how a sortable list presents its sort control.

- `createPanelMinimize`: the shared reactive controller passed to `SlideOver` as `{minimize}`. Use its
  `collapse`, `expand`, and `onToggle` methods instead of creating panel-local collapse state.
- `SubViewHeader`: the back header for an in-panel sub-view drilled into inside one SlideOver (the
  Layers panel opening a chart-source detail). The parent suppresses its own panel-level back while
  it is open, so only one back control shows.
- `TextField`: the labeled text-input row (inline or stacked variant), a controlled value that
  commits on blur or Enter. It also offers a live `onInput` (validate while typing), a `focusOnOpen`,
  an `onEnter` submit, `disabled`, `maxLength`, a `large` deck-glove size, and a text-like `type`
  (`'url'` for a field that deserves the mobile URL keyboard). Use it for any labeled text field;
  never a raw `<input type="text">`.
- `SearchInput`: the filter-as-you-type search field with a 44px clear button and Escape-to-clear,
  consistent across browsers (Firefox renders no native clear control on `type="search"`). Used by
  the AIS, Find places, and Waypoints list panels; use it for any list filter field, never a raw
  `<input type="search">`.
- `WriteAccessNote`: the write-blocked notice plus its "Request read and write access" button,
  rendered inside a panel whose writes are blocked (waypoints, tracks, note detail). Pass the
  panel's own `message` with plain `requesting`, `onRequest`, and `outcome` values; it never reads
  the auth store itself. Use it instead of an inline note-plus-button block. The vocabulary is
  fixed: read and write access, approved by the boat's Signal K admin, never "token". A finished
  request's outcome (declined, unanswered, or unreachable) renders from the shared
  `UPGRADE_OUTCOME_COPY` map in `$shared/signalk`, so the panel and the app-wide banner cannot
  drift, and the requesting state names where the approval happens.
- `AccessRecoveryNote`: Chart Locker administrator-session recovery, distinct from the device's
  read-and-write authorization. Pass the classified access state, capability, sign-in URL, and retry
  callback. A missing or non-administrator session offers sign-in; a refused administrator session
  or connection failure offers Retry access instead of another sign-in loop.
- `SaveStatus`: the shared saving, saved, and retryable-error presentation. Pass the writer `state`,
  a contextual `errorMessage`, and `onRetry`. Use it with `createLatestWriter` when several controls
  update one server document.
- `TransientNote`: the timed explanatory note a tap on a blocked or informational control shows,
  since the title tooltip such a control also carries is mouse-hover-only. Backed by a `Toast`, it
  is absolutely positioned by the host's own class so it never contributes layout height. Shared
  by the menu's blocked tiles, the bar's blocked tiles, and the status strip's explanatory cells and
  notices; the
  strip's copy layers below `--z-safety-strips` and lifts by `--rail-clearance` so it can never
  cover a safety card.
- `NameEntry`: the inline name form that replaces `window.prompt` (Enter saves, Escape cancels, the
  seeded default starts selected). Seed it with `defaultSaveName`. While `busy`, disable edits and
  submission and consume Escape without canceling the write or dismissing the enclosing panel.
- `restoreFocusAfterCancel`: call from a name-form or confirmation cancellation with a getter for
  its trigger. The getter resolves after the DOM update, including recreated controls. It restores
  lost focus without taking it from another active surface. Call it in the same turn that clears the
  form state; pass an optional closing surface when the whole form owns focus. Resolve a surviving
  control by stable resource identity instead of retaining a detached row button. Do not call it
  after a successful action.
- `Disclosure`: the labeled collapsible section for a "Customize" or "Advanced" group. The prop is
  `expanded` (bindable), never `open` (which collides with `window.open`).
- `LayerToggle`: the toggle row, with a `description` that becomes the hover and focus tooltip. Set a
  plain-language `description` on every toggle row. It renders a switch by default; pass
  `kind="checkbox"` only for a selection a later action uses (the charts an offline area will
  download). The rule: a control that acts immediately is a switch, a selection is a checkbox.
- `VisibilityToggle`: the compact switch that shows a saved route or track on the chart. Pass
  `itemName` so each row's switch is named "Show {name} on chart"; the name never flips with state.
- `ShowOnChartToggle`: the full-width "Show X on chart" row in a panel body, rendering `LayerToggle`
  so every visibility control is one switch; Layers stays the source of truth.
- `EmptyState`: an empty list or panel: a short title, one sentence on what goes here and how to get
  one, and an optional action. `SavedList`'s `empty` prop takes a `SavedListEmpty`: `loading`,
  `unavailable` (the panel states the cause above the list), or `empty` with EmptyState props.
- `LoadNote`: a load, refresh, or failure note. Loading and refreshing are a polite status; a failure
  is an alert on the message alone, with **Retry** for a failed request (`retryName` names the
  object for assistive technology as "Retry loading {name}") or **Check again** for a capability
  probe. `LazyPanelState` renders through it.
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
  a scroll and the drag never fires. Also provide `ReorderActions` with Move up and Move down for
  single-tap operation without dragging. Those actions and Arrow keys use the same bounded order
  mutation and announcement as drag; unavailable boundary moves stay disabled. A customize list
  composes the shared line too: `.reorder-line` on each row (the toggle, an optional `.row-note`,
  then the grip and its menu, one gap and one trailing inset) and `.customize-head` for its Shown
  and Available heads, so the instrument and trend customize lists cannot drift apart.
- `surfaceTransition`: the one arrival motion for every surface over the chart, a Svelte transition
  taking a `SurfaceMotion`: `left` and `right` slide a docked panel 24px in from its edge, `below`
  raises a phone sheet or the floating weather panel 32px, each over 180ms with a fade from 0.3, and
  `grow` scales an anchored dropdown from 0.92 over 140ms with a fade from 0.5. All use `cubicOut`
  and run at zero duration under reduced motion. SlideOver picks `below` at 600px and under, where it
  is a bottom sheet. JS transition timings sit outside the CSS token contract, so they live in
  `transitions.ts`; never hand-roll a `fly` or `scale` on a surface (the design contract fails on
  one).
- Focus and dialog helpers: `rovingFocus`, `focusOnMount`, `trapFocus`, `isTabKey`, `nextRovingIndex`,
  `dialog`, and `registerDismiss` (the Escape dismiss stack that peels the topmost surface first).
- `createMenuFocusMachine` and `initializeMenuFocus`: the toolbar-menu keyboard machine shared by
  `OverflowActions` and the pinned-actions More menu. It owns arrow and Home and End roving over
  enabled rows, the Tab redirect to the
  control after the trigger (reverse Tab returns to the trigger), and the close-focus restore
  protocol. The roving index math lives once in `focus.ts`; the `rovingFocus` action the map menus
  use steps through the same copy, so arrow behavior cannot drift between menu families. Disabled
  rows are skipped by default. A menu whose blocked actions explain their reason opts into
  `includeAriaDisabled`; those rows remain reachable but must not execute their blocked command.
  An anchored consumer sets `focusFrames: 0` and calls `initializeMenuFocus` from `onPositioned`,
  leaving placement as the sole initial-focus owner.
- `pickTextFile` and `readErrorMessage` for file import; `defaultSaveName` to seed a save name, and
  `resolveSaveName(value, kind)` to fall a blank entry back to that default. The old `window.prompt`
  wrappers were removed; collect or rename a name with the `NameEntry` primitive.
- `THEMES`, `ThemeController`, `createThemeController` for the theme switch, `THEME_LABELS` for each
  theme's short display name, and `isTheme` to validate an untrusted theme value.

`IconPicker` is exported from `$entities/icon-picker`, not `$shared/ui`. It is the waypoint and note
symbol chooser. Pass `disabled` with the enclosing mutation state so a pending dialog cannot change
accepted fields in flight. Its anchored list chooses the roomier vertical direction and clamps to
the live viewport. Opening focuses the selected option after placement and scrolls only the picker
to reveal it, without moving the surrounding editor. Arrow keys, Home, End, and typeahead continue to
reveal the active option.

`$shared/audio` (`Alarm`, `GatedAlarm`) draws one module-scoped `AudioContext` for the whole app, not
one per alarm: `primeAlarmAudio` and `alarmAudioPrimed` are the gesture-priming pair, wired to both
`pointerdown` and `keydown` in `App.svelte` so a keyboard-only operator still gets audible alarms, and
`GatedAlarm.restart` re-articulates an already-sounding tone so a second alarm raised mid-burst is
heard rather than absorbed into the first one's loop.

Alarm readiness has four states: ready, blocked, failed, and unsupported. Pass the complete
`AlarmAudioState` to every setup or alarm surface and use `alarmAudioNote` for degraded explanations.
Only ready may say alarms can sound. Failed offers a retry; unsupported explains visual-only alerts
without promising that a gesture can enable audio. Help and Alarms are the sound-readiness surfaces.

`ShallowStrip` (`features/lookout`, composed by the safety rail) shows the depth, the governing limit
(or the server's depth alarm zone when that is what fires), and the depth datum, with one Acknowledge.
Acknowledging is device-local: the tone returns if the water shoals past the acknowledged depth by the
larger of 0.3 m or 10 percent (never more than half the acknowledged depth), and the acknowledgment
lapses at once when a fresh reading clears the limit by the larger of 0.2 m or 5 percent, or after the
watch has gone a minute without both monitoring and alarming. While acknowledged the strip leaves the
live region quiet; a re-sound is a new raise for the rail and the watch record. The safety rail
renders one note under whichever strip it shows: when this display raised it (generic alarms use the
server's own raise time when it is a full timestamp no later than now; MOB keeps its Elapsed timer),
and "No sound on this display." while the audio gate is not ready under an unacknowledged
alarm-grade strip.

`AlarmStrip` (`features/lookout`, composed by `PlotterView`) is one of five bottom-strips in the
safety tier, alongside `AnchorStrip`, `DangerStrip`, `MobStrip`, and `ShallowStrip`: the generic channel for any inbound alarm
or emergency grade notification outside the four dedicated hazards (MOB, anchor drag, collision
danger, and shallow water), with the same worst-first ordering, quieted-dims state, and a device-local
Mute here fallback for when the server cannot silence it.

`HistoryStrip` (`features/time-travel`, composed by `PlotterView`) is a transient review surface, not
a persisted layer setting. Its range segments, playback controls, slider, full local timestamp,
provider attribution, and four metrics all describe one accepted history snapshot. A pending or
failed request does not relabel or erase that snapshot. Automatic playback pauses for manual
interaction, range changes, refresh, Exit, a hidden document, and reduced motion, and never resumes
without another explicit Play action. Its temporary track and vessel dimming must not write to the
profile-owned layer manager.

`createPathMetaCache` (`$shared/signalk`): the shared per-session cache of `meta.zones` and related
path metadata, with a null in-flight sentinel, a bounded attempt budget, and a cooldown before a failed
read can retry. A changed token resets spent attempts, and explicit refresh invalidates settled
answers. The instruments controller and shallow monitor share accepted results rather than fetching
once per consumer. Successful reads also publish the path's declared staleness window to its cell.

### Settings persistence

Every persisted value has one product scope:

- **Profile:** portable helm preferences that should follow a named setup, such as theme, layers,
  thresholds, toolbar pins, instrument selection, and the preferred radius for the next anchor drop.
- **Device:** browser layout and chrome, such as the chart view, active profile, instrument-dock open
  state, disclosure state, and dismissed hints.
- **Server resource:** routes, tracks, waypoints, charts, and other data owned by a Signal K API.
- **Safety:** active MOB, anchor watch, navigation, alarm acknowledgement, and mute state.
- **Credential:** Signal K device authorization and administrator sessions.
- **Cache or draft:** derived data and unfinished work with its own documented lifecycle.

Register production localStorage keys in `src/shared/persistence/storage-keys.ts`. The active profile
autosaves portable settings. Do not show dirty, manual-save, or discard chrome for profile edits.
Never carry active safety state, credentials, server resources, browser layout, or caches in a
profile. See [Profiles and settings](profiles.md).

Fresh starter profiles keep Menu in the bottom toolbar and include a safety shortcut appropriate to
the operating context. Seeding an empty library must not rewrite an existing profile's deliberate
pins. Use profile changes this device; the shared default is the starting choice for a device
without an active profile, not a command to switch every display.

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
  - A structured provider value, such as a radar zone, sector, or rectangle: a separate accepted
    snapshot and draft, stacked `UnitField` controls, one whole-object Save, and an explicit Cancel. A
    provider update during editing creates a visible conflict instead of replacing the draft. Any
    optional chart placement is an explicit, cancelable mode with a complete form equivalent. Its
    gesture ownership must be exclusive. Any discard prompt stays outside a collapsible disclosure so
    navigation cannot hide it.
  - A toggle list row (a layer, a weather overlay): `.row-interactive` with `.is-on` for the lit state.
  - A saved-item list: `SavedList` over `.card-frame` cards.
  - A destructive or immediate navigation action: `InlineConfirm` (armed), never a blocking confirm.
  - A row of panel actions (Save, Cancel, New): `.panel-controls`, equal cells that wrap as whole
    buttons. Never a scoped flex row of natural-width buttons, and no `.btn--grow` inside it.
- Display values are SI in the store; convert only at the display edge. This includes provider-defined
  controls such as radar range in meters, angles in radians, and durations in seconds. Convert both the
  value and its capability bounds for the widget, then convert the committed value back to SI.
- A live-data panel reports transport, data freshness, and renderer health separately when they can fail
  independently. Never label an open connection as live until usable data arrives, and clear a stale
  safety-relevant picture instead of leaving it frozen on screen.
- A retained result remains visibly retained after a refresh error, with its source, age, and Retry
  action. Failure is not an empty collection and is not indefinite Loading. Independently available
  products, such as tide heights and tidal currents, keep independent success and failure states.
- A provider-backed settings form is not editable until an accepted policy has loaded. Initial local
  defaults are not the server's policy. Show checking or unavailable explicitly, preserve untouched
  accepted fields in a write, and retain the draft and error when a save fails.
- Carry datum, depth reference, model versus observation, sample time, and aggregate interval through
  every derived presentation and handoff. MLLW means mean lower low water, not automatically the
  displayed chart's zero. An absent or invalid datum stays unknown; never infer chart compatibility
  from a provider name. Weather model fills must not masquerade as observations, and an unassessed
  instrument value must not read Normal.
- Route coverage is a read-only assessment of the selected passage, independent of the active
  navigation route. A reusable result carries route identity, geometry, saved-area and catalog
  identities, corridor, detail, and checked-at time. Handoff facts revalidate that context even with
  Offline charts closed and retire a mismatched or unavailable assessment. Complete is sampled cache
  coverage, never a safety clearance.
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
  helm intent. A menu entry is a `MenuItem` (`id`, `label`, `shortLabel` for the bottom-bar tile,
  `sublabel` for a quiet second tile line when an item's current state is part of its identity
  (the Orientation tile's mode, the instrument dashboard's KIP acronym) so the label keeps one
  voice across the grid, `icon` a lucide component, `group` a section heading, `pressed` for a
  toggle's lit state, `disabled` plus `disabledLabel`, `available` plus `unavailableHint`,
  `barOnly` for an action whose home is the bottom bar (the Menu opener, which would otherwise be
  a tile inside the menu it opens; it still renders as a tile while customizing, since tapping a
  tile is the pin control), `onSelect`). Groups today:
  Chart, Navigate, Safety, Weather, Instruments, and Settings.
  Safety stays before Weather and Instruments; Settings stays last. Adding a menu option is one more
  `MenuItem`, never a change to the menu component. A capability whose provider is absent sets
  `available: false` with an `unavailableHint`: the launcher and bottom bar render it grayed and
  unable to execute the blocked command, with the reason available on touch and keyboard activation
  as well as hover and assistive text. Do not remove it from the menu or rely on a title alone.
  `disabled` plus `disabledLabel` describes a transient block, such as a chart still loading.
- A user-relevant optional feature never disappears merely because its provider is missing. Offline
  charts stays actionable and opens a persistent requirements panel when the provider is missing or
  unreachable. It distinguishes checking, absent, refused access, and a failed connection, with a
  local Retry and a route to Signal K administration. When available, the same entry opens one
  landing page for saved areas, automatic caching, installed charts, and storage, rather than
  exposing provider internals as separate menu tiles.
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
- Distinguish browser caching from the boat's Chart Locker cache. Browser offline support requires
  an eligible secure context. Areas already saved on the server can work without internet over the
  boat network, but still require a connection to that server.
- An anchored menu (a popover hung off a control) is `AnchoredMenu`. A modal is the rare exception
  (a native `<dialog class="modal-card">` opened via the `dialog` action, which calls `showModal()`),
  used for the waypoint editor and the MOB confirm.
- The bottom bar renders the pinned `MenuItem`s in stored order (using `shortLabel`) plus a More
  overflow, as equal tiles: an icon over a one-line label on the bar's two shared line heights, so
  each label sits on the readouts' value baseline. On the helm row each tile is exactly one bar
  column and the bar holds four (three plus More when more are pinned); elsewhere tiles share the bar
  equally, up to one column each, and go icon-only when a labeled tile would not fit. The app menu's toolbar edit mode owns membership, order, reset, and the live reorder
  announcement; the bar only renders the resolved list. Fit against the available layout column and
  the control's resolved size, including inherited compact overrides. Do not measure a content-sized
  bar that shrinks again whenever a pill moves into More.
- The Layers and charts panel opens on chart sources first. The Charts view lists server and user chart
  sources, opens chart detail from the row gear, shows bounds when known, and keeps "Add a chart" for
  user PMTiles URLs. Every query-bearing URL defaults to device-only, displays redact all query
  values, and sharing the complete URL with Signal K requires an explicit reviewed choice. User chart
  detail stages replacement metadata before save, refreshes metadata through the same review, and
  changes device or server sharing without changing the chart id or its layer state. The Overlays
  view is for overlay visibility, opacity, and stacking controls.

## 9. Interaction and accessibility

- 44 px (`--control-size`) for every action target; `--row-size` for list rows, defined as the same
  value so a row can never fall below that floor.
- The status bar has no compact carve-out any more: every readout is a full-height data cell, so an
  explain-tap cell (AIS, Depth) or notice (a weather warning, radar trouble) reveals its
  `TransientNote` explanation from a full 44 px target, and every real action (Retry, Reconnect,
  Help, Enable, the anchor and autopilot doors, the Chart cell) has the same target. The connection
  dot is the one small target left, a quiet explain-tap in its gutter.
- A cell or notice does not carry both an explain-tap and an action that already routes to the same
  explanation. The link notices sit beside the connection dot, whose tap states the connection
  diagnosis; Waiting for GPS carries Help, which opens the GPS readiness section; the Chart cell is
  itself the return to north up, and a fallback's reason is on the caution line. Adding a second
  target to those would crowd the row without telling the navigator anything new.
- Destructive actions and derived-guidance navigation handoffs arm with `InlineConfirm`. They do not
  fire on a single tap.
- Escape peels the topmost surface via the shared dismiss stack (`registerDismiss`), in last-opened
  order, not a raw window listener.
- A temporary chart-tap mode changes the chart cursor where a pointer exists, keeps a live strip with
  the next gesture, and restores the prior cursor and interaction state on exit. If it adds a nested
  manipulation mode, the first Escape cancels that mode and preserves the parent tool. Measure is the
  reference: point selection is separate from movement, the invisible chart hit area is 44 px, and
  the editor supplies keyboard-equivalent creation, selection, movement, deletion, and ordering
  wherever those operations exist.
  Route point editing includes Add at chart center, Insert after selected point, Move point earlier
  and later, and Undo point edit. Reordering keeps point identity and metadata with the moved point;
  selection and coordinate fields follow its new position. A chart edit invalidates conflicting
  coordinate-edit undo history. Route Escape requests the app's discard confirmation without letting
  the drawing library erase the draft first; a minimized panel expands before showing that prompt.
  Offline area selection also offers Use current chart view and bounded coordinate fields; dragging
  is never the only way to create the first area.
- Interactive map surfaces use the shared drag-safe tap path for mouse and one-finger touch input.
  They reject pans, long presses, and multi-touch, preserve the pointer while overlapping surfaces
  remain hovered, and route one gesture to the highest visible overlay instead of opening several
  panels.
- A visible label must be associated with its control: a `<label for>` for a single control, or
  `aria-labelledby` pointing at the label span for a control or a `role="group"` (the radar field
  pattern). Do not lean on a redundant `aria-label` when a visible label exists. When a control
  with visible text needs a longer name, the name starts with that text ("MOB: mark man overboard
  here"), so speech input can say what it sees; a longer explanation goes in `title`, which becomes
  the description.
- A primary action has a visible verb, not only an icon and tooltip. Checkbox and switch labels
  provide the full control-height touch row. Modal content scrolls within a usable viewport budget while its
  confirmation and dismissal controls stay reachable at 320 px and 200% text.
- A deep-linked Help action focuses and reveals the named section. A confirmation or replacement
  control receives focus after it is revealed; cancel and close restore a meaningful trigger without
  moving focus out of a different active surface.
- A live status uses `role="status"` and `aria-live="polite"`; the one assertive collision channel is
  owned by `App` and never duplicated.
- The lit state is `.is-on` (`--accent-tint-text` text, accent border, accent-tint fill, and accent
  icons). Hover tints to `--accent-tint` only inside
  `@media (hover: hover) and (pointer: fine)`, so touch cannot retain a false hover state. Both come
  from the shared classes; do not invent a per-component lit style (the MOB
  key's solid `--alarm` fill with `--alarm-contrast` text, the one control allowed a solid alarm
  fill because a red MOB key is the hardware convention and solid alarm appears nowhere else,
  falling back to the black surface with warning text at rest under night-red so the brightest night pixel is only
  ever a live emergency, and the instrument tile's zone tint, `.tile--warning` and `.tile--alarm`
  from the global `styles/instruments.css` vocabulary driven by Signal K meta.zones and raised
  notifications, are the two sanctioned exceptions).
- Reduced motion is honored: every surface transition (`surfaceTransition`) runs at zero duration
  under `prefers-reduced-motion`, and Playback disables automatic advance while keeping manual
  stepping and scrubbing available. The global transition reset is `0s`, not a small nonzero duration
  that can introduce a visibility transition on an element whose default transition property is all.
- Safety surfaces never animate in: the safety rail strips, the MOB button, strip, and confirmation
  dialog, and the status strip's alarm chips appear at once, because an entrance delays the moment an
  alarm can be read and acted on. The design contract fails on a transition directive or a CSS
  animation in those components. Panels such as Alarms and Anchor watch are not safety surfaces for
  this rule and keep the shared panel motion.
- Touch behaves like a native app: the document has no overscroll (no pull-to-refresh or bounce
  reload mid-passage), panel bodies and the menu sheet contain their own scroll, and controls carry
  `touch-action: manipulation` so a quick second tap is a tap, never a double-tap zoom, while pinch
  zoom stays. A class-level `touch-action` (reorder handles, slide to unlock, trend charts) outranks
  that element rule. The browser's tap highlight is off, so each control's pressed state is the only
  tap feedback; `main.ts` registers a passive document `touchstart` listener because iOS Safari
  applies `:active` only when one exists. Never draw a grab handle on a sheet that has no drag
  gesture.
- The first-run chart hint waits while a top-of-chart banner or a safety strip shows, since both
  land where the hint sits: PlotterView measures both and passes ChartCanvas `hintSuppressed`. The
  hint is not dismissed, so it returns once they clear.

## 10. Icons

- App chrome uses `@lucide/svelte` components, sized in px (`size={16}` for inline, `size={18}` for a
  prominent control), always `aria-hidden="true"` when a text label is present. `size={20}` is
  reserved for a handful of oversized hero controls (a panel's back arrow, the app menu trigger, the
  MOB confirm icon), never a default. Pick an icon that reads true: AIS targets is a ship, the radar
  is the radar sweep glyph, an anchor is an anchor.
- Chart symbols are a separate system: they derive from the S-52 Presentation Library and OpenBridge,
  not from the UI icon set. That pipeline is a later spec.

## 11. Front-end coding standards

- Svelte 5 runes only: `$state`, `$derived`, `$derived.by`, `$effect`, `$props`. No Svelte 4 stores or
  idioms. A reactive dependency injected into a controller is passed as a getter `() => value`, never by
  value, or it freezes at construction (a real stale-value bug class).
- Feature-Sliced Design: imports flow strictly downward, `app -> views -> widgets -> features ->
  entities -> shared`. Same-layer siblings are reachable only through their `index.ts` public API,
  never internal paths. Every public API uses named re-exports only, never `export *`. Cross-feature
  data flows through an `entities` store, never feature to feature. These boundaries are enforced by
  dependency-cruiser in the verification gate.
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
- Network disclosure belongs in reachable Help and device-privacy surfaces. Explain automatic
  external vessel-position requests even when related panels are closed, the actual available
  opt-outs, and the capabilities lost through network blocking. Local-data erasure is not a network
  privacy switch. Disclose manual external telemetry processing before its first request.
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
- An empty state orients, explains, and offers one next step (EmptyState). A retry button's visible
  label is the one word **Retry** (or **Check again** for a capability probe); its accessible name
  adds the object, starting with the visible word. Loading text ends with an ellipsis.
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
5. Construct the controller and services and add the `MenuItem` in `app/App.svelte`. Add the shared
   `PanelId` and pass the dependencies to `views/plotter/PlotterView.svelte`, which composes chart
   panels in its existing slot. Profiles remains app-owned. If a user-relevant provider is
   optional, keep the item visible with `available` and an actionable `unavailableHint`; do not hide
   it conditionally.
6. Run `npm run verify`, all green. Run `npm run verify:browser` when app-shell, layout, map,
   interaction, or browser behavior changes. That browser gate runs every configured Chromium and
   WebKit project, including PWA, mobile layout, and live safety scenarios. CI adds package and both
   dependency audits through `npm run verify:ci`; release preparation uses `npm run verify:release`.
   See `docs/building-menu-items.md` section 0 for the per-file loop and tooling traps.
