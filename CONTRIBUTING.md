# Contributing

DomainKit defines a small, auditable public contract for DNS provisioning. Provider APIs, host
storage, and product UI stay outside the core protocol unless an accepted architecture decision says
otherwise.

## Development

Use the Bun version pinned by the root `packageManager` field and Node.js 24.10 or newer:

```sh
bun install --frozen-lockfile
bun run check
```

Run commands from the repository root:

| Command           | Contract                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`           | Formatting, lint, strict types, and normal offline tests; no live provider calls.                                                             |
| `build`           | Supported JavaScript and declaration distributions, built with tsdown.                                                                        |
| `test:artifact`   | Build, pack, install, and exercise the published entry points in real consumers.                                                              |
| `docs:check`      | Snippet and docs types, reference coverage, browser tests, production build, styled previews, registry install/build, strict links and audit. |
| `release:check`   | `check`, `test:artifact`, and `docs:check`; no versioning or publication.                                                                     |
| `release:version` | Prepare package versions, generated changelogs, publish lock, and Bun lockfile.                                                               |
| `release:publish` | Tegami CI: maintain the version PR, or publish the prepared candidate through the full gate.                                                  |

`check` includes the lint-rule and repository-automation tests, package Vitest suites, snippet
reader, and docs tooling tests. PostgreSQL tests need Docker and the `postgres:16-alpine` image
available locally. Artifact and registry consumers install dependencies; `test:artifact` and
`docs:check` need network access. Keep those separate from the normal offline gate.

The root Bun pin is the single CI input. Strict repository automation uses TypeScript 6.0.3,
which retains the compiler API needed by docs tooling; package builds and checks retain TypeScript
7.0.2. Tool versions and configurations are maintained locally, with no shared preset dependency.

Add focused tests for observable behaviour, document exported APIs, and keep a pull request to one
coherent change. A change to the public contract says so in its description.

Every code sample on the documentation site is a slice of a file in `examples/` or
`packages/domainkit/examples/`, so a snippet that drifts from the API fails CI rather than the
reader.

## Documentation test environment

The browser suite uses the Chromium revision paired with the locked Playwright package. Install
it after `bun install`, and again after a Playwright upgrade:

```sh
bun run build
cd apps/docs
bun run test:browser:install
bun run test
```

On Linux, `bun run test:browser:install --with-deps` also installs the browser's system libraries;
that step can require administrator access. CI runs it explicitly. See Playwright's
[browser installation guide](https://playwright.dev/docs/browsers).

To use an existing browser, set either `DOMAINKIT_BROWSER_CHANNEL` (for example, `chrome`) or
`DOMAINKIT_BROWSER_EXECUTABLE_PATH` (the browser's executable path) when running `test:browser` or `test:styled`.
Do not set both. The managed Chromium is the tested default; a custom browser must be compatible
with the installed Playwright version. No option skips browser tests or changes sandbox permissions.
The runner must permit browser processes and the local sockets used by the browser and Vite.

`bun run test:styled` drives the production build in light and dark at 320, 375, 768, and 1280
pixels: every registry preview hydrates in its frame and on its docs page, and no text or action is
clipped or pushed off screen. It serves `apps/docs/dist`, so run `bun run build` first; `bun run test`
does not include it. It honours the same browser overrides as `test:browser`.

`bun run test:tooling` checks browser selection and registry fixture inputs without launching a
browser. `bun run test:snippets` checks sample regions. These focused commands do not replace the
full browser suite.

`bun run registry:check` is an online installation test. It uses the workspace's locked shadcn CLI
and starts from exact direct dependency versions. It installs all built items with real `base-nova`
primitives, then typechecks and builds against this branch's packed DomainKit packages. Only the
two DomainKit packages override dependency resolution; live primitives keep their transitive
requirements. The shadcn registry and transitive npm dependencies remain external inputs; the fixture is not an offline
snapshot. Package downloads and `https://ui.shadcn.com` must be reachable. A proxy or network denial
is a blocked check, not a passing result. Run the full check in an authorized environment or use
the PR's CI result when local policy prevents it.

## Release lifecycle

The serialized `publish.yml` workflow runs on every `main` push. Tegami maintains an open
`tegami/version-packages` PR from consumed `.tegami/*.md` release notes. Merging a prepared version
PR enables automatic publication; merging this tooling PR can also retry any prepared unpublished
version already pending on `main`.

```text
main push -> prepare/update version PR
version PR merge or fix-forward merge -> actual candidate SHA
  -> Tegami afterPreflight -> release:check
  -> package publication -> tags and GitHub releases
```

The local `afterPreflight` hook fails closed before publication tasks. Tegami 1.5 also runs this
hook for publish-status and dry-run operations. Its `shouldPublish` flag means an eligible versioned
non-private package, not proof that npm lacks that version. The gate can therefore run more than
once. Do not use `release:version`, `release:publish`, publish-status, or a dry-run as a pure local
validation command. Use `release:check` for validation, after installing the managed browser.

A failed gate leaves a prepared version unpublished. Repair it in a reviewed fix-forward PR;
the next merge can retry the same prepared version only after the full gate passes at that new
candidate SHA. Published versions are immutable. Partial multi-package publication, or publication
followed by a tag/release failure, needs registry/tag reconciliation and a scoped recovery decision;
never blindly republish or retag.

### Generated version PR checks

Only an open, same-repository PR authored by `github-actions[bot]` on
`tegami/version-packages`, containing the current `main` and matching its fresh API base/head, can
use metadata-only validation. The classifier permits genuine synchronized package versions,
corresponding internal workspace ranges and Bun lock entries, generated changelog additions,
consumed release notes, and the generated publish lock. Source, exports, executable files, scripts,
external dependencies, workflows, policy, and arbitrary `.tegami` changes require normal CI.

CI retains the required `validate` and `docs` job names. On this narrow route they report metadata
validation; they do not claim the full package/docs suites ran. Publication still requires the
full gate against the actual candidate. A separate job has only `actions:write` plus read access
to dispatch checks for the current open version PR; it has no npm OIDC or publication permissions.
The classifier runs from the trusted base and never executes the candidate tree.

**Dispatch acceptance is provisional.** A separately authorized post-merge check must confirm that
a real generated version PR's dispatched `validate`/`docs` statuses satisfy the ruleset. Until
that readback succeeds, retain GitHub's manual workflow approval/rerun path when checks do not
attach. No PAT, App, bypass, or ruleset weakening is part of this workflow.

## Live provider conformance

The live harness is opt-in and never runs in CI. It runs the provider conformance suite against a
real account: create and read back, exact no-op, conflict, stale plan, and partial apply. Every
record it writes carries the conformance prefix and is removed again.

```sh
bun run test:live:cloudflare
bun run test:live:vercel
```

Both providers need the zone named twice, once as the target and once as the explicit permission:

- `DOMAINKIT_LIVE_ZONE`
- `DOMAINKIT_LIVE_ALLOW_ZONE`, matching it exactly

Cloudflare also needs `DOMAINKIT_LIVE_CLOUDFLARE_TOKEN`. Vercel needs `DOMAINKIT_LIVE_VERCEL_TOKEN`
and `DOMAINKIT_LIVE_VERCEL_TEAM_ID`. Keep credentials in a local secret manager or a scoped process
environment; never commit them.

Point the harness at a zone you own and can inspect. It writes real DNS records.

## Compatibility

While the public contract is pre-1.0, APIs may change directly. Once a stable contract is declared,
breaking changes will be explicit and versioned.
