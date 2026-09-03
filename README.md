# DomainKit

DomainKit turns your product's DNS requirements into a plan a customer can review, applies only the
plan digest they approved, keeps a receipt of every write, and plans cleanup from that receipt.
Cloudflare and Vercel are built in, and a provider is one declarative value.

Plans are additive and fail closed: missing records are created, exact records are no-ops, and
incompatible state is a conflict rather than an overwrite.

Your app keeps identity, tenancy, credentials, storage, routes, consent, and audit. DomainKit
supplies the lifecycle, not a hosted control plane.

## Packages

- [`domainkit`](./packages/domainkit/README.md) — the Effect-native lifecycle, its host seams, the
  providers, and the values. `domainkit/server` mounts the routes, `domainkit/client` calls them
  from the browser, and `domainkit/testing` ships the fakes and conformance runners.
- [`@domainkit/react`](./packages/react/README.md) — React 19 flows over a transport your server
  owns.
- [`@domainkit/capsuledb`](./packages/capsuledb/README.md) — `Storage` on PostgreSQL as one
  declarative CapsuleDB capsule.

## Repository

- `apps/docs` — the documentation site and the interactive component catalog, published at
  [domain-kit.dev](https://domain-kit.dev).
- `examples` — the snippets the site renders, typechecked against the built packages.
- `packages/domainkit/examples` — runnable Effect examples the core package's own checks gate.

## Development

Use Bun 1.4 and Node.js 24.10 or newer:

```sh
bun install --frozen-lockfile
bun run release:check
bun run typecheck:examples
```

[CONTRIBUTING.md](./CONTRIBUTING.md) covers the live provider harness and the release path.

## License

MIT
