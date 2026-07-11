# Building a new menu item

This is the operational build guide for adding a menu item, the panel it opens, and the controls
inside it, so a new one is indistinguishable from the shipped ones and does not need its styles
corrected afterward.

Read `docs/design-system.md` once for the why (tokens, themes, the modular CSS architecture, the
full primitive and utility-class reference). This guide is the how: the steps in order, the
reuse-or-rebuild decisions, the pitfalls we keep correcting, and the gate. When this guide and
`design-system.md` overlap they agree; `design-system.md` is the reference, this is the checklist.

"Add a menu item" has two senses, kept separate here:

- A new top-level feature reached from the app menu: a `MenuItem` plus the `SlideOver` panel it
  opens. This is most of the guide.
- A clickable row inside a popover menu: the `.menu-item` utility class. See the row-class table in
  section 5.

---

## 0. The gate (run in this order, every change)

During edits, the fast per-file loop:

1. `npx @biomejs/biome check --write <files>` (format, lint, and organize imports, with autofix)
2. `npm run check` (svelte-check)
3. `npx @biomejs/biome ci <files>` (no-write verify, the same engine the commit hook runs)

Then commit. The pre-commit hook runs `biome ci .` and `npm run cruise` (dependency-cruiser). The
heavier gates (`npm test`, `npm run build`) run at pre-push; run them yourself before a release or a
large change.

Tooling traps, each of which has bitten us:

1. `npx biome` resolves the WRONG package (an abandoned 0.3.3). Biome is not a dependency, so it is
   npx-only and you must use the scoped name: `npx @biomejs/biome` (2.5.1). Always the scoped name.
2. Biome `lineWidth` is 100. Wrap to 100.
3. dependency-cruiser `no-cross-feature`: a feature may import another feature ONLY through that
   feature's `index.ts` public barrel, never a deep path. The same holds for shared and entities
   slices, and the layer direction is enforced: `app -> views -> widgets -> features -> entities ->
   shared`, with shared importing nothing above it. Cross-feature data flows through an `entities`
   store, never feature to feature.
4. `noGlobalAssign` fires when a local variable shadows a JS global. We have hit this with `open`
   (window.open), `name` (window.name), and other `window.*` names. The fix is to rename the local,
   never to disable the rule. The Disclosure prop is `expanded`, not `open`, for exactly this reason.
5. svelte-check warns `state_referenced_locally` for `let x = $state(prop)`. When the one-time seed
   is intentional (a freshly mounted form takes a snapshot of a default), silence it with
   `untrack(() => prop)`, as `NameEntry` does. Do not ignore the warning.
6. zsh does NOT word-split an unquoted variable, so a file list in `$FILES` reaches the command as a
   single argument. Pass file lists as explicit arguments or a shell array, never a bare `$FILES`.
7. No `prepare` or `prepack` lifecycle script in `package.json`: it corrupts the App Store
   install-simulation step. Git hooks are opt-in through the non-lifecycle `hooks` script.

---

## 1. Wire the menu item in `app/App.svelte` (all four steps, together)

The menu and bottom bar are data-driven, so these four steps are the whole integration. Doing one or
two leaves a tile that opens nothing, or a panel with no way in.

1. Add a `MenuItem` to the `menuItems` array, in the right intent group. The groups today are Map,
   Navigate, Safety, Weather, Instruments, the plugin-gated Offline charts group, and Settings.
   Safety stays before Weather and Instruments; Settings (Profiles) MUST stay last. A plugin-gated
   group is inserted before Settings with a conditional spread (`...(companionBase !== null ? [ { ... }
   satisfies MenuItem ] : [])`). Set `id`, `label`, `icon` (a lucide component), `group`, `pressed:
   activePanel === '<id>'`, and `onSelect: () => togglePanel('<id>')`. Add `shortLabel` when the label
   is long (the bottom-bar pill renders `shortLabel ?? label`). Add `disabled` plus `disabledLabel`
   for a transient block (a chart still loading), or `available: false` plus `unavailableHint` when a
   provider can be absent. Keep user-relevant optional providers visible but grayed when their absence
   explains a missing capability, such as Radar, Time travel, or Open KIP.
2. Add the panel id to the `LeftPanel` union type.
3. Add the mount block: `{#if activePanel === '<id>' && <guards>}` wrapping `<div
   class="panel-slot"><YourPanel ... onClose={closePanel} onBack={backToMenu} /></div>`. The guards
   mirror the menu gating.
4. Construct the feature's controller and services in `App.svelte` and pass them down as props.
   Services are never global singletons; they are built here so they are swappable in tests.

