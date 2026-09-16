# Releasing Binnacle

Release preparation and release publication are separate operations. Preparation may update code,
metadata, documentation, tests, and workflows. It does not authorize a version tag, a published GitHub
release, or npm publication. Obtain explicit owner approval immediately before cutting the release.

## Prepare the version

1. Work from `main`, preserve unrelated local changes, and confirm the requested version size with
   the owner. Check `package.json`, existing tags, the latest GitHub release, and npm's `latest`
   version before choosing the next version. A minor release after `0.21.0` is `0.22.0`; never reuse
   a published version or move its tag.
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

Preserve historical changelog entries and dated audit evidence. Mark an old audit as a historical
snapshot if readers could mistake it for the current backlog. Keep current behavior in the feature
guides, developer references, and README instead of duplicating a frozen list of test counts.

## Check branch hygiene

Inspect local branches, remote-tracking references, worktrees, and open pull requests before calling
the checkout clean:

```bash
git status --short
git fetch --prune origin
git branch -a -vv
git worktree list
git ls-remote --heads origin
gh pr list --state open
```

Pruning removes local tracking references for branches that no longer exist on the remote. It does
not delete a remote branch. Delete a local branch only after confirming its work is merged or
preserved elsewhere and that no worktree uses it. Do not treat every non-main branch as stale:
active pull requests, including contributions from forks, may contain work that is not in `main`.
Compare dependency pull requests with the current manifest and lockfile, since manually applied
upgrades can supersede them even without a merge commit.

Remote branch deletion and closing a pull request are external changes. Respect any no-push or
local-only instruction, list remaining remote cleanup separately, and obtain authorization before
changing those remote references or pull requests. Do not force-delete unmerged work merely to make
the branch list shorter.

## Run the release gate

Use a clean dependency install when practical, install the Playwright browsers, then run:

```bash
npx playwright install chromium webkit
npm run verify:release
npm pack --dry-run --ignore-scripts
```

`verify:release` enforces formatting, lint, prose, architecture, dead code, type checks, coverage,
the production build, bundle budgets, cross-browser behavior, publint, package contents, and the
runtime and full dependency audits. Inspect the final pack output. It must contain the generated
`public/` application, the five App Store screenshots, `README.md`, `CHANGELOG.md`, `LICENSE`, and the
Markdown guides linked from the README. It must not contain source maps, source files, test artifacts,
local configuration, or scratch files.

Both audits matter for this static webapp. `audit:runtime` checks the production installation,
which has no runtime npm dependencies. `audit:full` also checks the browser libraries and build
toolchain in `devDependencies`; those browser libraries can still contribute code to the shipped
assets. A clean production-only audit does not establish that the bundled browser code is free of
known dependency vulnerabilities.

The build generates `public/THIRD_PARTY_NOTICES.txt` and its JSON inventory from emitted JavaScript
modules and asset origins across the app, workers, and service worker. Both files must ship in the
tarball. The package gate checks complete license text, the bundled font licenses, all three build
scopes, and referenced output files. Installed build tools that contribute no shipped code or assets
do not belong in that inventory. If an upstream package omits its license from npm, the build uses a
version-specific supplement in `scripts/licenses/` tied to the package's published source commit.
Recheck that source and update the supplement mapping when upgrading such a package. Do not replace
full copyright and permission text with only a license identifier.

Browser libraries are build dependencies: the installed webapp serves prebuilt assets and has no
server-side module entry point. Confirm a clean production-only install still serves those assets
without installing the source toolchain or requiring a build lifecycle script.

Normal pull request CI runs `package:check`, which accepts the active version's explicit Unreleased
heading. `verify:release` uses `package:check:release`, which requires the matching dated heading.
Run these checks through npm. The package-content validator uses npm's environment-provided
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

When preparation is explicitly local-only, record the local gate and package results, the prepared
commit, and any remaining remote branch cleanup. Exact-commit hosted CI, CodeQL, and publication
checks remain pending until pushing is authorized. Do not describe those checks as passed merely
because an earlier commit or the local gate passed. If publication happens on a later date, update
the prepared changelog date before the final release commit and rerun the affected checks.

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
