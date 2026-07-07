# CSS review: dead code, modularization, and inconsistencies

Scope: every CSS module in `src/styles/` and every scoped `<style>` block in every
`.svelte` component, checked for dead selectors, duplicate patterns, token compliance
violations, cross-component inconsistencies, and night-red safety.

## Changes made

### Dead code removed

1. **`.section-card` selector** (`src/styles/panels.css`): the `.panel-section.section-card`
   modifier was defined but never used in any template. Removed.
2. **`--z-modal` token** (`src/styles/tokens.css`): defined but never referenced anywhere in
   the codebase. Removed.
3. **`.skip:disabled`** (`src/features/navigation/NavStrip.svelte`): re-declared
   `opacity: var(--disabled-opacity)`, which the global `.icon-btn:disabled` already
   provides. Removed the scoped rule.
4. **`.confirm:hover` redundant lines** (`src/features/mob/MobConfirmDialog.svelte`): the
   `:hover` rule re-declared `border-color` and `background` identical to the base `.confirm`
   rule. Removed the redundant lines, keeping only `filter: brightness(1.06)`.

### Night-red safety

5. **`--shadow-side` not overridden in night-red** (`src/styles/tokens.css`): the night-red
   theme overrode `--shadow-overlay` and `--shadow-lg` to `none` but missed `--shadow-side`,
   which is used by `.slide-over` in `panels.css`. Added `--shadow-side: none;` to the
   night-red block so the side shadow also collapses at night.

### Duplicate patterns hoisted to global

6. **`.panel-slot`** duplicated in `App.svelte` and `PlotterView.svelte`: both declared the
   same `.panel-slot` rule and the same `@media (max-width: 600px)` override. Hoisted to
   `panels.css` as a global class, removed both scoped copies.
7. **`.unavailable { opacity: 0.65 }`** duplicated in `LayerRow.svelte` and
   `InstrumentsCustomize.svelte`: both independently declared the same dim treatment for
   absent-provider rows. Hoisted to `overlays.css` as a global `.unavailable` class, removed
   both scoped copies.
8. **`.bare-list`** list reset (`list-style: none; margin: 0; padding: 0;`) duplicated in 8+
   components. Added a global `.bare-list` utility to `base.css`. Applied to
   `DangerStrip.svelte` as the first adoption.

### Token compliance

9. **`0.75rem` to `var(--space-3)`** (`src/features/navigation/NavStrip.svelte`): the CDI
   track height was a hardcoded rem matching `--space-3`. Replaced with the token.
10. **`1.5rem` to `var(--space-5)`** (`src/features/routing/RouteEditPlan.svelte`): the
    grid column width was a hardcoded rem matching `--space-5`. Replaced with the token.

### `.num` class adoption (replacing duplicated font properties)

11. **`StatusStrip.svelte`**: `.readout b` re-declared `font-family: var(--font-mono)` and
    `font-variant-numeric: tabular-nums`, which the global `.num` class already provides.
    Added `class="num"` to the `<b>` elements in the template, removed the duplicated
    properties from the scoped rule (kept only `color: var(--text)`).
12. **`WeatherMap.svelte`**: `.map-note--readout b` re-declared the same two properties.
    Added `class="num"` to the `<b>` elements, removed the scoped rule entirely.

### Cross-component inconsistencies fixed

13. **`100vw` to `100dvw`** (`src/features/menu/AppMenu.svelte`): the launcher used
    `100vw` (static viewport, can cause horizontal overflow on mobile) while
    `MobConfirmDialog` and `WaypointDialog` used `100dvw` (dynamic viewport). Standardized
    on `100dvw` in both the inline-size and the phone media query.
14. **`.panel-foot` renamed to `.weather-footer`** (`src/widgets/weather-map/WeatherMap.svelte`):
    the scoped `.panel-foot` was confusingly similar to the global `.panel-footer` in
    `panels.css` but had a different layout. Renamed to avoid confusion.
15. **`.provenance` composes `.muted-note`** (`src/widgets/weather-map/WeatherMap.svelte`):
    the scoped rule re-declared `margin: 0; color: var(--text-muted);` which `.muted-note`
    already provides. Added `muted-note` to the template class, kept only
    `font-size: var(--text-xs)` in the scoped rule.
16. **`.flag-tag` and `.alert-time` compose `.muted-note`** (`src/features/lookout/AlarmsPanel.svelte`):
    both re-declared `color: var(--text-muted); font-size: var(--text-sm)` which `.muted-note`
    provides. Added `muted-note` to the template classes, kept only layout properties.
17. **`TrendCharts.svelte` uses `.panel-section`**: the scoped `section` rule duplicated the
    global `.panel-section` pattern with a different gap (`--space-1` vs `--space-2`).
    Added `class="panel-section"` to the `<section>` elements, removed the scoped rule.
18. **`.tile` transition missing `filter`** (`src/features/menu/AppMenu.svelte`): the
    `:active` state applies `filter: brightness()` but the transition did not include
    `filter`, so the brightness change was instant. Added `filter var(--transition-fast)`
    to the transition.
19. **`.skip` missing `border-color` transition** (`src/features/navigation/NavStrip.svelte`):
    the `:hover` state changes `border-color` but the `.icon-btn` transition does not include
    `border-color`. Added a scoped `transition: border-color var(--transition-fast)` to
    `.skip`.

## Findings not acted on (documented for future consideration)

- **`22rem` panel-width pattern**: appears in 5 files (`panels.css`, `AppMenu.svelte`,
  `MobConfirmDialog.svelte`, `WaypointDialog.svelte`, `InstrumentsPanel.svelte`) as the de
  facto standard panel width with no token. A `--panel-width` token would unify these.
- **Menu tile height (4.5rem) vs instrument tile height (4rem)**: two "tile" concepts with
  different minimum heights and no shared token.
- **`AppMenu.svelte` `.tile` box model overlaps `.btn`**: the tile re-declares border,
  border-radius, background, color, font, cursor, and transition from `.btn`. Composing
  `.btn` as a base would reduce duplication, but the column layout and transparent border
  make it a different visual family.
- **`IconPicker.svelte` `.picker-trigger` duplicates `.btn`/`.input` box model**: same
  consideration.
- **`UnitField.svelte` and `TextField.svelte` duplicate field-row pattern**: both declare
  `display: flex; align-items: center; gap: var(--space-2); min-block-size: var(--control-size)`
  and `.name { color: var(--text-muted); font-size: var(--text-sm) }`. A shared
  `.field-row` global class would unify them.
- **Fine-print muted text pattern** (`font-size: var(--text-xs); color: var(--text-muted)`):
  re-declared in 7+ locations. A `.muted-note--xs` variant in `text.css` would hoist it.
- **`InstrumentsPanel.svelte` uses `@media (max-width: 900px)`** while other panels use
  `600px`. The 900px breakpoint targets landscape tablets where the dock would be too
  narrow; it may be intentional but is undocumented.