---

## 2. Build the panel (canonical structure, top to bottom)

A panel is a feature component that renders exactly one `<SlideOver>` and nothing else at the top
level. Inside, in this order:

1. The `SlideOver` open tag: `title`, then a specific `closeLabel` (see the copy rules: never the
   bare default), then `{onClose}` and `{onBack}`, then `bodyFlex` when the body is a stack of
   controls and readouts (the common case). Omit `bodyFlex` only for a continuous accordion list
   that owns its own spacing (LayersPanel), and say why in a comment. Optional: `subtitle`, `footer`,
   `minimize` (the phone collapse, as one `{ collapsed, onToggle }` object), `dock`, `ariaLabel`.
2. Top-of-body notes, before any section: a transient error as `<p class="alert-note"
   role="alert">{error}</p>`, and a write-gate teach note as `<p class="muted-note">A write token is
   needed to ...</p>` when `auth.writeBlocked`.
3. A one-line teach intro in plain helm voice: `<p class="muted-note">...</p>`.
4. One or more `<section aria-label="...">` blocks, each led by an `<h3 class="caps-label">` heading,
   then its control primitives and readouts. A sub-heading is `<h4 class="caps-label">`.
5. A list of saved records uses `<SavedList>` with a next-step `empty` message. A destructive action
   on a card arms an `<InlineConfirm>` first.
6. Live status carries a role: `role="progressbar"` with aria-valuemin/max/now for a determinate
   bar, `role="status"` for a soft advisory, `role="alert"` for a hard error.

Skeleton:

```svelte
<script lang="ts">
import { SlideOver, SavedList, InlineConfirm } from '$shared/ui';
// plus the control primitives this panel needs: UnitField, TextField, LayerToggle, Disclosure, ...

interface Props {
  // feature deps (auth, stores, companionBase, map, units) ...
  onClose: () => void;
  onBack?: () => void;
}
const { /* deps */ onClose, onBack }: Props = $props();

let error = $state<string | null>(null);
</script>

<SlideOver title="Feature name" closeLabel="Close feature name panel" {onClose} {onBack} bodyFlex>
  {#if error !== null}
    <p class="alert-note" role="alert">{error}</p>
  {/if}

  <p class="muted-note">One plain sentence telling the helm what this panel does.</p>

  <section class="panel-section" aria-label="Section name">
    <h3 class="caps-label">Section name</h3>
    <!-- control primitives and readouts -->
  </section>

  <section class="panel-section" aria-label="My records">
    <h3 class="caps-label">My records</h3>
    <SavedList items={[]} empty="No records yet. Tap Add to create one." key={(r) => r.id}>
      {#snippet card(record)}
        <!-- card body; arm an InlineConfirm before any destructive action -->
      {/snippet}
    </SavedList>
  </section>
</SlideOver>
```

---

## 3. Pick the panel shape

Three established shapes. Pick by what the second screen IS, not by size.

1. Single flat panel (alarms, chart files, profiles). The whole feature is one screen of stacked
   sections. Constant `title`, no sub-view state. This is the default; reach for it first.
2. Landing plus sibling sub-views (RegionsPanel). One feature with several peer destinations that
   each deserve a titled screen (home, build, storage, auto). One `subView` state in the parent, a
   `$derived` `subViewTitle` fed to `SlideOver`, the back repurposed so it returns to the landing
   first: `onBack={subView === 'home' ? onBack : () => (subView = 'home')}`. Landing rows are a
   `.subview-link row-interactive` button with a label, a current value, and a trailing chevron.
