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
6. Confirm every screenshot path exists in the built `public/` tree. The App Store accepts up to six
   images, uses the first as the hero image, and recommends 1280 by 800 pixels (16:10) at about 500 KB
   or less per file. Capture replacements from a controlled demo session at a location unrelated to
   the maintainer, clear browser storage first, and do not supply an own-vessel position. Visually
   inspect the instrument dock and trailing status cluster for coordinates, inspect every image for
   recognizable private locations, and confirm the PNG files contain no EXIF, GPS, or text metadata.
   Do not replace screenshots as an unrelated side effect of release preparation.

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

Run `package:check` through npm. Its package-content validator uses npm's environment-provided
JavaScript entry point instead of a platform-specific command shim, which keeps the same validation
path on Linux, macOS, and Windows.

GitHub workflows disable `setup-node` package-manager caching until the pinned npm version is
installed from the runner's temporary directory. Keep that bootstrap order when changing the Node
matrix or npm requirement. `devEngines` rejects an unsupported bundled npm before a command run from
the repository can upgrade it. The commit gate runs `ci:workflows` to enforce this ordering across
the CI, compatibility-matrix, and publication workflows.

Before requesting publication approval, also confirm:

- `git diff --check` is clean, committed text contains no em dash, and the worktree contains only the
  intended release changes;
- `package.json`, `package-lock.json`, the changelog heading, and the proposed `v<version>` tag agree;
- the npm registry and GitHub releases still show the prior version as latest;
- the release commit is on `main`, and CI, SignalK Webapp CI, and CodeQL pass on that exact commit;
- the CodeQL alerts API reports zero open alerts after the successful workflow; and
- the generated service worker, manifest, app icons, screenshots, and production entry assets exist.

## Cut the release after approval

Only after the owner explicitly approves publication:

1. Commit and push the prepared changes to `main` if that has not already been authorized and done.
2. Wait for CI, SignalK Webapp CI, and CodeQL to pass on the exact release commit, then confirm the
   CodeQL alerts API reports zero open alerts.
3. Create and push the `v<version>` tag on that commit.
4. Publish a GitHub release from the matching changelog section. Publishing the release triggers the
   npm workflow. Creating a draft does not publish npm.
5. Watch the **Publish to npm** workflow through completion. Do not treat a queued or running job as
   success.
6. Verify the GitHub release, npm version and `latest` tag, provenance, package contents, and a clean
   install from the registry.

The workflow rejects a tag that disagrees with `package.json` or points to a commit outside `main`.

The publish job requests `id-token: write` and adds npm provenance. Keep `NPM_TOKEN` configured until
the npm package has a verified trusted-publisher binding. An npm package owner must add a GitHub
Actions trusted publisher for organization `NearlCrews`, repository `signalk-binnacle`, and workflow
`publish.yml`. Allow the `npm publish` action, and leave the environment unset unless the publish job
is later assigned a matching GitHub environment. Trusted publishing requires the existing
GitHub-hosted runner and `id-token: write` permission.

Migrating to token-free publishing requires an owner to configure that external npm setting, run a
successful approved release, verify provenance and package ownership, and only then remove the
`NODE_AUTH_TOKEN` workflow environment entry and the `NPM_TOKEN` repository secret. Repository code
alone cannot prove or create the npm-side binding.

Keep the downloaded tarball argument explicitly relative, such as `./artifacts/*.tgz`. Without the
`./` prefix, npm can interpret the path as GitHub shorthand instead of a local package archive.
