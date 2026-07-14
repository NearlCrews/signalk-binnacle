# Binnacle Codex Guide

This file is the Codex entrypoint for this repository. `CLAUDE.md` remains the detailed project
history and should be read before architectural work, but this file is the concise operational guide
Codex loads automatically.

## Project Shape

Binnacle is a Signal K webapp: Svelte 5 with runes, Vite, TypeScript, MapLibre GL JS, PMTiles,
Comlink workers, Biome, Vitest, Playwright, and dependency-cruiser.

The architecture is Feature-Sliced Design:

`app -> views -> widgets -> features -> entities -> shared`

Imports flow downward. Sibling slices are imported through their `index.ts` public API only.
Dependency-cruiser enforces the rule.

## Product Rules

- Product name: Binnacle Chartplotter. Spell `chartplotter` as one word.
- Treat all navigation output as advisory. Do not weaken the safety posture in docs or UI.
- Build for a stock Signal K server first. Optional plugins and APIs must detect, degrade, and explain.
- Prefer Signal K server APIs and mature plugins over local-only features. Local-only behavior is a
  fallback, not the primary path, when a server API exists.
- Keep data and persisted config in SI. Convert at the display edge using shared helpers.

## UI Rules

- Read `docs/design-system.md` before building or changing UI.
- Read `docs/building-menu-items.md` before adding or changing menu items, panels, or controls.
- Reuse `src/shared/ui` primitives and `src/styles` utility classes before adding local variants.
- Global CSS stays modular through `src/app.css` imports. Do not rebuild a monolithic stylesheet.
- Hoist duplicate markup or CSS at the second copy.
- Use lucide icons for app chrome when an icon exists.
- Night-red must remain true night-readable: no blue, no bright stray pixels, and alarms still distinct.

## Implementation Rules

- Construct services in `src/app/App.svelte` and inject them. Do not add global singletons.
- Feature orchestration belongs in `create<Feature>Controller(...)` factories in `*.svelte.ts` modules.
- Reactive dependencies that can change, such as auth tokens and feature flags, are injected as getters.
- Reuse helpers from `$shared/lib`, `$shared/map`, `$shared/geo`, `$shared/signalk`, `$shared/ui`,
  and existing entity stores before creating new helpers.
- Keep overlays idempotent: stable source ids, layer ids, teardown, theme application, and reset paths.
- Register protocols and global browser hooks once at startup, not inside components.

## Writing Rules

- No em dashes in committed text, docs, code comments, commit messages, or PR text.
- Use Oxford commas in lists of three or more.
- Do not use `and` as `&` in human-readable text. Use `&` only where syntax or a proper noun requires it.
- Do not mention AI process, agent passes, or review mechanics in changelogs, commits, PR text, or docs.
- Use American English.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Format: `npm run format`
- Lint: `npm run lint`
- Boundary check: `npm run cruise`
- Dead-code check: `npm run deadcode`
- Type check: `npm run check`
- Unit tests: `npm test`
- Build: `npm run build`
- E2E smoke: `npm run test:e2e`

## Verification

For substantial changes, run the full gate before claiming done:

`npm run lint`, `npm run cruise`, `npm run deadcode`, `npm run check`, `npm test`, `npm run build`

Run `npm run test:e2e` when the app shell, layout, instruments, chart lifecycle, or browser behavior
is touched. The preview server may require approval to bind localhost in sandboxed Codex sessions.
For releases, also follow `docs/releasing.md` and obtain explicit approval before tagging or
publishing.

## Git Hygiene

- The repo normally works directly on `main`.
- Do not revert user changes unless explicitly asked.
- Keep scratch files in `tmp/`.
- After significant green work, commit and push to `main` only when the user has asked for that flow or
  the active task clearly includes publishing the local changes.