3. Detail drill-in (LayersPanel opening SourceDetail). Selecting one record from a list opens that
   record's detail or editor in the SAME SlideOver. The detail renders `<SubViewHeader title=...
   backLabel="Back to <list>" {onBack} />`, and the parent suppresses its own panel-level back while
   the detail is open (`onBack={detailOpen ? undefined : onBack}`).

There must never be two stacked back controls. Whoever owns the in-body back (the title switch in
shape 2, the SubViewHeader in shape 3) requires the panel-level back to be suppressed for that state.

Sanctioned exception: a full-screen map panel (the weather map) hosts its own header chrome instead
of a SlideOver, because it is a docked mini-map with a layers menu and a conditions sheet rather than
a scrolling body of controls. It still carries a specific back control and close control and follows
the copy, token, and accessibility rules. A new panel uses a SlideOver unless it is a full-screen
map of this kind.

Second sanctioned exception: the instrument dock is a true SPLIT, not an overlay. The shell is a
two-column grid; the dock takes the second column beside a live, narrowed chart, with a 1px
--border seam (night-red has no shadows) and an instant toggle (animating the grid track would
resize the map every frame). Under its 900px breakpoint the same panel goes full-screen at
--z-panel, below the safety strips, with its own close chrome ("Close instruments, return to
chart"). Its tile grid fills the dock: rows share the full height, dense flow backfills holes,
and an empty tile is never full width (the layout rules live in the design system's instruments
module entry). Selecting a tile opens an in-dock detail view, and Customize groups available
instruments by category with a Rescan action for dynamic Signal K instances. Do not add further split
panels without a matching product case; overlays stay the default.

Edit-mode entry (the customize rule): render the `CustomizeToggle` primitive from `$shared/ui`,
one per surface, trailing in the header row, and open the mode with one `.muted-note` line
stating what a tap now does. The visual and aria recipe lives in the design system's Edit modes
entry.

The app menu's toolbar editor also shows the current pinned bar order. Use the shared `createReorder`
controller for pointer and ArrowUp or ArrowDown movement, keep the stored `pinnedActionIds` order as
the source of truth, and include a reset action that restores `DEFAULT_PINNED`. The menu tile grid
still controls membership by tapping tiles in edit mode.

---

## 4. Reuse a primitive, never re-implement

Everything below is exported from `$shared/ui`. The standing rule is to hoist a shape into
`$shared/ui` at the SECOND copy; a third copy is a review failure.

| Need | Reach for | Never |
|---|---|---|
| Top-level slide-in panel | `SlideOver` | a bespoke `<aside>` shell |
| In-panel sub-view back header | `SubViewHeader` | a second panel-level back |
| A list of saved items | `SavedList` (with `empty` and a `card` snippet) | a hand-rolled `<ul>` of cards |
| A labeled text field | `TextField` | a raw `<input type="text">` |
| A numeric setting with a unit | `UnitField` | a raw `<input type="number">` |
| Collect or rename a name | `NameEntry` (seeded with `defaultSaveName`) | `window.prompt` |
| Confirm a destructive action in a panel | `InlineConfirm` | `window.confirm` |
| Confirm a destructive one-tap strip action | `ConfirmArm` | an unguarded one-tap delete |
| Collapse advanced or optional content | `Disclosure` (prop `expanded`) | a hand-rolled toggle, or the prop name `open` |
| A layer or chart toggle row | `LayerToggle` with `description` | a bare checkbox row |
| An in-panel "show on chart" control | `ShowOnChartToggle` with `description` | a bespoke toggle button |
| A compact per-card show or hide | `VisibilityToggle` | a re-styled icon button |
| A map-anchored menu or popover | `AnchoredMenu` | a bespoke backdrop and Escape handler |
| Explain why a control is grayed | `UnavailableHint` plus a matching `title` | a `title` alone, silent to assistive tech |
| Focus a freshly revealed control | `focusOnMount` | an ad hoc onMount focus call |
| Arrow-key roving in a small menu | `rovingFocus` | a bespoke keydown index walker |
| Import a text file | `pickTextFile` plus `readErrorMessage` | a hidden `<input type="file">` |
| A dated default save name | `defaultSaveName` | an inline date string |
| Escape-dismiss a bespoke overlay | `registerDismiss` | a private window keydown listener |

Two rules that apply to every list and every toggle row:

- Every `LayerToggle` and `ShowOnChartToggle` sets a plain-language `description`, which becomes the
  hover and focus tooltip (it falls back to the title). A toggleable row with no gloss is a finding.
- `SavedList` owns the list `<ul>`, the card frame, and the `empty` state; the panel owns the `<h3>`
  heading above the list and each card body. Do not pass SavedList a `heading` AND render your own
  `<h3>` for the same list, and do not hand-roll the empty `<p>`.

---

## 5. Pick the right row and section class

Reach for a shared class before writing scoped CSS. The full reference is `design-system.md` sections
5 and 7; this is the decision shortcut.

| You are building | Use | Notes |
|---|---|---|
| A clickable row in a popover menu | `.menu-item` | full width, control height, accent-tint on hover |
| Any interactive row that hover-tints and lights via `.is-on` | `.row-interactive` | compose it, add only your content layout; do NOT set its background or border-color or you defeat the shared hover and lit state |
| A landing row that opens a sub-view | `.subview-link` on `.row-interactive` | label, value, trailing chevron (RegionsPanel) |
| An elevated card per item, name over metrics | `.nav-row` (with `.nav-name`, `.nav-metrics`) | the AIS and POI sortable lists; this is a vertical card, not a flat row |
| A flat, hairline-divided list line | `.list-row` | layer rows, pinned rows; no border, no fill |
| A raised bordered card surface | `.card-frame` | add your own layout and padding on top |
| A saved-item card list | `SavedList` (renders the `.saved` family) | not a hand-rolled list |
| A binary or tiny-enum choice | `.segmented` group of `.btn`, one `.is-on` | a lone "Off" button is ambiguous; the pair is self-evident |
| A labeled current-item readout | `<dl class="stat-grid">` | three columns; see the empty-unit rule below |
| An at-a-glance inline stats line | `<dl class="card-stats">` | wrapping, mono `.num` |
| A row of action buttons under a heading | `.panel-controls` | Save, Cancel, New |
| A column section with a heading | `.panel-section` | flex column, `--space-2` gap; do not invent a per-feature name |

`.stat-grid` contract: the `dd` is `display: contents`, so a row with no unit MUST still emit an empty
`<span class="unit"></span>` or the unit column of every following row skews. This is required, not a
crutch.

A section heading is always `<h3 class="caps-label">` (sub-heading `<h4 class="caps-label">`). A bare
`<span class="caps-label">` is for inline mini-labels that are not document headings (a stat `<dt>`, a
status tag, SavedList's own internal heading).

---

## 6. The cascade and collision traps (CSS)

These are the style corrections we keep making. Each has a one-line fix.

1. Global class-name collision leaks properties. A local rule that reuses a global class name for a
   different shape inherits every property the local rule does not override. RegionsPanel named a
   flat landing row `.nav-row`; the global `.nav-row` sets `flex-direction: column`, which the local
   rule did not override, so the row stacked and centered. Fix: give the local shape a DISTINCT name
   (`.subview-link`) and compose `.row-interactive`.
2. A Svelte-scoped rule wins on specificity only for the properties it DECLARES. Any property it
   omits still falls through to a same-name global rule. Declare every property you mean to control.
3. The `hidden` attribute is overridden by `display: flex`. A collapsible body must default to
   `display: none` and reveal with `:not([hidden]) { display: flex }`, as Disclosure does, or
   "hidden" content stays visible and the chevron looks inert.
4. Descending-specificity (Biome `noDescendingSpecificity`): a lower-specificity selector appearing
   after a higher one trips the rule. Order higher-specificity selectors AFTER lower ones, or compose
   `.row-interactive` and scope only your own grid. Reach for a `biome-ignore` only with a written
   justification, as `buttons.css` does for `.segmented .btn` before `.btn`.
5. Use tokens, never a hard-coded px or color. The only sanctioned off-scale literals are the
   hairline tier (0.05 to 0.2 rem) and 0.3, 0.35, 0.4, 0.45, 0.55, and 0.6 rem.

---

## 7. Themes and units

- Read color tokens only, never a raw hex, so a control recolors across day, dusk, and night-red
  automatically.
- Night-red forbids any non-red pixel. Shadows collapse to `none`, so never rely on a shadow alone to
  separate surfaces: a border must also be present. Signal state by brightness, never by hue alone
  (`--alarm` is brighter than `--warning`; `--ok` collapses to a dim red at night).
- A raster overlay cannot recolor, so it routes through `applyRasterTheme` (which desaturates and
  dims it at night), never a CSS filter.
- All values are SI in the store (meters, radians, Kelvin). The two sanctioned exceptions are
  `navigation.position` in decimal degrees and Open-Meteo's preceding-hour precipitation in
  millimeters, read only at the display edge and labeled as an hourly rate. Signal K provider
  precipitation is converted from meters to millimeters at ingestion. Convert all other values only
  at the display edge.
- Follow the server unit preference through the `UnitsStore`, never a panel-local imperial or metric
  toggle and never a locale guess. A unit-bearing field consumes the resolved `UnitsMode` as a prop
  and converts only when rendering.

---

## 8. Copy and voice

The audience is a navigator with minimal chartplotting knowledge, so every panel teaches, glosses,
and guides.

- Open with a teach line: the first child is one plain sentence in `<p class="muted-note">` that says
  what the panel does and how to start ("Press and hold anywhere on the chart to drop a waypoint.").
- Gloss every acronym and jargon term, inline the first time with the acronym in parentheses, or with
  a `title` or `description` tooltip. Established glosses to match the voice of: CPA to "Closest
  pass", TCPA to "Time to closest", MLLW to "mean lower low water (MLLW), the chart's zero", ebb and
  flood to "seaward" and "landward", degrees true to a "Degrees true, measured clockwise from true
  north" tooltip. Never ship a bare ZOC, MPA, AIS, or MLLW with no gloss anywhere on the panel.
- Write guiding empty states with a next step, never a dead "No data": "No X yet. <do Y> to ...".
  Use the `SavedList` `empty` prop rather than a hand-rolled `<p>`.
- Voice: second person, imperative for actions, present tense, short sentences. No marketing tone, no
  exclamation except a true alarm.

House writing rules, mandatory in UI text, labels, commit messages, PR bodies, comments, and docs:

- No em dashes. Use a colon, a comma, or two sentences.
- Oxford comma in every list of three or more.
- The word "and", never the ampersand, in displayed or written text (the ampersand is fine only in
  syntax: URL query separators, HTML entities, code operators, and a real brand like B&G).
- "chartplotter" is one word, always.
- American English (color, behavior, center, gray).
- Never describe the AI or review process in any user-facing or repo-facing writing. Title and
  describe by what changed.

---

## 9. Accessibility

- An `aria-label` on every icon-only control and on each tile or title button, with the inner icon
  `aria-hidden="true"`. A grouping container gets a label too (`role="group" aria-label="Sort
  vessels by"`, `<section aria-label="Active alerts">`).
