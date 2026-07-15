# Contributing

Thanks for your interest in contributing to Binnacle (`signalk-binnacle`).

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Reporting bugs

Check existing issues first to avoid duplicates, then open a bug report with:

- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Binnacle version, Signal K server version, browser, and device)
- Relevant browser console output

## Suggesting enhancements

Open a feature request issue describing the proposed feature, the use case it
serves, and any implementation ideas you have.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Follow the [Development section of the README](../README.md#development)
   for setup, build, and test commands. `npm install` provides every repository-local tool.
3. Run `npm run hooks` once so the git pre-commit and pre-push gates run for you.
4. Make focused commits with clear messages (see below).
5. Add tests for any new functionality and keep the existing suite green.
6. Run `npm run verify`. Run `npm run verify:browser` when browser behavior is affected. CI runs
   `npm run verify:release`, including Chromium, WebKit, package, and runtime audit checks.
7. Update documentation (`README.md`, `CHANGELOG.md`) as needed.
8. Open a pull request with a clear description of the change.

## Code style

- All source is TypeScript and Svelte 5 (runes) under `src/`, built with Vite
  into `public/`.
- Format with Biome (`npm run format`), run the aggregate lint gate with `npm run lint`, and
  type-check application and tooling code with `npm run check`.
- Do not edit `public/`; it is generated build output.
- Keep values SI internally (radians, meters, m/s, Kelvin) and convert only at the display edge.
  The two sanctioned exceptions are `navigation.position` in decimal degrees and Open-Meteo's
  preceding-hour precipitation in millimeters. Signal K provider precipitation is converted from
  meters to millimeters at ingestion.
- American English everywhere (color, behavior, center, gray).
- Default to no comments. Add one only when the WHY is non-obvious (a hidden
  constraint, a subtle invariant, or a workaround).

## Architecture rule

This repository ships exactly ONE npm package and ONE Signal K webapp. Keep the
code modular by splitting it into focused slices under `src/`. Never split the
project into multiple npm packages or a monorepo.

The layout follows Feature-Sliced Design: imports flow strictly downward,
`app -> views -> widgets -> features -> entities -> shared`, every slice
exposes its public API through its `index.ts`, and cross-feature data flows
through an `entities` store, never feature to feature. The boundaries are
machine-enforced: `npm run cruise` (dependency-cruiser) fails the build on a
violation. A new feature is a new slice under `src/features/` plus its wiring
in `src/app/App.svelte`, not surgery on the core.

## Commit messages

Use conventional-commit prefixes that match the actual diff scope:

```text
feat: add a tidal-current marker to the tides panel
fix: keep the anchor drag alarm latched after a reload
docs: update the offline caching instructions
test: cover the GPX import entity guard
chore: update dependencies
```

## License and attribution

By contributing, you agree your contributions are licensed under the
Apache-2.0 License that covers this project. The base map and several overlays
render third-party open data: the OpenFreeMap base map is built from
OpenStreetMap data under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/),
and each chart, weather, and overlay source (NOAA, EMODnet, GEBCO, NASA GIBS,
OpenSeaMap, VLIZ Marine Regions, Open-Meteo, and RainViewer) carries its own
attribution string in the map's attribution control. Keep those attributions
in place on every layer that shows the data.

## Releases

Maintainers use the [release checklist](../docs/releasing.md). Preparing a release and publishing it
are separate actions. A version tag, GitHub release, or npm publication requires explicit owner
approval.
