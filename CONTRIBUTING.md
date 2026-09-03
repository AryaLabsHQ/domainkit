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
