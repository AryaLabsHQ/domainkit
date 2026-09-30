# Contributing

DomainKit defines a small, auditable public contract for DNS provisioning. Provider APIs, host
storage, and product UI stay outside the core protocol unless an accepted architecture decision says
otherwise.

## Development

Use Bun 1.4 and Node.js 24.10 or newer:

```sh
bun install --frozen-lockfile
bun run release:check
```

`release:check` runs lint, the lint-rule tests, the format check, and each package's own typecheck,
tests, build, and packed-consumer suite.

Two more gates cover the documentation:

```sh
bun run typecheck:examples
cd apps/docs && bun run reference:check && bunx blume validate --strict && bun run audit --strict && bun run build
```

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
`DOMAINKIT_BROWSER_EXECUTABLE_PATH` (the browser's executable path) when running `test:browser`.
Do not set both. The managed Chromium is the tested default; a custom browser must be compatible
with the installed Playwright version. No option skips browser tests or changes sandbox permissions.
The runner must permit browser processes and the local sockets used by the browser and Vite.

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