- The `SlideOver` `closeLabel` is always a specific phrase naming the panel ("Close alarms panel"),
  never the bare default.
- Live regions: `role="status"` for non-error progress, state, and counts; `role="alert"` for an
  error or alarm the navigator must act on now. A class supplies the visual voice and the markup
  supplies the semantics: `.alert-note` pairs with `role="alert"`, `.muted-note` with `role="status"`
  where it updates live.
- Section headings are `<h3 class="caps-label">`. The panel's own title comes from `SlideOver` or
  `SubViewHeader`; do not add a second top-level title.
- Use the shared focus actions in `src/shared/ui/focus.ts` (`focusOnMount`, `rovingFocus`,
  `onKeydownAction`); do not hand-roll focus code. True modals use a native `<dialog>` with
  `showModal()`, which provides browser-native Tab trapping without a manual action.
- A grayed control with a `title` must also carry an `UnavailableHint`, or assistive-technology users
  get no reason. The gloss on a row goes in the `description` prop, not a one-off span.

---

## 10. Pre-flight checklist

Tick all of these before you commit a new menu item.

- [ ] All four `App.svelte` steps: menu item in the right group (Settings stays last), `LeftPanel`
      union member, mount block with matching guards, and the controller and services constructed and
      passed as props.
- [ ] The panel is one `SlideOver` with a specific `closeLabel`, `bodyFlex` (unless it is an
      accordion), and `onClose` and `onBack`.
