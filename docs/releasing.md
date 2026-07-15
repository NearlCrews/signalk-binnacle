# Releasing Binnacle

Release preparation and release publication are separate operations. Preparation may update code,
metadata, documentation, tests, and workflows. It does not authorize a version tag, a published GitHub
release, or npm publication. Obtain explicit owner approval immediately before cutting the release.

## Prepare the version

1. Work from `main`, preserve unrelated local changes, and confirm the intended version with the
   owner.
2. Set the same version in `package.json` and the root package entries in `package-lock.json`.
3. Move every shipped change from **Unreleased** into the versioned changelog section, add the release
   date, keep the stable anchor used by the README, and leave **Unreleased** ready for later work.
4. Update the README's **What's new** summary and every affected feature, architecture, security,
   contributor, and operational guide. Keep navigation advice explicitly advisory.
5. Confirm `signalk.appIcon`, `signalk.displayName`, `signalk.screenshots`, keywords, repository,
   homepage, license, Node engine, dependency ranges, and the `files` allowlist in `package.json`.
6. Confirm every screenshot path exists in the built `public/` tree. Capture replacements from a
   controlled demo session at a location unrelated to the maintainer, clear browser storage first,
   and do not supply an own-vessel position. Visually inspect the instrument dock and trailing status
   cluster for coordinates, inspect every image for recognizable private locations, and confirm the
   PNG files contain no EXIF, GPS, or text metadata. Do not replace screenshots as an unrelated side
   effect of release preparation.

## Run the release gate

Use a clean dependency install when practical, install the Playwright browsers, then run:

```bash
npx playwright install chromium webkit
npm run verify:release
npm pack --dry-run --ignore-scripts
```

`verify:release` enforces formatting, lint, prose, architecture, dead code, type checks, coverage,
the production build, bundle budgets, cross-browser behavior, publint, package contents, and the
runtime dependency audit. Inspect the final pack output. It must contain the generated `public/`
application, the five App Store screenshots, `README.md`, `CHANGELOG.md`, `LICENSE`, and the Markdown
guides linked from the README. It must not contain source maps, source files, test artifacts, local
configuration, or scratch files.

Before requesting publication approval, also confirm:

- `git diff --check` is clean, committed text contains no em dash, and the worktree contains only the
  intended release changes;
- `package.json`, `package-lock.json`, the changelog heading, and the proposed `v<version>` tag agree;
- the npm registry and GitHub releases still show the prior version as latest;
- the release commit is on `main`, and CI and SignalK Webapp CI pass on that commit; and
- the generated service worker, manifest, app icons, screenshots, and production entry assets exist.

## Cut the release after approval

Only after the owner explicitly approves publication:

1. Commit and push the prepared changes to `main` if that has not already been authorized and done.
2. Wait for CI and SignalK Webapp CI to pass on the exact release commit.
3. Create and push the `v<version>` tag on that commit.
4. Publish a GitHub release from the matching changelog section. Publishing the release triggers the
   npm workflow. Creating a draft does not publish npm.
5. Watch the **Publish to npm** workflow through completion. Do not treat a queued or running job as
   success.
6. Verify the GitHub release, npm version and `latest` tag, provenance, package contents, and a clean
   install from the registry.

The workflow rejects a tag that disagrees with `package.json` or points to a commit outside `main`.