- [ ] A teach line opens the body; sections are `<section aria-label>` with `<h3 class="caps-label">`
      headings.
- [ ] Every control is a shared primitive (section 4), every row and section uses a shared class
      (section 5), and no global class name is reused for a different shape.
- [ ] Every toggle row sets a `description`; every saved list uses `SavedList` with a next-step
      `empty`; every destructive action arms an `InlineConfirm` or `ConfirmArm`.
- [ ] Tokens only, no hard-coded px or color; reads color tokens so it survives night-red; values
      stored in SI and converted only at the edge through the server unit preference.
- [ ] Copy follows the house writing rules; acronyms are glossed; aria-labels, roles, and headings
      are in place.
- [ ] Every same-purpose control matches the label wording and variant of its siblings on other
      surfaces (the "Customize <object>" rule is the model); a new label pattern for an existing
      job is a review failure.
- [ ] Tiles and rows in one grid stay equal height in every state, including empty and degraded;
      a placeholder occupies the value slot, it never collapses the box.
- [ ] Every text size comes from the type-role table in the design system; no new token-role
      pairing without a design-system edit.
- [ ] The gate is green: `npx @biomejs/biome check --write` then `npm run check` then `npx
      @biomejs/biome ci`, then the commit hook (`biome ci .` and `npm run cruise`) passes.

---

## Settled conventions worth restating

These were inconsistent across panels and are now unified; a new panel follows the settled form:

- One section wrapper: `.panel-section` in `panels.css`. Every panel composes it; do not invent a
  per-feature section name.
- One labeled text field: `TextField`, which supports a live `onInput`, a `focusOnOpen`, an
  `onEnter` submit, and a `large` deck-glove size. There is no hand-rolled "caps-label plus input"
  name field left to copy.
- Layers and charts opens to chart sources, not overlay stacking. Put server-discovered and user-added
  chart sources in the Charts view, with detail rows for type, origin, source, zoom, bounds, and
  show-bounds when available. Keep opacity, visibility, and drag stacking in the Overlays view.
